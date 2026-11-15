import api from './api';

/**
 * Admin Service - Provides administrative data queries for overview, users,
 * investments, wallets, deposits, referrals, and payments.
 */

export const getOverview = async () => {
  const response = await api.get('/admin/overview');
  return response.data;
};

export const getUsers = async (params = {}) => {
  const response = await api.get('/admin/users', { params });
  return response.data;
};

export const getActiveInvestments = async (params = {}) => {
  const response = await api.get('/admin/active-investments', { params });
  return response.data;
};

export const getWallets = async (params = {}) => {
  const response = await api.get('/admin/wallets', { params });
  return response.data;
};

export const getDeposits = async (params = {}) => {
  const response = await api.get('/admin/deposits', { params });
  return response.data;
};

export const getReferrals = async (params = {}) => {
  const response = await api.get('/admin/referrals', { params });
  return response.data;
};

export const getPayments = async (params = {}) => {
  const response = await api.get('/admin/payments', { params });
  return response.data;
};

export default {
  getOverview,
  getUsers,
  getActiveInvestments,
  getWallets,
  getDeposits,
  getReferrals,
  getPayments,
};

