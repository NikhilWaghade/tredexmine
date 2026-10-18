import api from './api';

/**
 * Authentication Service - Handles login, register, me, and logout
 */

export const login = async (email, password) => {
  const response = await api.post('/auth/login', { email, password });
  return response.data;
};

export const register = async (userData) => {
  const response = await api.post('/auth/register', userData);
  return response.data;
};

export const getMe = async () => {
  const response = await api.get('/auth/me');
  return response.data;
};

export const refreshToken = async (token) => {
  const response = await api.post('/auth/refresh', token ? { refreshToken: token } : {});
  return response.data;
};

export const logout = async () => {
  try {
    await api.post('/auth/logout');
  } catch {
    // Ignore logout failure and proceed with client state cleanup
  }
};

export default {
  login,
  register,
  getMe,
  refreshToken,
  logout,
};

