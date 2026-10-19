import dashboardService from '../services/dashboardService.js';

/**
 * Dashboard Controller - Handles requests for authenticated user dashboard data
 */

/**
 * Get consolidated dashboard metrics for the authenticated user
 * @route GET /api/v1/dashboard
 */
export const getDashboard = async (req, res, next) => {
  try {
    const userId = req.user._id;

    const data = await dashboardService.getUserDashboard(userId);

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }
    next(error);
  }
};

export default {
  getDashboard,
};
