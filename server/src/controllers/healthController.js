/**
 * Health check controller
 * @route GET /api/v1/health
 */
export const getHealthStatus = (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Server Running',
  });
};
