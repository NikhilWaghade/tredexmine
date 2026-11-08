import {
  getReferralSummary,
  getReferralHistory,
  validateReferralCode,
} from '../services/referralService.js';

/**
 * GET /api/v1/referrals/me
 * Retrieve authenticated user's referral summary, code, link, and aggregate stats
 */
export const getMyReferrals = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const summary = await getReferralSummary(userId);

    return res.status(200).json({
      success: true,
      data: summary,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/referrals/history
 * Retrieve paginated list of users referred by the authenticated user
 */
export const getMyReferralHistory = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { page, limit } = req.query;

    const history = await getReferralHistory(userId, { page, limit });

    return res.status(200).json({
      success: true,
      data: history,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/referrals/validate/:code
 * Publicly validate a referral code and return privacy-safe metadata
 */
export const validateCode = async (req, res, next) => {
  try {
    const { code } = req.params;
    const result = await validateReferralCode(code);

    if (!result.valid) {
      return res.status(404).json({
        success: false,
        message: result.message || 'Invalid referral code',
      });
    }

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

export default {
  getMyReferrals,
  getMyReferralHistory,
  validateCode,
};

