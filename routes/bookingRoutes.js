
import express from "express";
import {
    authenticateToken,
    authorizeRoles,
} from "../utils/authMiddleware.js";
import {
    isValidObjectId,
    normalizeEventDate,
    toObjectId,
} from "../utils/dbUtils.js";

const router = express.Router();

function getCollections(req) {
    return {
        bookingsCollection: req.app.locals.bookingsCollection,
        servicesCollection: req.app.locals.servicesCollection,
        usersCollection: req.app.locals.usersCollection,
    };
}

// --------------------------------------------------
// CUSTOMER: Create a booking
// POST /api/bookings
// --------------------------------------------------

router.post(
    "/",
    authenticateToken,
    authorizeRoles("Customer"),
    async (req, res, next) => {
        try {
            const {
                bookingsCollection,
                servicesCollection,
                usersCollection,
            } = getCollections(req);

            const { serviceId, eventDate, eventLocation, message } =
                req.body || {};

            if (
                !isValidObjectId(serviceId) ||
                typeof eventLocation !== "string" ||
                !eventLocation.trim() ||
                eventLocation.trim().length > 300 ||
                typeof message !== "string" ||
                !message.trim() ||
                message.trim().length > 2000
            ) {
                return res.status(400).json({
                    success: false,
                    message: "Please provide valid booking information.",
                });
            }

            let normalizedDate;

            try {
                normalizedDate = normalizeEventDate(eventDate);
            } catch {
                return res.status(400).json({
                    success: false,
                    message: "Please provide a valid event date.",
                });
            }

            const customerId = toObjectId(req.user.id);
            const serviceObjectId = toObjectId(serviceId);

            const [service, customer] = await Promise.all([
                servicesCollection.findOne({
                    _id: serviceObjectId,
                    status: "Approved",
                    isActive: { $ne: false },
                }),
                usersCollection.findOne({
                    _id: customerId,
                }),
            ]);

            if (!service) {
                return res.status(404).json({
                    success: false,
                    message: "This service is unavailable.",
                });
            }

            if (service.vendorId.equals(customerId)) {
                return res.status(403).json({
                    success: false,
                    message: "You cannot book your own service.",
                });
            }

            if (!customer) {
                return res.status(404).json({
                    success: false,
                    message: "Customer account not found.",
                });
            }

            const existingBooking = await bookingsCollection.findOne({
                serviceId: serviceObjectId,
                eventDate: normalizedDate,
                status: { $in: ["Pending", "Accepted"] },
            });

            if (existingBooking) {
                return res.status(409).json({
                    success: false,
                    message:
                        "This service already has an active booking for this event date.",
                });
            }

            const booking = {
                customerId,
                vendorId: service.vendorId,
                serviceId: serviceObjectId,

                serviceName: service.serviceName,
                serviceCategory: service.category,
                servicePrice: service.price,
                serviceImage: service.images?.[0] || null,

                customerName: customer.name || "",
                customerEmail: customer.email || "",
                customerImage: customer.image || null,

                eventDate: normalizedDate,
                eventLocation: eventLocation.trim(),
                message: message.trim(),

                status: "Pending",
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            const result = await bookingsCollection.insertOne(booking);

            return res.status(201).json({
                success: true,
                message: "Booking request submitted successfully.",
                booking: {
                    ...booking,
                    _id: result.insertedId,
                },
            });
        } catch (error) {
            if (error.code === 11000) {
                return res.status(409).json({
                    success: false,
                    message:
                        "This service already has an active booking for this event date.",
                });
            }

            next(error);
        }
    }
);

// --------------------------------------------------
// VENDOR: Get own booking requests
// GET /api/bookings/vendor
// --------------------------------------------------

router.get(
    "/vendor",
    authenticateToken,
    authorizeRoles("Vendor"),
    async (req, res, next) => {
        try {
            const { bookingsCollection } = getCollections(req);

            const bookings = await bookingsCollection
                .aggregate([
                    {
                        $match: {
                            vendorId: toObjectId(req.user.id),
                        },
                    },
                    {
                        $sort: {
                            createdAt: -1,
                        },
                    },
                    {
                        $lookup: {
                            from: "users",
                            localField: "customerId",
                            foreignField: "_id",
                            as: "customer",
                        },
                    },
                    {
                        $unwind: {
                            path: "$customer",
                            preserveNullAndEmptyArrays: true,
                        },
                    },
                    {
                        $project: {
                            customer: {
                                name: 1,
                                email: 1,
                                image: 1,
                            },
                            serviceName: 1,
                            serviceCategory: 1,
                            servicePrice: 1,
                            serviceImage: 1,
                            eventDate: 1,
                            eventLocation: 1,
                            message: 1,
                            status: 1,
                            createdAt: 1,
                            updatedAt: 1,
                            customerId: 1,
                            vendorId: 1,
                            serviceId: 1,
                        },
                    },
                ])
                .toArray();

            return res.status(200).json({
                success: true,
                bookings,
            });
        } catch (error) {
            next(error);
        }
    }
);

// --------------------------------------------------
// CUSTOMER: Get own bookings
// GET /api/bookings/mine
// --------------------------------------------------

router.get(
    "/mine",
    authenticateToken,
    authorizeRoles("Customer"),
    async (req, res, next) => {
        try {
            const { bookingsCollection } = getCollections(req);

            const bookings = await bookingsCollection
                .aggregate([
                    {
                        $match: {
                            customerId: toObjectId(req.user.id),
                        },
                    },
                    {
                        $sort: {
                            createdAt: -1,
                        },
                    },
                    {
                        $lookup: {
                            from: "users",
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
                            vendor: {
                                name: 1,
                                email: 1,
                                image: 1,
                            },
                            serviceName: 1,
                            serviceCategory: 1,
                            servicePrice: 1,
                            serviceImage: 1,
                            eventDate: 1,
                            eventLocation: 1,
                            message: 1,
                            status: 1,
                            createdAt: 1,
                            updatedAt: 1,
                            customerId: 1,
                            vendorId: 1,
                            serviceId: 1,
                        },
                    },
                ])
                .toArray();

            return res.status(200).json({
                success: true,
                bookings,
            });
        } catch (error) {
            next(error);
        }
    }
);

// --------------------------------------------------
// VENDOR: Accept or reject a booking
// PATCH /api/bookings/:id/status
// --------------------------------------------------

router.patch(
    "/:id/status",
    authenticateToken,
    authorizeRoles("Vendor"),
    async (req, res, next) => {
        try {
            const { bookingsCollection } = getCollections(req);
            const { id } = req.params;
            const { status } = req.body || {};

            if (!isValidObjectId(id)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid booking ID.",
                });
            }

            if (!["Accepted", "Rejected"].includes(status)) {
                return res.status(400).json({
                    success: false,
                    message: "Status must be Accepted or Rejected.",
                });
            }

            const vendorId = toObjectId(req.user.id);
            const bookingId = toObjectId(id);

            const result = await bookingsCollection.updateOne(
                {
                    _id: bookingId,
                    vendorId,
                    status: "Pending",
                },
                {
                    $set: {
                        status,
                        updatedAt: new Date(),
                    },
                }
            );

            if (result.matchedCount === 0) {
                const booking = await bookingsCollection.findOne({
                    _id: bookingId,
                    vendorId,
                });

                if (!booking) {
                    return res.status(404).json({
                        success: false,
                        message: "Booking not found.",
                    });
                }

                return res.status(409).json({
                    success: false,
                    message: "This booking has already been processed.",
                });
            }

            return res.status(200).json({
                success: true,
                message: `Booking ${status.toLowerCase()} successfully.`,
            });
        } catch (error) {
            next(error);
        }
    }
);

