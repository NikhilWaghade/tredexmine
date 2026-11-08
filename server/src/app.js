import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';

import apiRoutes from './routes/index.js';
import { notFoundMiddleware, errorMiddleware } from './middleware/index.js';

const app = express();

// Trust reverse proxy (e.g. AWS ALB, Cloudflare, NGINX) in production/staging
// Ensures req.ip accurately reflects the true client IP via X-Forwarded-For
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// Security HTTP headers
app.use(helmet());

/**
 * CORS Allow-list
 *
 * Supports multiple origins via CLIENT_URL and STAGING_CLIENT_URL env vars.
 * Development localhost origins are always included.
 *
 * Cookie sameSite is 'lax' (not 'strict') by design:
 *   'strict' would break OAuth redirect flows and cross-tab navigation because
 *   browsers strip same-site=strict cookies on top-level cross-site navigations,
 *   meaning users landing from email links or OAuth providers would lose their
 *   session.  'lax' provides CSRF protection for state-mutating methods (POST,
 *   PATCH, DELETE) while allowing safe top-level navigations.
 */
const getAllowedOrigins = () => {
  const origins = new Set(['http://localhost:5173', 'http://127.0.0.1:5173']);
  if (process.env.CLIENT_URL) origins.add(process.env.CLIENT_URL.trim());
  if (process.env.STAGING_CLIENT_URL) origins.add(process.env.STAGING_CLIENT_URL.trim());
  return origins;
};

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow server-to-server requests (no Origin header)
      if (!origin) return callback(null, true);
      if (getAllowedOrigins().has(origin)) return callback(null, true);
      const corsErr = new Error(`CORS policy: origin '${origin}' is not allowed`);
      corsErr.statusCode = 403;
      callback(corsErr);
    },
    credentials: true,
  })
);

// HTTP request logging
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
}

// Request Rate Limiting
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  // Skip rate limiting in non-production environments (prevents shared in-memory counter collisions in tests)
  skip: () => process.env.NODE_ENV !== 'production', message: {
    success: false,
    message: 'Too many requests from this IP, please try again after 15 minutes.',
  },
});
app.use('/api', globalLimiter);

// Body Parsers & Cookie Parser
app.use(
  express.json({
    limit: '10mb',
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);


app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());


app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "TreadExMine API is running",
  });
});

// Mount API v1 Routes
app.use('/api/v1', apiRoutes);

// Fallback 404 Route Handler
app.use(notFoundMiddleware);

// Global Error Handler
app.use(errorMiddleware);

export default app;
