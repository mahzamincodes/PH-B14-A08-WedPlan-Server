
import express from "express";
import {
    authenticateToken,
    authorizeRoles,
} from "../utils/authMiddleware.js";
import { isValidObjectId, toObjectId } from "../utils/dbUtils.js";

const router = express.Router();

const SERVICE_STATUSES = ["Pending", "Approved", "Rejected"];

function getCollections(req) {
    const { servicesCollection, usersCollection } = req.app.locals;

    if (!servicesCollection || !usersCollection) {
        throw new Error("Required database collections are unavailable.");
    }

    return { servicesCollection, usersCollection };
}

function isNonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
}

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function validateServiceData(body, requireAll = true) {
    const fields = [
        "serviceName",
        "category",
        "description",
        "price",
        "location",
        "images",
    ];

    if (!body || typeof body !== "object" || Array.isArray(body)) {
        return "Invalid request body.";
    }

    for (const field of fields) {
        if (requireAll && !(field in body)) {
            return `${field} is required.`;
        }
    }

    if (
        "serviceName" in body &&
        (!isNonEmptyString(body.serviceName) ||
            body.serviceName.trim().length > 150)
    ) {
        return "Service name must be between 1 and 150 characters.";
    }

    if (
        "category" in body &&
        (!isNonEmptyString(body.category) ||
            body.category.trim().length > 100)
    ) {
        return "Category must be between 1 and 100 characters.";
    }

    if (
        "description" in body &&
        (!isNonEmptyString(body.description) ||
            body.description.trim().length > 5000)
    ) {
        return "Description must be between 1 and 5000 characters.";
    }

    if (
        "price" in body &&
        (typeof body.price !== "number" ||
            !Number.isFinite(body.price) ||
            body.price <= 0)
    ) {
        return "Price must be a valid positive number.";
    }

    if (
        "location" in body &&
        (!isNonEmptyString(body.location) ||
            body.location.trim().length > 200)
    ) {
        return "Location must be between 1 and 200 characters.";
    }

    if ("images" in body) {
        if (
            !Array.isArray(body.images) ||
            body.images.some((imageUrl) => {
                if (typeof imageUrl !== "string") {
                    return true;
                }

                try {
                    const parsedUrl = new URL(imageUrl);
                    return parsedUrl.protocol !== "https:";
                } catch {
                    return true;
                }
            })
        ) {
            return "Images must be an array of valid HTTPS URLs.";
        }
    }

    return null;
}

function buildServiceData(body) {
    return {
        serviceName: body.serviceName.trim(),
        category: body.category.trim(),
        description: body.description.trim(),
        price: body.price,
        location: body.location.trim(),
        images: [...body.images],
    };
}

// --------------------------------------------------
// PUBLIC: Browse approved services
// GET /api/services
// Optional: ?limit=6
// --------------------------------------------------

