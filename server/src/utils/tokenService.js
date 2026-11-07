import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';

const ACCESS_TOKEN_EXPIRY = '15m'; // 15 minutes
const REFRESH_TOKEN_EXPIRY = '7d';  // 7 days

export const VALID_NODE_ENVS = new Set(['development', 'test', 'production']);

export const KNOWN_DEV_PLACEHOLDERS = new Set([
  'dev_jwt_secret_key_treadexmine_2026',
  'dev_jwt_refresh_secret_key_treadexmine_2026',
  'your_jwt_secret_key_here',
  'your_jwt_refresh_secret_key_here',
  'your_jwt_secret_key_minimum_32_characters_here',
  'your_jwt_refresh_secret_minimum_32_characters_here',
  'jwt_secret',
  'jwt_refresh_secret',
  'placeholder',
  'change_me',
  'secret',
  'test_secret',
  'undefined',
  'null',
]);

export const DEV_DEFAULT_ACCESS_SECRET = 'dev_jwt_secret_key_treadexmine_2026';
export const DEV_DEFAULT_REFRESH_SECRET = 'dev_jwt_refresh_secret_key_treadexmine_2026';

/**
 * Validates the runtime environment and JWT secret configuration.
 * Fails fast and throws a security error if:
 * 1. NODE_ENV is misspelled or unrecognized.
 * 2. In production, either JWT_SECRET or JWT_REFRESH_SECRET is missing, too short (< 32 chars),
 *    equals a known development placeholder, or both secrets are identical.
 *
 * Secrets are NEVER interpolated into thrown error messages or logs.
 *
 * @param {Object} [env=process.env]
 * @returns {{ nodeEnv: string, jwtSecret: string, jwtRefreshSecret: string }}
 */
export const validateJwtConfig = (env = process.env) => {
  const rawNodeEnv = env.NODE_ENV;
  let effectiveEnv = 'development';

  if (rawNodeEnv !== undefined && rawNodeEnv !== null && String(rawNodeEnv).trim() !== '') {
    const trimmedEnv = String(rawNodeEnv).trim().toLowerCase();
    if (!VALID_NODE_ENVS.has(trimmedEnv)) {
      const error = new Error(
        `[SECURITY ERROR] Invalid NODE_ENV: "${rawNodeEnv}". Allowed environments are: "development", "test", "production". Unknown environments are blocked to prevent insecure defaults.`
      );
      error.code = 'ERR_INVALID_NODE_ENV';
      throw error;
    }
    effectiveEnv = trimmedEnv;
  }

  const rawSecret = env.JWT_SECRET;
  const rawRefreshSecret = env.JWT_REFRESH_SECRET;

  if (effectiveEnv === 'production') {
    // 1. Validate JWT_SECRET
    if (!rawSecret || typeof rawSecret !== 'string' || rawSecret.trim().length === 0) {
      const error = new Error(
        '[SECURITY ERROR] JWT_SECRET is required in production environment. Configure a strong secret (minimum 32 characters) in environment variables.'
      );
      error.code = 'ERR_JWT_SECRET_MISSING';
      throw error;
    }

    const trimmedSecret = rawSecret.trim();
    if (trimmedSecret.length < 32) {
      const error = new Error(
        '[SECURITY ERROR] Production JWT_SECRET is too weak. Secret must be at least 32 characters long.'
      );
      error.code = 'ERR_JWT_SECRET_WEAK';
      throw error;
    }

    const lowerSecret = trimmedSecret.toLowerCase();
    if (
      KNOWN_DEV_PLACEHOLDERS.has(lowerSecret) ||
      lowerSecret.includes('placeholder') ||
      lowerSecret.includes('change_me') ||
      lowerSecret.includes('your_jwt')
    ) {
      const error = new Error(
        '[SECURITY ERROR] Production JWT_SECRET cannot use default development placeholders or sample keys.'
      );
      error.code = 'ERR_JWT_SECRET_PLACEHOLDER';
      throw error;
    }

    // 2. Validate JWT_REFRESH_SECRET
    if (!rawRefreshSecret || typeof rawRefreshSecret !== 'string' || rawRefreshSecret.trim().length === 0) {
      const error = new Error(
        '[SECURITY ERROR] JWT_REFRESH_SECRET is required in production environment. Configure a strong distinct secret (minimum 32 characters) in environment variables.'
      );
      error.code = 'ERR_JWT_REFRESH_SECRET_MISSING';
      throw error;
    }

    const trimmedRefreshSecret = rawRefreshSecret.trim();
    if (trimmedRefreshSecret.length < 32) {
      const error = new Error(
        '[SECURITY ERROR] Production JWT_REFRESH_SECRET is too weak. Secret must be at least 32 characters long.'
      );
      error.code = 'ERR_JWT_REFRESH_SECRET_WEAK';
      throw error;
    }

    const lowerRefreshSecret = trimmedRefreshSecret.toLowerCase();
    if (
      KNOWN_DEV_PLACEHOLDERS.has(lowerRefreshSecret) ||
      lowerRefreshSecret.includes('placeholder') ||
      lowerRefreshSecret.includes('change_me') ||
      lowerRefreshSecret.includes('your_jwt')
    ) {
      const error = new Error(
        '[SECURITY ERROR] Production JWT_REFRESH_SECRET cannot use default development placeholders or sample keys.'
      );
      error.code = 'ERR_JWT_REFRESH_SECRET_PLACEHOLDER';
      throw error;
    }

    // 3. Ensure access secret and refresh secret are distinct
    if (trimmedSecret === trimmedRefreshSecret) {
      const error = new Error(
        '[SECURITY ERROR] JWT_SECRET and JWT_REFRESH_SECRET must be distinct secrets in production.'
      );
      error.code = 'ERR_JWT_SECRETS_IDENTICAL';
      throw error;
    }

    return {
      nodeEnv: effectiveEnv,
      jwtSecret: trimmedSecret,
      jwtRefreshSecret: trimmedRefreshSecret,
    };
  }

  // Development & Test environments
  const devSecret =
    rawSecret && typeof rawSecret === 'string' && rawSecret.trim().length > 0
      ? rawSecret.trim()
      : DEV_DEFAULT_ACCESS_SECRET;

  const devRefreshSecret =
    rawRefreshSecret && typeof rawRefreshSecret === 'string' && rawRefreshSecret.trim().length > 0
      ? rawRefreshSecret.trim()
      : DEV_DEFAULT_REFRESH_SECRET;

  return {
    nodeEnv: effectiveEnv,
    jwtSecret: devSecret,
    jwtRefreshSecret: devRefreshSecret,
  };
};

