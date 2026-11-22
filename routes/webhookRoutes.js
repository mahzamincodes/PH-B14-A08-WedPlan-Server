
import express from "express";
import Stripe from "stripe";
import { isValidObjectId, toObjectId } from "../utils/dbUtils.js";

const router = express.Router();

const stripe = process.env.STRIPE_SECRET_KEY
    ? new Stripe(process.env.STRIPE_SECRET_KEY, {
          apiVersion: "2024-12-18.acacia",
      })
    : null;

const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

// Only these statuses grant Premium access.
const PREMIUM_STATUSES = new Set(["active", "trialing"]);

// --------------------------------------------------
// STRIPE: Webhook endpoint
// POST /api/webhooks/stripe
// --------------------------------------------------

router.post("/", async (req, res, next) => {
    if (!stripe) {
        return res.status(503).json({
            success: false,
            message: "Stripe is not configured.",
        });
    }

    const sig = req.headers["stripe-signature"];

    if (!sig || typeof sig !== "string") {
        return res.status(400).json({
            success: false,
            message: "Missing stripe-signature header.",
        });
    }

    if (!endpointSecret) {
        return res.status(503).json({
            success: false,
            message: "Webhook secret is not configured.",
        });
    }

    // Verify Stripe webhook signature.
    let event;

    try {
        event = stripe.webhooks.constructEvent(
            req.body,
            sig,
            endpointSecret
        );
    } catch (err) {
        console.error(
            "Webhook signature verification failed:",
            err.message
        );

        return res.status(400).json({
            success: false,
            message: "Invalid webhook signature.",
        });
    }

    try {
        const { usersCollection, transactionsCollection } = req.app.locals;

        if (!usersCollection || !transactionsCollection) {
            throw new Error(
                "Required database collections are unavailable."
            );
        }

        const now = new Date();

        switch (event.type) {
            // ------------------------------------------
            // CHECKOUT COMPLETED
            // ------------------------------------------
            case "checkout.session.completed": {
                const session = event.data.object;

                if (session.mode !== "subscription") {
                    return res.status(400).json({
                        success: false,
                        message:
                            "Checkout session is not for a subscription.",
                    });
                }

                if (session.payment_status !== "paid") {
                    return res.status(400).json({
                        success: false,
                        message:
                            "Checkout session payment is not paid.",
                    });
                }

                const stripeSessionId = session.id;
                const stripeSubscriptionId = session.subscription;
                const vendorId = session.metadata?.vendorId;

                if (
                    !vendorId ||
                    !isValidObjectId(vendorId) ||
                    !stripeSessionId ||
                    !stripeSubscriptionId
                ) {
                    return res.status(400).json({
                        success: false,
                        message:
                            "Invalid session metadata or missing subscription.",
                    });
                }

                const vendorObjectId = toObjectId(vendorId);

                // Verify the subscription with Stripe BEFORE
                // creating or updating a transaction.
                const subscription =
                    await stripe.subscriptions.retrieve(
                        stripeSubscriptionId
                    );

                if (
                    !subscription ||
                    subscription.id !== stripeSubscriptionId
                ) {
                    throw new Error(
                        "Unable to verify Stripe subscription."
                    );
                }

                const isPremiumActive = PREMIUM_STATUSES.has(
                    subscription.status
                );

                // Idempotent transaction creation.
                // The unique stripeSessionId index prevents duplicates.
                await transactionsCollection.updateOne(
                    { stripeSessionId },
                    {
                        $setOnInsert: {
                            vendorId: vendorObjectId,
                            stripeSessionId,
                            stripeSubscriptionId,
                            amount: session.amount_total || 0,
                            currency: session.currency || "usd",
                            status: "completed",
                            createdAt: now,
                        },
                        $set: {
                            updatedAt: now,
                        },
                    },
                    { upsert: true }
                );

                // Confirm that an existing transaction belongs
                // to the same vendor and subscription.
                const transaction =
                    await transactionsCollection.findOne({
                        stripeSessionId,
                    });

                if (
                    !transaction ||
                    transaction.vendorId.toString() !==
                        vendorObjectId.toString() ||
                    transaction.stripeSubscriptionId !==
                        stripeSubscriptionId
                ) {
                    throw new Error(
                        "Stripe transaction ownership verification failed."
                    );
                }

                // Always synchronize the vendor, including duplicate
                // webhook deliveries. This makes retries safe.
                const userResult = await usersCollection.updateOne(
                    {
                        _id: vendorObjectId,
                        role: "Vendor",
                    },
                    {
                        $set: {
                            subscriptionPlan: isPremiumActive
                                ? "premium"
                                : "free",
                            subscriptionStatus: subscription.status,
                            stripeCustomerId:
                                subscription.customer || null,
                            stripeSubscriptionId,
                            subscriptionExpiresAt:
                                isPremiumActive &&
                                subscription.current_period_end
                                    ? new Date(
                                          subscription.current_period_end *
                                              1000
                                      )
                                    : null,
                            updatedAt: now,
                        },
                    }
                );

                if (userResult.matchedCount === 0) {
                    throw new Error(
                        "Vendor account was not found for this subscription."
                    );
                }

                break;
            }

            // ------------------------------------------
            // SUBSCRIPTION UPDATED
            // ------------------------------------------
            case "customer.subscription.updated": {
                const subscription = event.data.object;
                const stripeSubscriptionId = subscription.id;

                const isPremiumActive = PREMIUM_STATUSES.has(
                    subscription.status
                );

                // Do not downgrade just because cancellation is scheduled.
                // Active/trialing subscriptions retain Premium until expiry.
                const subscriptionExpiresAt =
                    isPremiumActive && subscription.current_period_end
                        ? new Date(
                              subscription.current_period_end * 1000
                          )
                        : null;

                await transactionsCollection.updateOne(
                    { stripeSubscriptionId },
                    {
                        $set: {
                            status: subscription.status,
                            updatedAt: now,
                        },
                    }
                );

                // Reconcile vendor status on every delivery.
                const userResult = await usersCollection.updateOne(
                    { stripeSubscriptionId },
                    {
                        $set: {
                            subscriptionPlan: isPremiumActive
                                ? "premium"
                                : "free",
                            subscriptionStatus: subscription.status,
                            subscriptionExpiresAt,
                            updatedAt: now,
                        },
                    }
                );

                if (userResult.matchedCount === 0) {
                    console.warn(
                        "No vendor found for subscription:",
                        stripeSubscriptionId
                    );
                }

                break;
            }

            // ------------------------------------------
            // SUBSCRIPTION DELETED
            // ------------------------------------------
            case "customer.subscription.deleted": {
                const subscription = event.data.object;
                const stripeSubscriptionId = subscription.id;

                await transactionsCollection.updateOne(
                    { stripeSubscriptionId },
                    {
                        $set: {
                            status: "canceled",
                            updatedAt: now,
                        },
                    }
                );

                await usersCollection.updateOne(
                    { stripeSubscriptionId },
                    {
                        $set: {
                            subscriptionPlan: "free",
                            subscriptionStatus: "canceled",
                            stripeSubscriptionId: null,
                            subscriptionExpiresAt: null,
                            updatedAt: now,
                        },
                    }
                );

                break;
            }

            default:
                // Acknowledge events that are not handled here.
                break;
        }

        return res.status(200).json({ received: true });
    } catch (error) {
        // Return an error through the central error handler.
        // Stripe can retry failed webhook deliveries.
        next(error);
    }
});

export default router;