router.get("/", async (req, res, next) => {
    try {
        const { servicesCollection, usersCollection } = getCollections(req);

        const {
            search = "",
            category,
            location,
            sort = "",
            limit,
        } = req.query;

        if (
            typeof search !== "string" ||
            (category !== undefined && typeof category !== "string") ||
            (location !== undefined && typeof location !== "string") ||
            !["", "asc", "desc"].includes(sort) ||
            (limit !== undefined &&
                (typeof limit !== "string" || !/^[1-6]$/.test(limit)))
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid search or filter parameters.",
            });
        }

        const filter = {
            status: "Approved",
            isActive: { $ne: false },
        };

        if (search.trim()) {
            const searchRegex = new RegExp(
                escapeRegex(search.trim()),
                "i"
            );

            filter.$or = [
                { serviceName: searchRegex },
                { category: searchRegex },
                { location: searchRegex },
            ];
        }

        if (category?.trim()) {
            filter.category = category.trim();
        }

        if (location?.trim()) {
            filter.location = {
                $regex: escapeRegex(location.trim()),
                $options: "i",
            };
        }

        const sortOptions =
            sort === "asc"
                ? { price: 1 }
                : sort === "desc"
                    ? { price: -1 }
                    : { createdAt: -1 };

        let servicesQuery = servicesCollection
            .find(filter)
            .sort(sortOptions);

        if (limit !== undefined) {
            servicesQuery = servicesQuery.limit(Number(limit));
        }

        const services = await servicesQuery.toArray();

        const vendorIds = [
            ...new Map(
                services
                    .filter((service) => service.vendorId)
                    .map((service) => [
                        service.vendorId.toString(),
                        service.vendorId,
                    ])
            ).values(),
        ];

        const vendors = vendorIds.length
            ? await usersCollection
                .find(
                    {
                        _id: { $in: vendorIds },
                        role: "Vendor",
                    },
                    {
                        projection: {
                            name: 1,
                            image: 1,
                        },
                    }
                )
                .toArray()
            : [];

        const vendorMap = new Map(
            vendors.map((vendor) => [
                vendor._id.toString(),
                {
                    name: vendor.name || null,
                    image: vendor.image || null,
                },
            ])
        );

        const servicesWithVendor = services.map(
            ({ vendorId, ...service }) => ({
                ...service,
                vendor: vendorId
                    ? vendorMap.get(vendorId.toString()) || null
                    : null,
            })
        );

        return res.status(200).json({
            success: true,
            count: servicesWithVendor.length,
            services: servicesWithVendor,
        });
    } catch (error) {
        next(error);
    }
});

// --------------------------------------------------
// VENDOR: Get own services
// GET /api/services/mine
// --------------------------------------------------

router.get(
    "/mine",
    authenticateToken,
    authorizeRoles("Vendor"),
    async (req, res, next) => {
        try {
            const { servicesCollection } = getCollections(req);

            const services = await servicesCollection
                .find({
                    vendorId: toObjectId(req.user.id),
                })
                .sort({ createdAt: -1 })
                .toArray();

            return res.status(200).json({
                success: true,
                count: services.length,
                services,
            });
        } catch (error) {
            next(error);
        }
    }
);

// --------------------------------------------------
// ADMIN: Get all services
// GET /api/services/admin/all
// --------------------------------------------------

router.get(
    "/admin/all",
    authenticateToken,
    authorizeRoles("Admin"),
    async (req, res, next) => {
        try {
            const { servicesCollection } = getCollections(req);

            const { search = "", status } = req.query;

            if (
                typeof search !== "string" ||
                (status !== undefined &&
                    (typeof status !== "string" ||
                        !SERVICE_STATUSES.includes(status)))
            ) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid search or status filter.",
                });
            }

            const filter = {};

            if (status) {
                filter.status = status;
            }

            if (search.trim()) {
                const searchRegex = new RegExp(
                    escapeRegex(search.trim()),
                    "i"
                );

                filter.$or = [
                    { serviceName: searchRegex },
                    { category: searchRegex },
                    { location: searchRegex },
                ];
            }

            const services = await servicesCollection
                .find(filter)
                .sort({ createdAt: -1 })
                .toArray();

            return res.status(200).json({
                success: true,
                count: services.length,
                services,
            });
        } catch (error) {
            next(error);
        }
    }
);

// --------------------------------------------------
// VENDOR: Add a new service
// POST /api/services
// --------------------------------------------------

