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
 * Purchase an active plan using wallet balance with mandatory idempotency key
 * @param {string} id - Plan MongoDB ObjectId
 * @param {Object} [options]
 * @param {string} [options.idempotencyKey] - Unique idempotency key (automatically generated if omitted)
 * @returns {Promise<{success: boolean, message: string, data: {userPlan: Object, walletBalance: number}}>}
 */
export const purchasePlan = async (id, options = {}) => {
  const idempotencyKey =
    options.idempotencyKey ||
    (typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `plan-wallet-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`);

  const headers = {
    'idempotency-key': idempotencyKey,
  };

  const response = await api.post(
    `/plans/${id}/purchase`,
    { idempotencyKey },
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

/**
 * Fetch all plans including inactive ones (Administrator only)
 * @returns {Promise<{success: boolean, count: number, plans: Array}>}
 */
export const getAdminPlans = async () => {
  const response = await api.get('/plans/admin/all');
  return response.data;
};

/**
 * Fetch any plan by ID, even if inactive (Administrator only)
 * @param {string} id
 * @returns {Promise<{success: boolean, plan: Object}>}
 */
export const getAdminPlanById = async (id) => {
  const response = await api.get(`/plans/admin/${id}`);
  return response.data;
};

/**
 * Update an existing plan (Administrator only)
 * @param {string} id
 * @param {Object} updateData
 * @returns {Promise<{success: boolean, message: string, plan: Object}>}
 */
export const updatePlan = async (id, updateData) => {
  const response = await api.put(`/plans/${id}`, updateData);
  return response.data;
};

/**
 * Toggle or update active status of a plan (Administrator only)
 * @param {string} id
 * @param {boolean} [isActive]
 * @returns {Promise<{success: boolean, message: string, plan: Object}>}
 */
export const togglePlanStatus = async (id, isActive) => {
  const response = await api.patch(`/plans/${id}/status`, isActive !== undefined ? { isActive } : {});
  return response.data;
};

export default {
  getPlans,
  getPlanById,
  purchasePlan,
  getMyActivePlans,
  createPlan,
  getAdminPlans,
  getAdminPlanById,
  updatePlan,
  togglePlanStatus,
};

