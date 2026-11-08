import api from './api';

/**
 * Get referral summary and aggregate statistics for current authenticated user
 * @returns {Promise<{ success: boolean, data: Object }>}
 */
export const getMyReferrals = async () => {
  const response = await api.get('/referrals/me');
  return response.data;
};

/**
 * Get paginated referral history for current authenticated user
 * @param {Object} [params]
 * @param {number} [params.page=1]
 * @param {number} [params.limit=20]
 * @returns {Promise<{ success: boolean, data: Object }>}
 */
export const getReferralHistory = async (params = {}) => {
  const response = await api.get('/referrals/history', { params });
  return response.data;
};

/**
 * Validate a referral code publicly
 * @param {string} code
 * @returns {Promise<{ success: boolean, data: Object }>}
 */
export const validateReferralCode = async (code) => {
  if (!code || typeof code !== 'string') {
    return { success: false, message: 'Referral code is required' };
  }
  const response = await api.get(`/referrals/validate/${encodeURIComponent(code.trim().toUpperCase())}`);
  return response.data;
};

export const referralService = {
  getMyReferrals,
  getReferralHistory,
  validateReferralCode,
};

export default referralService;
