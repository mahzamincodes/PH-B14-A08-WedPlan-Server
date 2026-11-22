
import express from "express";
import {
    authenticateToken,
    authorizeRoles,
} from "../utils/authMiddleware.js";
import { isValidObjectId, toObjectId } from "../utils/dbUtils.js";

const router = express.Router();

// --------------------------------------------------
// ADMIN: Get all users with search and role filter
// GET /api/admin/users
// --------------------------------------------------

router.get(
    "/users",
    authenticateToken,
    authorizeRoles("Admin"),
    async (req, res, next) => {
        try {
            const usersCollection = req.app.locals.usersCollection;

            const search = req.query.search?.trim() || "";
            const role = req.query.role?.trim() || "";

            const filter = {};

            if (search) {
                const escapedSearch = search.replace(
                    /[.*+?^${}()|[\]\\]/g,
                    "\\$&"
                );

                filter.$or = [
                    { name: { $regex: escapedSearch, $options: "i" } },
                    { email: { $regex: escapedSearch, $options: "i" } },
                ];
            }

            if (role && ["Admin", "Vendor", "Customer"].includes(role)) {
                filter.role = role;
            } else if (role) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid role filter.",
                });
            }

            const users = await usersCollection
                .find(filter)
                .project({
                    name: 1,
                    email: 1,
                    image: 1,
                    role: 1,
                    isBlocked: 1,
                    createdAt: 1,
                })
                .sort({ createdAt: -1 })
                .toArray();

            return res.status(200).json({
                success: true,
                count: users.length,
                users,
            });
        } catch (error) {
            next(error);
        }
    }
);

// --------------------------------------------------
// ADMIN: Block or unblock a user
// PATCH /api/admin/users/:id/block
// --------------------------------------------------

router.patch(
    "/users/:id/block",
    authenticateToken,
    authorizeRoles("Admin"),
    async (req, res, next) => {
        try {
            const usersCollection = req.app.locals.usersCollection;
            const { id } = req.params;
            const { isBlocked } = req.body;

            if (!isValidObjectId(id)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid user ID.",
                });
            }

            if (typeof isBlocked !== "boolean") {
                return res.status(400).json({
                    success: false,
                    message: "isBlocked must be a boolean.",
                });
            }

            if (id === req.user.id) {
                return res.status(400).json({
                    success: false,
                    message: "You cannot block or unblock your own account.",
                });
            }

            const result = await usersCollection.updateOne(
                { _id: toObjectId(id) },
                {
                    $set: {
                        isBlocked,
                        updatedAt: new Date(),
                    },
                }
            );

            if (result.matchedCount === 0) {
                return res.status(404).json({
                    success: false,
                    message: "User not found.",
                });
            }

            return res.status(200).json({
                success: true,
                message: isBlocked
                    ? "User blocked successfully."
                    : "User unblocked successfully.",
            });
        } catch (error) {
            next(error);
        }
    }
);

// --------------------------------------------------
// ADMIN: Get dashboard statistics
// GET /api/admin/stats
// --------------------------------------------------

router.get(
    "/stats",
    authenticateToken,
    authorizeRoles("Admin"),
    async (req, res, next) => {
        try {
            const {
                usersCollection,
                servicesCollection,
                transactionsCollection,
            } = req.app.locals;

            if (
                !usersCollection ||
                !servicesCollection ||
                !transactionsCollection
            ) {
                throw new Error(
                    "Required database collections are unavailable."
                );
            }

            const [
                totalUsers,
                totalVendors,
                totalCustomers,
                totalServices,
                pendingServices,
                totalTransactions,
            ] = await Promise.all([
                usersCollection.countDocuments({}),
                usersCollection.countDocuments({ role: "Vendor" }),
                usersCollection.countDocuments({ role: "Customer" }),
                servicesCollection.countDocuments({}),
                servicesCollection.countDocuments({ status: "Pending" }),
                transactionsCollection.countDocuments({}),
            ]);

            return res.status(200).json({
                success: true,
                stats: {
                    totalUsers,
                    totalVendors,
                    totalCustomers,
                    totalServices,
                    pendingServices,
                    totalTransactions,
                },
            });
        } catch (error) {
            next(error);
        }
    }
);

// --------------------------------------------------
// ADMIN: Get all transactions
// GET /api/admin/transactions
// --------------------------------------------------

router.get(
    "/transactions",
    authenticateToken,
    authorizeRoles("Admin"),
    async (req, res, next) => {
        try {
            const { transactionsCollection, usersCollection } =
                req.app.locals;

            if (!transactionsCollection || !usersCollection) {
                throw new Error(
                    "Required database collections are unavailable."
                );
            }

            const transactions = await transactionsCollection
                .aggregate([
                    {
                        $sort: {
                            createdAt: -1,
                        },
                    },
                    {
                        $lookup: {
                            from: usersCollection.collectionName,
                            localField: "vendorId",
                            foreignField: "_id",
                            as: "vendor",
                        },
                    },
                    {
                        $unwind: {
                            path: "$vendor",
                            preserveNullAndEmptyArrays: true,
                        },
                    },
                    {
                        $project: {
                            stripeSessionId: 1,
                            stripeSubscriptionId: 1,
                            amount: 1,
                            currency: 1,
                            status: 1,
                            createdAt: 1,
                            vendor: {
                                name: "$vendor.name",
                                email: "$vendor.email",
                            },
                        },
                    },
                ])
                .toArray();

            return res.status(200).json({
                success: true,
                count: transactions.length,
                transactions,
            });
        } catch (error) {
            next(error);
        }
    }
);

export default router;
