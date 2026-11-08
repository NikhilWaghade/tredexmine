/**
 * ============================================================================
 * FINANCIAL ENDPOINT RATE LIMITERS
 * ============================================================================
 *
 * Layered, per-route rate limits that sit on top of the global 100 req/15 min
 * limiter defined in app.js.  The webhook endpoint intentionally carries NO
 * additional limit so that payment providers are never throttled.
 *
 * Limits (per IP):
 *   financialLimiter      — 10 requests / 15 min  (user deposit / withdraw)
 *   adminReconcileLimiter — 20 requests / 15 min  (admin reconcile / resolve)
 *
 * Non-production environments: limiters are transparent pass-throughs so that
 * automated test suites never hit 429 due to shared in-memory counter state.
 * Production enforcement is preserved because `skip` evaluates `process.env`
 * lazily at request time, not at module load time.
 * ============================================================================
 */

import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

const FINANCIAL_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

/** Returns true when this request should bypass rate limiting (non-production). */
const skipNonProduction = () => process.env.NODE_ENV !== 'production';

/**
 * Key generator prioritizing authenticated identity (User ID / Admin ID)
 * and falling back cleanly to client IP via express-rate-limit's IPv6 helper.
 * This ensures unrelated users sharing an institutional/NAT proxy IP are never
 * accidentally throttled by another user's activity.
 */
export const financialKeyGenerator = (req) => {
  if (req.user && req.user._id) {
    return `user_${String(req.user._id)}`;
  }
  return ipKeyGenerator(req);
};

export const adminKeyGenerator = (req) => {
  if (req.user && req.user._id) {
    return `admin_${String(req.user._id)}`;
  }
  return ipKeyGenerator(req);
};

/**
 * Strict limiter for user-facing financial mutation endpoints:
 *   POST /deposit/intent  POST /deposit/verify  POST /withdraw
 *   POST /create-order    POST /verify
 *
 * 10 requests per 15 minutes per authenticated user (or per IP if unauthenticated).
 */
export const financialLimiter = rateLimit({
  windowMs: FINANCIAL_WINDOW_MS,
  max: 10,
  keyGenerator: financialKeyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipNonProduction,
  message: {
    success: false,
    message: 'Too many financial requests, please try again after 15 minutes.',
  },
});

/**
 * Moderate limiter for admin reconciliation endpoints:
 *   POST /admin/webhooks/:id/reconcile
 *   POST /admin/webhooks/:id/resolve-quarantine
 *   POST /admin/webhooks/:id/reconcile-request
 *   POST /admin/reconcile-requests/:id/approve
 *   POST /admin/reconcile-requests/:id/reject
 *
 * 20 requests per 15 minutes per authenticated admin (or per IP).
 */
export const adminReconcileLimiter = rateLimit({
  windowMs: FINANCIAL_WINDOW_MS,
  max: 20,
  keyGenerator: adminKeyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipNonProduction,
  message: {
    success: false,
    message: 'Too many admin reconciliation requests, please try again after 15 minutes.',
  },
});

/**
 * Public referral code validation limiter:
 *   GET /api/v1/referrals/validate/:code
 *
 * 30 requests per 15 minutes per IP to mitigate enumeration attacks.
 */
export const referralValidationLimiter = rateLimit({
  windowMs: FINANCIAL_WINDOW_MS,
  max: 30,
  keyGenerator: ipKeyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipNonProduction,
  message: {
    success: false,
    message: 'Too many referral code validation attempts, please try again after 15 minutes.',
  },
});

export default {
  financialLimiter,
  adminReconcileLimiter,
  referralValidationLimiter,
  financialKeyGenerator,
  adminKeyGenerator,
};
