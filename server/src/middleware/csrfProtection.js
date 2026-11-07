/**
 * CSRF Protection Middleware for Cookie-based Authentication Endpoints (/refresh, /logout)
 *
 * Enforces defense-in-depth:
 * 1. Blocks cross-site requests via Sec-Fetch-Site fetch metadata.
 * 2. Strictly validates Origin and Referer headers against permitted frontend origins.
 * 3. Permits non-browser programmatic clients (CLI tools, server-to-server, test runner).
 */

const getAllowedOrigins = () => {
  const allowed = new Set();

  if (process.env.CLIENT_URL) {
    try {
      allowed.add(new URL(process.env.CLIENT_URL).origin.toLowerCase());
    } catch (_) {
      allowed.add(process.env.CLIENT_URL.toLowerCase());
    }
  }

  // Standard development and local container origins
  allowed.add('http://localhost:5173');
  allowed.add('http://127.0.0.1:5173');
  allowed.add('http://localhost:8080');
  allowed.add('http://127.0.0.1:8080');
  allowed.add('http://localhost:5000');
  allowed.add('http://127.0.0.1:5000');

  if (process.env.PORT) {
    allowed.add(`http://localhost:${process.env.PORT}`);
    allowed.add(`http://127.0.0.1:${process.env.PORT}`);
  }

  return allowed;
};

/**
 * Validate incoming request for CSRF indicators
 */
export const validateAuthCsrf = (req, res, next) => {
  // 1. Check Fetch Metadata (Sec-Fetch-Site)
  const secFetchSite = req.headers['sec-fetch-site'];
  if (secFetchSite && secFetchSite.toLowerCase() === 'cross-site') {
    return res.status(403).json({
      success: false,
      message: '[SECURITY ERROR] Cross-site request blocked by CSRF protection',
    });
  }

  const allowedOrigins = getAllowedOrigins();

  // 2. Validate Origin header if present (browsers always send this on POST)
  const origin = req.headers.origin;
  if (origin && typeof origin === 'string' && origin.trim() !== '') {
    const normalizedOrigin = origin.trim().toLowerCase();
    if (!allowedOrigins.has(normalizedOrigin)) {
      return res.status(403).json({
        success: false,
        message: '[SECURITY ERROR] Request Origin is not authorized by CSRF policy',
      });
    }
    return next();
  }

  // 3. Fallback to Referer header if Origin is omitted
  const referer = req.headers.referer;
  if (referer && typeof referer === 'string' && referer.trim() !== '') {
    try {
      const refererOrigin = new URL(referer).origin.toLowerCase();
      if (!allowedOrigins.has(refererOrigin)) {
        return res.status(403).json({
          success: false,
          message: '[SECURITY ERROR] Request Referer is not authorized by CSRF policy',
        });
      }
    } catch (_) {
      return res.status(403).json({
        success: false,
        message: '[SECURITY ERROR] Malformed Referer header blocked by CSRF policy',
      });
    }
    return next();
  }

  // 4. Non-browser programmatic requests without Origin/Referer (e.g. Node tests, curl) are permitted
  next();
};

export default validateAuthCsrf;
