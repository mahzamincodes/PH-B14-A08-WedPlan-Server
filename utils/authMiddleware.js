
import { createHmac, timingSafeEqual } from "node:crypto";
import { isValidObjectId, toObjectId } from "./dbUtils.js";

function unauthorized(res) {
    return res.status(401).json({
        error: "unauthenticated",
        message: "Authentication required.",
    });
}

/**
 * Verify JWT and load the authoritative user from MongoDB.
 */
export async function authenticateToken(req, res, next) {
    try {
        const authorization = req.headers.authorization;

        if (
            typeof authorization !== "string" ||
            !authorization.startsWith("Bearer ")
        ) {
            return unauthorized(res);
        }

        const token = authorization.slice(7).trim();
        const parts = token.split(".");

        if (
            parts.length !== 3 ||
            parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))
        ) {
            return unauthorized(res);
        }

        const [encodedHeader, encodedPayload, encodedSignature] = parts;

        let header;
        let payload;

        try {
            header = JSON.parse(
                Buffer.from(encodedHeader, "base64url").toString("utf8")
            );

            payload = JSON.parse(
                Buffer.from(encodedPayload, "base64url").toString("utf8")
            );
        } catch {
            return unauthorized(res);
        }

        if (
            !header ||
            header.alg !== "HS256" ||
            header.typ !== "JWT" ||
            !payload ||
            typeof payload !== "object" ||
            Array.isArray(payload)
        ) {
            return unauthorized(res);
        }

        const secret = process.env.JWT_SECRET;
        const issuer = process.env.JWT_ISSUER;
        const audience = process.env.JWT_AUDIENCE;

        if (
            !secret ||
            Buffer.byteLength(secret, "utf8") < 32 ||
            !issuer ||
            !audience
        ) {
            return res.status(500).json({
                error: "internal",
                message: "Authentication configuration error.",
            });
        }

        // Verify JWT signature using constant-time comparison.
        const signingInput = `${encodedHeader}.${encodedPayload}`;

        const expectedSignature = createHmac("sha256", secret)
            .update(signingInput, "utf8")
            .digest();

        const receivedSignature = Buffer.from(
            encodedSignature,
            "base64url"
        );

        if (
            receivedSignature.length !== expectedSignature.length ||
            !timingSafeEqual(receivedSignature, expectedSignature)
        ) {
            return unauthorized(res);
        }

        // Validate JWT claims.
        const now = Math.floor(Date.now() / 1000);

        if (
            typeof payload.sub !== "string" ||
            !isValidObjectId(payload.sub) ||
            payload.iss !== issuer ||
            payload.aud !== audience ||
            !Number.isSafeInteger(payload.iat) ||
            !Number.isSafeInteger(payload.exp) ||
            payload.iat > now + 30 ||
            payload.exp <= now ||
            payload.exp <= payload.iat
        ) {
            return unauthorized(res);
        }

        // Access the existing users collection through Express app locals.
        const usersCollection = req.app.locals.usersCollection;

        if (!usersCollection) {
            throw new Error("Users collection is not available.");
        }

        // Always load the authoritative user from MongoDB.
        const user = await usersCollection.findOne(
            { _id: toObjectId(payload.sub) },
            {
                projection: {
                    role: 1,
                    isBlocked: 1,
                },
            }
        );

        if (!user) {
            return unauthorized(res);
        }

        if (user.isBlocked === true) {
            return res.status(403).json({
                error: "forbidden",
                message: "Your account is blocked.",
            });
        }

        req.user = {
            id: user._id.toHexString(),
            role: user.role,
        };

        next();
    } catch (error) {
        next(error);
    }
}

/**
 * Restrict access to specific user roles.
 * Must be used after authenticateToken.
 */
export function authorizeRoles(...allowedRoles) {
    return (req, res, next) => {
        if (!req.user || !allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                error: "forbidden",
                message: "You do not have permission to perform this action.",
            });
        }

        next();
    };
}
