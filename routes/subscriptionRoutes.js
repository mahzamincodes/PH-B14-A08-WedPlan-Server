
import express from "express";
import Stripe from "stripe";
import {
    authenticateToken,
    authorizeRoles,
} from "../utils/authMiddleware.js";
import { toObjectId } from "../utils/dbUtils.js";

const router = express.Router();

const stripe = process.env.STRIPE_SECRET_KEY
    ? new Stripe(process.env.STRIPE_SECRET_KEY, {
          apiVersion: "2024-12-18.acacia",
      })
    : null;

// --------------------------------------------------
// VENDOR: Get current subscription status
// GET /api/subscriptions/me
// --------------------------------------------------

router.get(
    "/me",
    authenticateToken,
    authorizeRoles("Vendor"),
    async (req, res, next) => {
        try {
            const { usersCollection } = req.app.locals;

            if (!usersCollection) {
                throw new Error("Users collection is not available.");
            }

            const vendor = await usersCollection.findOne(
                { _id: toObjectId(req.user.id), role: "Vendor" },
                {
                    projection: {
                        name: 1,
                        email: 1,
                        subscriptionPlan: 1,
                        subscriptionStatus: 1,
                    },
                }
            );

            if (!vendor) {
                return res.status(404).json({
                    success: false,
                    message: "Vendor account not found.",
                });
            }

            return res.status(200).json({
                success: true,
                subscription: {
                    plan: vendor.subscriptionPlan || "free",
                    status: vendor.subscriptionStatus || "inactive",
                },
            });
        } catch (error) {
            next(error);
        }
    }
);

// --------------------------------------------------
// VENDOR: Create Stripe Checkout Session for Premium
// POST /api/subscriptions/checkout
// --------------------------------------------------

router.post(
    "/checkout",
    authenticateToken,
    authorizeRoles("Vendor"),
    async (req, res, next) => {
        try {
            if (!stripe) {
                return res.status(503).json({
                    success: false,
                    message: "Stripe is not configured.",
                });
            }

            const { usersCollection } = req.app.locals;

            if (!usersCollection) {
                throw new Error("Users collection is not available.");
            }

            const vendor = await usersCollection.findOne(
                { _id: toObjectId(req.user.id), role: "Vendor" },
                {
                    projection: {
                        email: 1,
                        subscriptionPlan: 1,
                        subscriptionStatus: 1,
                    },
                }
            );

            if (!vendor) {
                return res.status(404).json({
                    success: false,
                    message: "Vendor account not found.",
                });
            }

            if (
                vendor.subscriptionPlan === "premium" &&
                vendor.subscriptionStatus === "active"
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "You already have an active premium subscription.",
                });
            }

            if (!process.env.STRIPE_PREMIUM_PRICE_ID) {
                return res.status(503).json({
                    success: false,
                    message: "Premium subscription is not configured.",
                });
            }

            const session = await stripe.checkout.sessions.create({
                payment_method_types: ["card"],
                line_items: [
                    {
                        price: process.env.STRIPE_PREMIUM_PRICE_ID,
                        quantity: 1,
                    },
                ],
                mode: "subscription",
                success_url: `${process.env.CLIENT_ORIGIN}/dashboard/subscription?subscription=success`,
                cancel_url: `${process.env.CLIENT_ORIGIN}/dashboard/subscription?subscription=canceled`,
                customer_email: vendor.email || undefined,
                metadata: {
                    vendorId: req.user.id,
                },
            });

            return res.status(200).json({
                success: true,
                sessionId: session.id,
                url: session.url,
            });
        } catch (error) {
            next(error);
        }
    }
);

export default router;
