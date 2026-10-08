/**
 * Middleware for handling routes that do not exist
 */
export const notFoundMiddleware = (req, res, next) => {
  res.status(404).json({
    success: false,
    message: `Resource not found: ${req.method} ${req.originalUrl}`,
  });
};

export default notFoundMiddleware;
