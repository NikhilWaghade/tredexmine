import jwt from 'jsonwebtoken';

const ACCESS_TOKEN_EXPIRY = '15m'; // 15 minutes
const REFRESH_TOKEN_EXPIRY = '7d';  // 7 days

/**
 * Generate a short-lived JWT Access Token (15m)
 * @param {Object} payload - User identification payload { id, role }
 * @returns {string} Signed JWT Access Token
 */
export const generateAccessToken = (payload) => {
  const secret = process.env.JWT_SECRET || 'dev_jwt_secret_key_treadexmine_2026';
  return jwt.sign(payload, secret, { expiresIn: ACCESS_TOKEN_EXPIRY });
};

/**
 * Generate a long-lived JWT Refresh Token (7d)
 * @param {Object} payload - User identification payload { id }
 * @returns {string} Signed JWT Refresh Token
 */
export const generateRefreshToken = (payload) => {
  const secret = process.env.JWT_REFRESH_SECRET || 'dev_jwt_refresh_secret_key_treadexmine_2026';
  return jwt.sign(payload, secret, { expiresIn: REFRESH_TOKEN_EXPIRY });
};

/**
 * Verify JWT Access Token
 * @param {string} token
 * @returns {Object} Decoded token payload
 */
export const verifyAccessToken = (token) => {
  const secret = process.env.JWT_SECRET || 'dev_jwt_secret_key_treadexmine_2026';
  return jwt.verify(token, secret);
};

/**
 * Verify JWT Refresh Token
 * @param {string} token
 * @returns {Object} Decoded token payload
 */
export const verifyRefreshToken = (token) => {
  const secret = process.env.JWT_REFRESH_SECRET || 'dev_jwt_refresh_secret_key_treadexmine_2026';
  return jwt.verify(token, secret);
};

/**
 * Generate both access and refresh tokens for a user
 * @param {Object} user - User document or object with _id and role
 * @returns {Object} { accessToken, refreshToken }
 */
export const generateAuthTokens = (user) => {
  const accessToken = generateAccessToken({
    id: user._id,
    role: user.role,
  });

  const refreshToken = generateRefreshToken({
    id: user._id,
  });

  return { accessToken, refreshToken };
};

export default {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  generateAuthTokens,
};
