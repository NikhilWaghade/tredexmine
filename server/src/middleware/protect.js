import { verifyAccessToken } from '../utils/tokenService.js';
import { User } from '../models/User.js';

/**
 * Authentication middleware to protect private endpoints
 * Reads Bearer token from Authorization header or cookie, verifies JWT, and attaches user to req.user
 */
export const protect = async (req, res, next) => {
  let token = null;

  // 1. Check for Bearer token in Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (req.cookies && req.cookies.accessToken) {
    // Optional fallback to cookie
    token = req.cookies.accessToken;
  }

  // 2. Reject if no token is found
  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized, access token missing',
    });
  }

  try {
    // 3. Verify access token
    const decoded = verifyAccessToken(token);

    // 4. Fetch user by decoded ID, excluding password
    const user = await User.findById(decoded.id).select('-password');
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User no longer exists or session has expired',
      });
    }

    // 5. Attach user object to request
    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: error.name === 'TokenExpiredError' 
        ? 'Access token expired, please refresh token' 
        : 'Not authorized, invalid access token',
    });
  }
};

export default protect;
