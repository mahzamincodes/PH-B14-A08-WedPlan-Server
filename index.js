
import express from "express";
import cors from "cors";
import { MongoClient } from "mongodb";
import "dotenv/config";

import serviceRoutes from "./routes/serviceRoutes.js";
import bookingRoutes from "./routes/bookingRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import subscriptionRoutes from "./routes/subscriptionRoutes.js";
import webhookRoutes from "./routes/webhookRoutes.js";

const app = express();
const PORT = process.env.PORT || 5000;

// CORS configuration
const allowedOrigin = process.env.CLIENT_ORIGIN;

if (!allowedOrigin) {
    throw new Error("CLIENT_ORIGIN is not configured.");
}

app.use(
    cors({
        origin: allowedOrigin,
        methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
        allowedHeaders: ["Content-Type", "Authorization"],
    })
);

// Stripe webhook must be registered before express.json().
app.use(
    "/api/webhooks/stripe",
    express.raw({ type: "application/json" }),
    webhookRoutes
);

app.use(express.json());

// MongoDB Atlas connection
const client = new MongoClient(
    `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.vznqwwk.mongodb.net/`
);

export async function connectToMongoDB() {
    try {
        await client.connect();
        console.log("You successfully connected to MongoDB!");
        return client;
    } catch (err) {
        console.error(
            "MongoDB connection failed. Application will not start."
        );
        throw err;
    }
}

const connectedClient = await connectToMongoDB();
const db = connectedClient.db("wedplan");

// Approved collections
export const usersCollection = db.collection("users");
export const servicesCollection = db.collection("services");
export const bookingsCollection = db.collection("bookings");
export const transactionsCollection = db.collection("transactions");

// Make collections available to routes.
app.locals.usersCollection = usersCollection;
app.locals.servicesCollection = servicesCollection;
app.locals.bookingsCollection = bookingsCollection;
app.locals.transactionsCollection = transactionsCollection;

// Initialize the 12 approved indexes.
async function initializeIndexes() {
    const indexSpecs = [
        // Services — 3 indexes
        {
            collection: servicesCollection,
            keys: { vendorId: 1 },
            options: { name: "idx_svc_vendorId" },
        },
        {
            collection: servicesCollection,
            keys: { category: 1 },
            options: { name: "idx_svc_category" },
        },
        {
            collection: servicesCollection,
            keys: { status: 1, createdAt: -1 },
            options: { name: "idx_svc_status_createdAt" },
        },

        // Bookings — 5 indexes
        {
            collection: bookingsCollection,
            keys: { customerId: 1 },
            options: { name: "idx_bk_customerId" },
        },
        {
            collection: bookingsCollection,
            keys: { vendorId: 1 },
            options: { name: "idx_bk_vendorId" },
        },
        {
            collection: bookingsCollection,
            keys: { serviceId: 1 },
            options: { name: "idx_bk_serviceId" },
        },
        {
            collection: bookingsCollection,
            keys: { status: 1 },
            options: { name: "idx_bk_status" },
        },
        {
            collection: bookingsCollection,
            keys: { serviceId: 1, eventDate: 1 },
            options: {
                name: "idx_bk_serviceId_eventDate_unique_pending_accepted",
                unique: true,
                partialFilterExpression: {
                    status: { $in: ["Pending", "Accepted"] },
                },
            },
        },

        // Transactions — 4 indexes
        {
            collection: transactionsCollection,
            keys: { vendorId: 1 },
            options: { name: "idx_txn_vendorId" },
        },
        {
            collection: transactionsCollection,
            keys: { stripeSessionId: 1 },
            options: { name: "idx_txn_stripeSessionId" },
        },
        {
            collection: transactionsCollection,
            keys: { stripeSubscriptionId: 1 },
            options: { name: "idx_txn_stripeSubscriptionId" },
        },
        {
            collection: transactionsCollection,
            keys: { status: 1 },
            options: { name: "idx_txn_status" },
        },
    ];

    // Initialize all regular indexes.
    for (const spec of indexSpecs) {
        if (spec.options.name === "idx_txn_stripeSessionId") {
            continue;
        }

        await spec.collection.createIndex(spec.keys, spec.options);
    }

    // Check the existing Stripe session index.
    const existingIndexes = await transactionsCollection
        .listIndexes()
        .toArray();

    const existingSessionIndex = existingIndexes.find(
        (index) => index.name === "idx_txn_stripeSessionId"
    );

    if (existingSessionIndex?.unique !== true) {
        // Detect duplicate non-empty string session IDs.
        const hasDuplicates = await transactionsCollection
            .aggregate([
                {
                    $match: {
                        stripeSessionId: { $type: "string" },
                    },
                },
                {
                    $group: {
                        _id: "$stripeSessionId",
                        count: { $sum: 1 },
                    },
                },
                {
                    $match: {
                        count: { $gt: 1 },
                    },
                },
                { $limit: 1 },
            ])
            .hasNext();

        if (hasDuplicates) {
            throw new Error(
                "Duplicate Stripe session IDs found. " +
                    "Resolve them manually before creating the unique index. " +
                    "No transaction records were deleted."
            );
        }

        // Remove only the old non-unique index.
        // Existing transaction documents remain untouched.
        if (existingSessionIndex) {
            await transactionsCollection.dropIndex(
                "idx_txn_stripeSessionId"
            );
        }

        // Create a unique partial index.
        await transactionsCollection.createIndex(
            { stripeSessionId: 1 },
            {
                name: "idx_txn_stripeSessionId",
                unique: true,
                partialFilterExpression: {
                    stripeSessionId: { $type: "string" },
                },
            }
        );
    }
}

try {
    await initializeIndexes();
    console.log("All 12 approved indexes initialized successfully");
} catch (err) {
    console.error("Failed to initialize required indexes:", err.message);
    process.exit(1);
}

// API routes
app.use("/api/services", serviceRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/subscriptions", subscriptionRoutes);

// Health check
app.get("/", (req, res) => {
    res.send("Wedplan server is running on localhost:5000");
});

// Handle unknown routes
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: "API route not found.",
    });
});

// Central error handler
app.use((err, req, res, next) => {
    console.error("Server error:", err.message);

    if (res.headersSent) {
        return next(err);
    }

    res.status(500).json({
        success: false,
        message: "Internal server error.",
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`Wedplan server is running on port ${PORT}`);
});

export { client, db };
