import api from './api';

/**
 * Wallet Service - Handles authenticated user's wallet queries
 */

/**
 * Fetch current authenticated user's wallet
 * @returns {Promise<{success: boolean, wallet: {balance: number, currency: string, ...}}>}
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

export default {
  getWallet,
  getTransactions,
};