router.post(
    "/",
    authenticateToken,
    authorizeRoles("Vendor"),
    async (req, res, next) => {
        try {
            const { servicesCollection, usersCollection } =
                getCollections(req);

            const allowedFields = [
                "serviceName",
                "category",
                "description",
                "price",
                "location",
                "images",
            ];

            if (
                Object.keys(req.body || {}).some(
                    (key) => !allowedFields.includes(key)
                )
            ) {
                return res.status(400).json({
                    success: false,
                    message: "Unexpected service fields are not allowed.",
                });
            }

            const validationError = validateServiceData(req.body);

            if (validationError) {
                return res.status(400).json({
                    success: false,
                    message: validationError,
                });
            }

            const vendor = await usersCollection.findOne(
                { _id: toObjectId(req.user.id) },
                {
                    projection: {
                        role: 1,
                        isBlocked: 1,
                        subscriptionPlan: 1,
                    },
                }
            );

            if (!vendor || vendor.role !== "Vendor") {
                return res.status(403).json({
                    success: false,
                    message: "Vendor account required.",
                });
            }

            if (vendor.isBlocked === true) {
                return res.status(403).json({
                    success: false,
                    message: "Your account is blocked.",
                });
            }

            // Free vendors are limited to 3 active services; Premium vendors
            // have unlimited active services.
            if (vendor.subscriptionPlan !== "premium") {
                const activeServiceCount = await servicesCollection
                    .countDocuments({
                        vendorId: toObjectId(req.user.id),
                        isActive: true,
                    });

                if (activeServiceCount >= 3) {
                    return res.status(403).json({
                        success: false,
                        message:
                            "Free vendors can have at most 3 active services. Upgrade to Premium for unlimited services.",
                    });
                }
            }

            const service = {
                ...buildServiceData(req.body),
                vendorId: toObjectId(req.user.id),
                status: "Pending",
                isActive: true,
                createdAt: new Date(),
            };

            const result = await servicesCollection.insertOne(service);

            return res.status(201).json({
                success: true,
                message: "Service submitted for admin approval.",
                service: {
                    ...service,
                    _id: result.insertedId,
                },
            });
        } catch (error) {
            next(error);
        }
    }
);

// --------------------------------------------------
// PUBLIC: Get service details
// GET /api/services/:id
// --------------------------------------------------


router.get("/:id", async (req, res, next) => {
    try {
        const { servicesCollection, usersCollection } = getCollections(req);
        const { id } = req.params;

        if (!isValidObjectId(id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid service ID.",
            });
        }

        const service = await servicesCollection.findOne({
            _id: toObjectId(id),
            status: "Approved",
            isActive: { $ne: false },
        });

        if (!service) {
            return res.status(404).json({
                success: false,
                message: "Service not found or unavailable.",
            });
        }

        const vendor = service.vendorId
            ? await usersCollection.findOne(
                {
                    _id: service.vendorId,
                    role: "Vendor",
                },
                {
                    projection: {
                        name: 1,
                        image: 1,
                    },
                }
            )
            : null;

        const { vendorId, ...serviceData } = service;

        return res.status(200).json({
            success: true,
            service: {
                ...serviceData,
                vendor: vendor
                    ? {
                        name: vendor.name || null,
                        image: vendor.image || null,
                    }
                    : null,
            },
        });
    } catch (error) {
        next(error);
    }
});


// --------------------------------------------------
// VENDOR: Update own service
// PATCH /api/services/:id
// --------------------------------------------------

router.patch(
    "/:id",
    authenticateToken,
    authorizeRoles("Vendor"),
    async (req, res, next) => {
        try {
            const { servicesCollection, usersCollection } =
                getCollections(req);
            const { id } = req.params;

            if (!isValidObjectId(id)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid service ID.",
                });
            }

            const allowedFields = [
                "serviceName",
                "category",
                "description",
                "price",
                "location",
                "images",
                "isActive",
            ];

            const bodyKeys = Object.keys(req.body || {});

            if (
                bodyKeys.length === 0 ||
                bodyKeys.some((key) => !allowedFields.includes(key))
            ) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid or empty service update.",
                });
            }

            const validationError = validateServiceData(
                req.body,
                false
            );

            if (validationError) {
                return res.status(400).json({
                    success: false,
                    message: validationError,
                });
            }

            // Availability must be a boolean value.
            if (
                "isActive" in req.body &&
                typeof req.body.isActive !== "boolean"
            ) {
                return res.status(400).json({
                    success: false,
                    message: "isActive must be a boolean value.",
                });
            }

            const vendor = await usersCollection.findOne(
                { _id: toObjectId(req.user.id) },
                {
                    projection: {
                        role: 1,
                        isBlocked: 1,
                        subscriptionPlan: 1,
                    },
                }
            );

            if (!vendor || vendor.role !== "Vendor") {
                return res.status(403).json({
                    success: false,
                    message: "Vendor account required.",
                });
            }

            if (vendor.isBlocked === true) {
                return res.status(403).json({
                    success: false,
                    message: "Your account is blocked.",
                });
            }

            // Free vendors are limited to 3 active services; Premium vendors
            // have unlimited active services. Enforce this when reactivating
            // a service (isActive: true).
            if (
                "isActive" in req.body &&
                req.body.isActive === true &&
                vendor.subscriptionPlan !== "premium"
            ) {
                const activeServiceCount = await servicesCollection
                    .countDocuments({
                        vendorId: toObjectId(req.user.id),
                        isActive: true,
                        _id: { $ne: toObjectId(id) },
                    });

                if (activeServiceCount >= 3) {
                    return res.status(403).json({
                        success: false,
                        message:
                            "Free vendors can have at most 3 active services. Upgrade to Premium for unlimited services.",
                    });
                }
            }

            const updateData = {};

            for (const field of bodyKeys) {
                updateData[field] =
                    field === "images"
                        ? [...req.body.images]
                        : typeof req.body[field] === "string"
                            ? req.body[field].trim()
                            : req.body[field];
            }

            const result = await servicesCollection.updateOne(
                {
                    _id: toObjectId(id),
                    vendorId: toObjectId(req.user.id),
                },
                {
                    $set: updateData,
                }
            );

            if (result.matchedCount === 0) {
                return res.status(404).json({
                    success: false,
                    message: "Service not found or you do not own it.",
                });
            }

            return res.status(200).json({
                success: true,
                message: "Service updated successfully.",
            });
        } catch (error) {
            next(error);
        }
    }
);