// --------------------------------------------------
// CUSTOMER: Cancel a pending booking
// PATCH /api/bookings/:id/cancel
// --------------------------------------------------

router.patch(
    "/:id/cancel",
    authenticateToken,
    authorizeRoles("Customer"),
    async (req, res, next) => {
        try {
            const { bookingsCollection } = getCollections(req);
            const { id } = req.params;

            if (!isValidObjectId(id)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid booking ID.",
                });
            }

            const customerId = toObjectId(req.user.id);
            const bookingId = toObjectId(id);

            const result = await bookingsCollection.updateOne(
                {
                    _id: bookingId,
                    customerId,
                    status: "Pending",
                },
                {
                    $set: {
                        status: "Cancelled",
                        updatedAt: new Date(),
                    },
                }
            );

            if (result.matchedCount === 0) {
                const booking = await bookingsCollection.findOne({
                    _id: bookingId,
                    customerId,
                });

                if (!booking) {
                    return res.status(404).json({
                        success: false,
                        message: "Booking not found.",
                    });
                }

                return res.status(409).json({
                    success: false,
                    message: "Only pending bookings can be cancelled.",
                });
            }

            return res.status(200).json({
                success: true,
                message: "Booking cancelled successfully.",
            });
        } catch (error) {
            next(error);
        }
    }
);

export default router;
