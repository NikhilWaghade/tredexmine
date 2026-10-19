import api from './api';

/**
 * Dashboard Service - Fetches consolidated authenticated user account metrics,
 * active subscriptions, wallet balances, honest verified earnings, and transaction history.
 */

/**
 * Fetch authenticated user dashboard data
 * @returns {Promise<Object>}
 */
export const getDashboard = async () => {
  const response = await api.get('/dashboard');
  return response.data;
};

export default {
  getDashboard,
};