// --------------------------------------------------
// VENDOR: Delete own service
// DELETE /api/services/:id
// --------------------------------------------------

router.delete(
    "/:id",
    authenticateToken,
    authorizeRoles("Vendor"),
    async (req, res, next) => {
        try {
            const { servicesCollection } = getCollections(req);
            const { id } = req.params;

            if (!isValidObjectId(id)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid service ID.",
                });
            }

            const result = await servicesCollection.deleteOne({
                _id: toObjectId(id),
                vendorId: toObjectId(req.user.id),
            });

            if (result.deletedCount === 0) {
                return res.status(404).json({
                    success: false,
                    message: "Service not found or you do not own it.",
                });
            }

            return res.status(200).json({
                success: true,
                message: "Service deleted successfully.",
            });
        } catch (error) {
            next(error);
        }
    }
);

// --------------------------------------------------
// ADMIN: Approve or reject a service
// PATCH /api/services/:id/review
// --------------------------------------------------

router.patch(
    "/:id/review",
    authenticateToken,
    authorizeRoles("Admin"),
    async (req, res, next) => {
        try {
            const { servicesCollection } = getCollections(req);
            const { id } = req.params;
            const { status } = req.body || {};

            if (!isValidObjectId(id)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid service ID.",
                });
            }

            if (!["Approved", "Rejected"].includes(status)) {
                return res.status(400).json({
                    success: false,
                    message: "Status must be Approved or Rejected.",
                });
            }

            const result = await servicesCollection.updateOne(
                { _id: toObjectId(id) },
                { $set: { status } }
            );

            if (result.matchedCount === 0) {
                return res.status(404).json({
                    success: false,
                    message: "Service not found.",
                });
            }

            return res.status(200).json({
                success: true,
                message: `Service ${status.toLowerCase()} successfully.`,
            });
        } catch (error) {
            next(error);
        }
    }
);

// --------------------------------------------------
// ADMIN: Delete any service
// DELETE /api/services/admin/:id
// --------------------------------------------------

router.delete(
    "/admin/:id",
    authenticateToken,
    authorizeRoles("Admin"),
    async (req, res, next) => {
        try {
            const { servicesCollection } = getCollections(req);
            const { id } = req.params;

            if (!isValidObjectId(id)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid service ID.",
                });
            }

            const result = await servicesCollection.deleteOne({
                _id: toObjectId(id),
            });

            if (result.deletedCount === 0) {
                return res.status(404).json({
                    success: false,
                    message: "Service not found.",
                });
            }

            return res.status(200).json({
                success: true,
                message: "Service deleted successfully.",
            });
        } catch (error) {
            next(error);
        }
    }
);

export default router;