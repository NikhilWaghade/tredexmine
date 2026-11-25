import api from './api';

export const REFERRAL_REWARD_TIERS = [
  { planAmount: 300, rewardAmount: 100, planName: 'Starter' },
  { planAmount: 500, rewardAmount: 150, planName: 'Basic Plus' },
  { planAmount: 1000, rewardAmount: 250, planName: 'Professional' },
  { planAmount: 2000, rewardAmount: 400, planName: 'Advanced' },
  { planAmount: 5000, rewardAmount: 500, planName: 'Premium' },
];

/**
 * Get active referral plan and reward tiers
 * @returns {Promise<{ success: boolean, data: Array }>}
 */
export const getReferralTiers = async () => {
  const response = await api.get('/referrals/tiers');
  return response.data;
};

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
  getReferralTiers,
  REFERRAL_REWARD_TIERS,
};

export default referralService;
