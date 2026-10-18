/**
 * Role-based authorization middleware
 * Verifies that the authenticated user has one of the allowed roles
 *
 * @param {...string} allowedRoles - List of permitted roles (e.g. 'admin')
 * @returns {Function} Express middleware function
 */
export const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    // 1. Ensure user has been authenticated by prior protect middleware
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized, user authentication required',
      });
    }

    // 2. Check if the user's role is permitted
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: insufficient permissions',
      });
    }

    next();
  };
};

export default authorize;
