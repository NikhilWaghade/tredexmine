export * from './tokenService.js';
export { default as tokenService } from './tokenService.js';

/**
 * Standard utility helpers
 */
export const formatResponse = (success, message, data = null) => {
  const response = { success, message };
  if (data !== null) {
    response.data = data;
  }
  return response;
};
