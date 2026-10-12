# TreadExMine

Modern Trading & Investment Platform

Features:
- User Authentication
- Investment Plans
- Referral System
- Wallet Management
- Withdraw Requests
- Admin Panel

Tech Stack:
- React
- Node.js
- Express
- MongoDB

## Backend Foundation Complete

The server architecture foundation has been established with enterprise-grade modular structure:

### Architecture Structure
```
server/src
├── config          # Database connection (config/db.js)
├── controllers     # Route controllers (healthController.js, auth/)
├── middleware      # Global error, 404, and protect middlewares
├── models          # Data schema definitions (User.js)
├── routes          # API versioning router (/api/v1), health, and auth routes
├── services        # Business domain services (barrel export)
├── repositories    # Data persistence abstractions (barrel export)
├── validators      # Schema validation layer (authValidators.js)
├── utils           # Utility functions & tokenService.js
├── constants       # Centralized HTTP status codes & constants
├── app.js          # Express app configuration & middleware pipeline
└── server.js       # Server bootstrap, MongoDB lifecycle & graceful shutdown
```

### Security & Middlewares
- **Security Headers**: `helmet`
- **CORS**: `cors` with configurable client origin
- **Rate Limiting**: `express-rate-limit` protecting `/api` endpoints
- **Logging**: `morgan` (dev / production formatting)
- **Cookie Parsing**: `cookie-parser`
- **Body Parsing**: JSON and URL-encoded parsers

---

## Authentication Foundation Complete

Enterprise-grade authentication architecture implemented with JSON Web Tokens (Access + Refresh tokens) and bcryptjs hashing.

### User Model Specifications
- `name`: String, required, trimmed (2-60 chars)
- `email`: String, required, unique, validated email format
- `password`: String, required, min 6 chars, hashed via bcryptjs pre-save hook, omitted by default from queries (`select: false`)
- `role`: Enum `['user', 'admin']`, default: `'user'`
- `isVerified`: Boolean, default: `false`
- `referralCode`: Alphanumeric unique code, auto-generated on user creation
- `referredBy`: Optional referral code of inviter
- `timestamps`: `createdAt`, `updatedAt`

### Token Lifecycles
- **Access Token**: 15 minutes (`15m`)
- **Refresh Token**: 7 days (`7d`) with HTTP-Only secure cookie storage

### Authentication Endpoints
- `POST /api/v1/auth/register` - Register a new user and generate token pair
- `POST /api/v1/auth/login` - Authenticate with email & password
- `POST /api/v1/auth/refresh` - Refresh access token via cookie or request body
- `POST /api/v1/auth/logout` - Clear refresh cookie and terminate session
- `GET /api/v1/auth/me` - Protected endpoint returning authenticated user profile