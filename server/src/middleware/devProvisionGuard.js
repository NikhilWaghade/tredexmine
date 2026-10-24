import crypto from 'crypto';

/**
 * Middleware to protect the development-only admin provisioning endpoint.
 *
 * Strict Security Rules:
 * 1. Permanently disabled in production (returns HTTP 404 mimicking a non-existent route)
 * 2. Requires DEV_ADMIN_PROVISION_SECRET configured in environment (minimum 32 characters)
 * 3. Requires x-dev-provision-secret header from client
 * 4. Compares secrets in constant time using crypto.timingSafeEqual over sha256 digests
 * 5. Never logs or echoes the secret
 */
export const devProvisionGuard = (req, res, next) => {
  // 1. Permanently blocked in production
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({
      success: false,
      message: 'Endpoint not found',
    });
  }

  const serverSecret = process.env.DEV_ADMIN_PROVISION_SECRET;

  // 2. Reject if provisioning secret is not configured or too weak
  if (!serverSecret || typeof serverSecret !== 'string' || serverSecret.length < 32) {
    return res.status(403).json({
      success: false,
      message: 'Development admin provisioning is disabled. Configure a strong DEV_ADMIN_PROVISION_SECRET (minimum 32 characters) in server/.env.',
    });
  }

  const clientSecret = req.headers['x-dev-provision-secret'];

  // 3. Reject if client header is missing or invalid
  if (!clientSecret || typeof clientSecret !== 'string') {
    return res.status(403).json({
      success: false,
      message: 'Access forbidden: Missing x-dev-provision-secret header',
    });
  }

  // 4. Secure constant-time comparison using sha256 digests to prevent timing leaks
  const serverDigest = crypto.createHash('sha256').update(serverSecret).digest();
  const clientDigest = crypto.createHash('sha256').update(clientSecret).digest();

  if (!crypto.timingSafeEqual(serverDigest, clientDigest)) {
    return res.status(403).json({
      success: false,
      message: 'Access forbidden: Invalid provisioning secret',
    });
  }

  next();
};

export default devProvisionGuard;