/**
 * Retrieve validated JWT access secret
 * @param {Object} [env=process.env]
 * @returns {string}
 */
export const getJwtSecret = (env = process.env) => {
  return validateJwtConfig(env).jwtSecret;
};

/**
 * Retrieve validated JWT refresh secret
 * @param {Object} [env=process.env]
 * @returns {string}
 */
export const getJwtRefreshSecret = (env = process.env) => {
  return validateJwtConfig(env).jwtRefreshSecret;
};

/**
 * Generate a short-lived JWT Access Token (15m)
 * @param {Object} payload - User identification payload { id, role }
 * @param {Object} [env=process.env]
 * @returns {string} Signed JWT Access Token
 */
export const generateAccessToken = (payload, env = process.env) => {
  const secret = getJwtSecret(env);
  return jwt.sign(payload, secret, { expiresIn: ACCESS_TOKEN_EXPIRY });
};

/**
 * Generate a long-lived JWT Refresh Token (7d)
 * @param {Object} payload - User identification payload { id }
 * @param {Object} [env=process.env]
 * @returns {string} Signed JWT Refresh Token
 */
export const generateRefreshToken = (payload, env = process.env) => {
  const secret = getJwtRefreshSecret(env);
  const nonce = crypto.randomBytes(16).toString('hex');
  return jwt.sign({ ...payload, jti: nonce }, secret, { expiresIn: REFRESH_TOKEN_EXPIRY });
};

/**
 * Verify JWT Access Token
 * @param {string} token
 * @param {Object} [env=process.env]
 * @returns {Object} Decoded token payload
 */
export const verifyAccessToken = (token, env = process.env) => {
  const secret = getJwtSecret(env);
  return jwt.verify(token, secret);
};

/**
 * Verify JWT Refresh Token
 * @param {string} token
 * @param {Object} [env=process.env]
 * @returns {Object} Decoded token payload
 */
export const verifyRefreshToken = (token, env = process.env) => {
  const secret = getJwtRefreshSecret(env);
  return jwt.verify(token, secret);
};

/**
 * Computes a deterministic SHA-256 cryptographic hash of a raw refresh token.
 * Raw refresh tokens are never persisted in the database or logged.
 * @param {string} token - Raw refresh token string
 * @returns {string} SHA-256 hex digest
 */
export const hashToken = (token) => {
  if (!token || typeof token !== 'string') return '';
  return crypto.createHash('sha256').update(token.trim()).digest('hex');
};

/**
 * Returns standardized, hardened cookie options for refresh tokens.
 * Restricted to path: '/api/v1/auth' to prevent leaking cookies on ordinary API calls.
 * @param {Object} [overrides={}]
 * @returns {Object} Cookie options
 */
export const getRefreshCookieOptions = (overrides = {}) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/api/v1/auth',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
  ...overrides,
});

/**
 * Generate both access and refresh tokens for a user
 * @param {Object} user - User document or object with _id and role
 * @param {Object} [env=process.env]
 * @param {Object} [options={}]
 * @returns {Object} { accessToken, refreshToken, family }
 */
export const generateAuthTokens = (user, env = process.env, options = {}) => {
  const family = options.family || crypto.randomUUID();
  const accessToken = generateAccessToken(
    {
      id: user._id,
      role: user.role,
    },
    env
  );

  const refreshToken = generateRefreshToken(
    {
      id: user._id,
      family,
    },
    env
  );

  return { accessToken, refreshToken, family };
};

export default {
  VALID_NODE_ENVS,
  KNOWN_DEV_PLACEHOLDERS,
  validateJwtConfig,
  getJwtSecret,
  getJwtRefreshSecret,
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  generateAuthTokens,
  hashToken,
  getRefreshCookieOptions,
};
