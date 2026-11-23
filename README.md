# WedPlan — Wedding Planning Platform (Server)

WedPlan is the backend application of a full-stack wedding planning platform. It provides secure APIs for customers, vendors, and admins to manage wedding services, booking requests, subscriptions, and platform transactions.

The server is built with Express.js and MongoDB, with JWT-based authentication and role-based authorization to protect application resources.

## Project Repositories

- **Client Repository:** [GitHub Repository]
- **Server Repository:** [GitHub Repository]

## Key Features

### Authentication & Security

- Secure authentication integration with Better Auth.
- JWT-based authentication and token verification.
- Role-based authorization for Admin, Vendor, and Customer.
- Protected API endpoints.
- Server-side role and resource ownership verification.
- Blocked-user access restrictions.
- Request validation and proper HTTP status codes.
- Secure configuration using environment variables.

### User Management

- Manage customer, vendor, and admin information.
- Retrieve user information.
- Block and unblock users.
- Protect user roles and subscription information from unauthorized updates.

### Service Management

- Create wedding service listings.
- Update and delete vendor-owned services.
- Upload service images using ImgBB.
- Manage service approval and availability status.
- Admin service approval and rejection.
- Display only approved and active services publicly.
- Search services by name.
- Filter services by category and location.
- Sort services by price in ascending and descending order.
- Enforce the Free Plan limit of 3 active services.
- Allow Premium vendors to publish unlimited active services.

### Booking Management

- Create customer booking requests.
- Retrieve customer and vendor-specific bookings.
- Accept or reject pending booking requests.
- Allow customers to cancel pending bookings.
- Prevent vendors from modifying other vendors' bookings.
- Prevent customers from modifying other customers' bookings.
- Prevent vendors from booking their own services.
- Prevent duplicate active booking requests for the same service and event date.

### Subscription & Payment

- Stripe Checkout integration.
- Premium subscription management.
- Secure Stripe webhook signature verification.
- Activate Premium access only after verified payment events.
- Store subscription transactions.
- Handle subscription updates and cancellations.
- Prevent unauthorized subscription session creation.

### Admin Management

- Retrieve platform statistics.
- Manage registered users.
- Review and manage submitted services.
- Monitor subscription transactions.
- Prevent manual modification of transaction records to mark unsuccessful payments as successful.

## Technology Stack

- Node.js
- Express.js
- MongoDB
- Better Auth
- JSON Web Token (JWT)
- Stripe Checkout
- Stripe Webhooks
- ImgBB API
- JavaScript

## Installation and Setup

### Prerequisites

- Node.js (LTS recommended)
- npm
- Git
- MongoDB database
- Stripe account for test-mode payment integration
- ImgBB API key

### 1. Clone the Server Repository

```bash id="m2r6e7"
git clone YOUR_SERVER_GITHUB_REPOSITORY_URL
```

### 2. Navigate to the Project Directory

```bash id="0f3v9z"
cd wedplan-server
```

### 3. Install Dependencies

```bash id="x8s4e1"
npm install
```

### 4. Configure Environment Variables

Create a `.env` file in the server project root and configure the following variables:

```env id="c5x2j8"
DB_USER=wedplan
DB_PASSWORD=YOUR_MONGODB_PASSWORD

JWT_SECRET=YOUR_JWT_SECRET
JWT_ISSUER=wedplan-client
JWT_AUDIENCE=wedplan-server

CLIENT_ORIGIN=http://localhost:3000

IMGBB_API_KEY=YOUR_IMGBB_API_KEY

STRIPE_SECRET_KEY=YOUR_STRIPE_SECRET_KEY
STRIPE_PREMIUM_PRICE_ID=YOUR_STRIPE_PREMIUM_PRICE_ID
STRIPE_WEBHOOK_SECRET=YOUR_STRIPE_WEBHOOK_SECRET
```

**Important:**

- Replace placeholder values with your actual credentials.
- Never commit `.env` files to GitHub.
- Never expose Stripe secret keys, webhook secrets, MongoDB passwords, or JWT secrets.
- Use Stripe test-mode credentials during local development and testing.

### 5. Run the Development Server

```bash id="j7w5n3"
npm run dev
```

If the project does not define a development script, start the server using:

```bash id="t3q9p6"
node index.js
```

The server runs on the port configured in the application.

## API Overview

The backend provides APIs for the following application modules:

| Module         | Purpose                                         |
| -------------- | ----------------------------------------------- |
| Authentication | JWT verification and authorization              |
| Users          | User management and profile operations          |
| Services       | Service creation, listing, updating, and review |
| Bookings       | Booking requests and status management          |
| Subscriptions  | Premium subscription management                 |
| Transactions   | Payment transaction records                     |
| Webhooks       | Verified Stripe payment event handling          |

## Database Structure

The application uses MongoDB for persistent data storage.

### Main Collections

**Users**

- Managed by Better Auth.
- Stores user profile, role, account status, and subscription information.

**Services**

- Stores vendor service information.
- Includes service name, category, description, price, location, images, status, and vendor reference.

**Bookings**

- Stores customer booking requests.
- Includes service, vendor, customer, event date, event location, message, and booking status.

**Transactions**

- Stores subscription payment records.
- Includes vendor, plan, amount, currency, Stripe session ID, subscription ID, payment status, and creation date.

## Stripe Webhook Configuration

WedPlan uses Stripe Checkout in test mode for Premium subscriptions.

Configure the webhook endpoint in Stripe CLI or Stripe Dashboard:

```text
POST /api/webhooks/stripe
```

The webhook verifies Stripe signatures before processing payment events.

Supported events include:

- `checkout.session.completed`
- `customer.subscription.updated`
- `customer.subscription.deleted`

Premium access is activated through verified webhook events rather than trusting the frontend payment success redirect.

For local webhook testing, configure the Stripe CLI to forward events to the local backend endpoint.

## Security

- MongoDB credentials are stored in environment variables.
- JWT tokens are verified on protected API routes.
- Role-based middleware protects restricted operations.
- Resource ownership is verified before updates and deletions.
- Blocked users cannot access protected platform features.
- Request data is validated on the server.
- Stripe webhook signatures are verified before processing payment events.
- Secret credentials are excluded from Git.

## Running the Complete Application

To run WedPlan locally:

1. Configure the Server environment variables.
2. Start the MongoDB connection.
3. Run the Express.js backend.
4. Configure the Client environment variables.
5. Start the Next.js frontend.
6. Open the frontend at `http://localhost:3000`.

For frontend installation and setup, see the [Client Repository](YOUR_CLIENT_GITHUB_REPOSITORY_URL).

## Project Status

WedPlan is developed as a full-stack wedding planning platform with separate customer, vendor, and admin functionality, secure backend APIs, booking management, and Stripe-powered Premium subscriptions.
