import api from './api';

/**
 * Wallet Service - Handles authenticated user's wallet queries, deposits, withdrawals, and admin review
 */

/**
 * Fetch current authenticated user's wallet
 * @returns {Promise<{success: boolean, wallet: {balance: number, currency: string, pendingWithdrawalAmount?: number, ...}}>}
 */
export const getWallet = async () => {
  const response = await api.get('/wallet');
  return response.data;
};

/**
 * Fetch current authenticated user's transactions
 * @param {Object} [params]
 * @param {number} [params.page]
 * @param {number} [params.limit]
 * @returns {Promise<Object>}
 */
export const getTransactions = async (params = {}) => {
  const response = await api.get('/wallet/transactions', { params });
  return response.data;
};

/**
 * Create deposit intent
 * @param {Object} data
 * @param {number} data.amount
 * @param {string} [data.provider='mock']
 * @param {string} [data.idempotencyKey]
 * @returns {Promise<Object>}
 */
export const createDepositIntent = async (data) => {
  const response = await api.post('/wallet/deposit/intent', data);
  return response.data;
};

/**
 * Verify deposit and credit wallet balance
 * @param {Object} data
 * @param {string} data.depositReference
 * @param {string} [data.orderId]
 * @param {string} [data.paymentId]
 * @param {string} data.signature
 * @returns {Promise<Object>}
 */
export const verifyDeposit = async (data) => {
  const response = await api.post('/wallet/deposit/verify', data);
  return response.data;
};

/**
 * Fetch user's deposit history
 * @param {Object} [params]
 * @returns {Promise<Object>}
 */
export const getDeposits = async (params = {}) => {
  const response = await api.get('/wallet/deposits', { params });
  return response.data;
};

/**
 * Submit withdrawal request
 * @param {Object} data
 * @param {number} data.amount
 * @param {string} data.idempotencyKey
 * @param {string} [data.payoutMethod]
 * @param {Object} [data.payoutDetails]
 * @returns {Promise<Object>}
 */
export const createWithdrawal = async (data) => {
  const response = await api.post('/wallet/withdraw', data);
  return response.data;
};

/**
 * Fetch user's withdrawal history
 * @param {Object} [params]
 * @returns {Promise<Object>}
 */
export const getWithdrawals = async (params = {}) => {
  const response = await api.get('/wallet/withdrawals', { params });
  return response.data;
};

/**
 * Cancel a PENDING withdrawal request
 * @param {string} withdrawalId
 * @returns {Promise<Object>}
 */
export const cancelWithdrawal = async (withdrawalId) => {
  const response = await api.post(`/wallet/withdraw/${withdrawalId}/cancel`);
  return response.data;
};

/* ==========================================================================
   ADMIN WITHDRAWAL SERVICES
   ========================================================================== */

/**
 * Admin: Fetch all withdrawals with status filtering
 * @param {Object} [params]
 * @param {string} [params.status]
 * @param {number} [params.page]
 * @param {number} [params.limit]
 * @returns {Promise<Object>}
 */
export const getAllWithdrawalsAdmin = async (params = {}) => {
  const response = await api.get('/wallet/admin/withdrawals', { params });
  return response.data;
};

/**
 * Admin: Fetch single withdrawal details and ledger entries
 * @param {string} withdrawalId
 * @returns {Promise<Object>}
 */
export const getWithdrawalByIdAdmin = async (withdrawalId) => {
  const response = await api.get(`/wallet/admin/withdrawals/${withdrawalId}`);
  return response.data;
};

/**
 * Admin: Approve a withdrawal request
 * @param {string} withdrawalId
 * @returns {Promise<Object>}
 */
export const approveWithdrawalAdmin = async (withdrawalId) => {
  const response = await api.patch(`/wallet/admin/withdrawals/${withdrawalId}/approve`);
  return response.data;
};

/**
 * Admin: Reject a withdrawal request with reason
 * @param {string} withdrawalId
 * @param {string} reason
 * @returns {Promise<Object>}
 */
export const rejectWithdrawalAdmin = async (withdrawalId, reason) => {
  const response = await api.patch(`/wallet/admin/withdrawals/${withdrawalId}/reject`, { reason });
  return response.data;
};

/**
 * Admin: Advance withdrawal status (e.g. PROCESSING, COMPLETED, FAILED)
 * @param {string} withdrawalId
 * @param {Object} data
 * @param {string} data.status
 * @param {string} [data.adminNotes]
 * @returns {Promise<Object>}
 */
export const updateWithdrawalStatusAdmin = async (withdrawalId, data) => {
  const response = await api.patch(`/wallet/admin/withdrawals/${withdrawalId}/status`, data);
  return response.data;
};

/**
 * Admin: Fetch withdrawals quarantined for manual administrative reconciliation
 * @param {Object} [params]
 * @param {number} [params.page]
 * @param {number} [params.limit]
 * @returns {Promise<Object>}
 */
export const getQuarantinedWithdrawalsAdmin = async (params = {}) => {
  const response = await api.get('/wallet/admin/withdrawals/quarantined', { params });
  return response.data;
};

/**
 * Admin: Auditable manual resolution of a quarantined withdrawal refund
 * @param {string} withdrawalId
 * @param {Object} data
 * @param {'CONFIRM_CREDIT_AND_SEAL'|'APPLY_MISSING_CREDIT'|'REJECT_REFUND'} data.decision
 * @param {string} data.reason - Justification reason (min 10 chars)
 * @param {string} [data.secondReviewerId] - Required for amounts >= 10,000 INR
 * @returns {Promise<Object>}
 */
export const resolveQuarantinedWithdrawalAdmin = async (withdrawalId, data) => {
  const response = await api.post(`/wallet/admin/withdrawals/${withdrawalId}/resolve-quarantine`, data);
  return response.data;
};

export default {
  getWallet,
  getTransactions,
  createDepositIntent,
  verifyDeposit,
  getDeposits,
  createWithdrawal,
  getWithdrawals,
  cancelWithdrawal,
  getAllWithdrawalsAdmin,
  getWithdrawalByIdAdmin,
  getQuarantinedWithdrawalsAdmin,
  resolveQuarantinedWithdrawalAdmin,
  approveWithdrawalAdmin,
  rejectWithdrawalAdmin,
  updateWithdrawalStatusAdmin,
};
