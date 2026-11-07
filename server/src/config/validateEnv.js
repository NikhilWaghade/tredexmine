/**
 * ============================================================================
 * PRODUCTION ENVIRONMENT VALIDATOR
 * ============================================================================
 *
 * Validates all required environment variables before the server accepts any
 * traffic.  Fails fast (throws) when any critical variable is absent or weak
 * so that misconfigured deployments never silently enter a degraded state.
 *
 * Invariants:
 * - Secret *values* are NEVER interpolated into error messages or logs.
 * - All checks are additive: every violation is collected before throwing.
 * - Only the PRODUCTION environment enforces strength requirements; development
 *   and test environments receive informational warnings only.
 * ============================================================================
 */

const PROD = 'production';

/** Known placeholder strings that must never appear in production secrets. */
const PLACEHOLDER_PATTERNS = [
  'placeholder',
  'change_me',
  'your_',
  'rzp_test_',
  'test_secret',
];

/**
 * Returns true when the value looks like a placeholder.
 * Matches only on well-known placeholder conventions, not generic words.
 * @param {string} value
 */
const isPlaceholder = (value) => {
  const lower = value.toLowerCase();
  return PLACEHOLDER_PATTERNS.some((p) => lower.includes(p));
};

/**
 * Validate all required environment variables for production.
 *
 * @param {Object} [env=process.env]
 * @throws {Error} Aggregate error listing all violations; code = 'ERR_ENV_INVALID'
 */
export const validateProductionEnv = (env = process.env) => {
  const nodeEnv = String(env.NODE_ENV || '').trim().toLowerCase();

  // Only enforce strict rules in production.
  if (nodeEnv !== PROD) return;

  const errors = [];

  // ── MongoDB ────────────────────────────────────────────────────────────────
  const mongoUri = env.MONGODB_URI;
  if (!mongoUri || !String(mongoUri).trim()) {
    errors.push('[ERR_MONGODB_URI_MISSING] MONGODB_URI is required in production.');
  }

  // ── Razorpay ───────────────────────────────────────────────────────────────
  const rzpKeyId = env.RAZORPAY_KEY_ID;
  const rzpKeySecret = env.RAZORPAY_KEY_SECRET;
  const rzpWebhookSecret = env.RAZORPAY_WEBHOOK_SECRET;

  if (!rzpKeyId || !String(rzpKeyId).trim()) {
    errors.push('[ERR_RAZORPAY_CONFIG_MISSING] RAZORPAY_KEY_ID is required in production.');
  } else if (isPlaceholder(String(rzpKeyId))) {
    errors.push('[ERR_RAZORPAY_CONFIG_PLACEHOLDER] RAZORPAY_KEY_ID must not use a placeholder value in production.');
  }

  if (!rzpKeySecret || !String(rzpKeySecret).trim()) {
    errors.push('[ERR_RAZORPAY_CONFIG_MISSING] RAZORPAY_KEY_SECRET is required in production.');
  } else if (isPlaceholder(String(rzpKeySecret))) {
    errors.push('[ERR_RAZORPAY_CONFIG_PLACEHOLDER] RAZORPAY_KEY_SECRET must not use a placeholder value in production.');
  }

  if (!rzpWebhookSecret || !String(rzpWebhookSecret).trim()) {
    errors.push('[ERR_WEBHOOK_SECRET_MISSING] RAZORPAY_WEBHOOK_SECRET is required in production.');
  } else {
    const trimmed = String(rzpWebhookSecret).trim();
    if (trimmed.length < 32) {
      errors.push(
        `[ERR_WEBHOOK_SECRET_WEAK] RAZORPAY_WEBHOOK_SECRET must be at least 32 characters in production (current: ${trimmed.length} chars).`
      );
    }
    if (isPlaceholder(trimmed)) {
      errors.push('[ERR_WEBHOOK_SECRET_PLACEHOLDER] RAZORPAY_WEBHOOK_SECRET must not use a placeholder value in production.');
    }
  }

  // ── CLIENT_URL ─────────────────────────────────────────────────────────────
  const clientUrl = env.CLIENT_URL;
  if (!clientUrl || !String(clientUrl).trim()) {
    errors.push('[ERR_CLIENT_URL_MISSING] CLIENT_URL is required in production (used for CORS allow-list).');
  }

  // ── Aggregate and throw ───────────────────────────────────────────────────
  if (errors.length > 0) {
    const message = [
      `[SECURITY ERROR] ${errors.length} environment configuration violation(s) detected. Server startup aborted.`,
      ...errors.map((e, i) => `  ${i + 1}. ${e}`),
    ].join('\n');
    const error = new Error(message);
    error.code = 'ERR_ENV_INVALID';
    throw error;
  }
};

export default { validateProductionEnv };
