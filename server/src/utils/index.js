export * from './tokenService.js';
export { default as tokenService } from './tokenService.js';
export * from './cryptoService.js';
export { default as cryptoService } from './cryptoService.js';
export * from './planCalculations.js';
export { default as planCalculations } from './planCalculations.js';

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
