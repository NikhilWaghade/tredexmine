import api from './api';

/**
 * Plan Service - Handles all backend communication for Cloud Mining Plans
 */

/**
 * Fetch all active plans sorted by sortOrder
 * @returns {Promise<{success: boolean, count: number, plans: Array}>}
 */
export const getPlans = async () => {
  const response = await api.get('/plans');
  return response.data;
};

/**
 * Fetch a single active plan by its ID
 * @param {string} id - Plan MongoDB ObjectId
 * @returns {Promise<{success: boolean, plan: Object}>}
 */
export const getPlanById = async (id) => {
  const response = await api.get(`/plans/${id}`);
  return response.data;
};

/**
 * Purchase a plan with optional idempotency key
 * @param {string} id - Plan MongoDB ObjectId
 * @param {Object} [options]
 * @param {string} [options.idempotencyKey] - Optional idempotency key to prevent double charging
 * @returns {Promise<{success: boolean, message: string, data: {userPlan: Object, walletBalance: number}}>}
 */
export const purchasePlan = async (id, options = {}) => {
  const headers = {};
  if (options.idempotencyKey) {
    headers['idempotency-key'] = options.idempotencyKey;
  }

  const response = await api.post(
    `/plans/${id}/purchase`,
    options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {},
    { headers }
  );
  return response.data;
};

/**
 * Fetch active plans subscribed by the authenticated user
 * @returns {Promise<{success: boolean, count: number, userPlans: Array}>}
 */
export const getMyActivePlans = async () => {
  const response = await api.get('/plans/my/active');
  return response.data;
};

/**
 * Create a new plan (Administrator only - server enforces protect, authorize('admin'))
 * @param {Object} planData
 * @returns {Promise<{success: boolean, message: string, plan: Object}>}
 */
export const createPlan = async (planData) => {
  const response = await api.post('/plans', planData);
  return response.data;
};

export default {
  getPlans,
  getPlanById,
  purchasePlan,
  getMyActivePlans,
  createPlan,
};

