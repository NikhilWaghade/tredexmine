/**
 * Investment Plan Yield Calculation Utility (Single Source of Truth)
 *
 * Implements a simple, non-compounding mathematical model:
 * - Default duration: 30 Days
 * - Illustrative total return: 100% of original investment over duration
 * - Daily illustrative percentage: 100 / durationDays (e.g. 100 / 30 = 3.333333% => 3.33%)
 * - Daily illustrative amount: price * (100 / durationDays) / 100
 *
 * IMPORTANT LEGAL & FINANCIAL SAFETY DISCLOSURE:
 * This is a mathematical illustration, not evidence of actual mining revenue,
 * a guarantee of profit, or a promised dividend. Actual cryptocurrency mining output
 * fluctuates dynamically with global network difficulty, block rewards, and node uptime.
 */

export const PLAN_RISK_DISCLOSURE =
  'Mathematical illustration only. Cryptocurrency mining returns depend on network difficulty, block rewards, and operational uptime, and are not guaranteed.';

/**
 * Dynamically calculate illustrative return metrics for any investment plan
 *
 * @param {number|string} price - Authoritative plan investment amount
 * @param {number|string} [durationDays=30] - Plan contract duration in days
 * @returns {Object} Calculated metrics
 */
export const calculatePlanMetrics = (price, durationDays = 30) => {
  const numPrice = Number(price) || 0;
  const days = Number(durationDays) || 30;

  // Daily percentage: (100 / days)
  const dailyPercentageExact = days > 0 ? 100 / days : 0;
  const dailyPercentageFormatted = Number(dailyPercentageExact.toFixed(2)); // 3.33%

  // Daily amount: price * (100 / days) / 100 => price / days
  const dailyAmount = days > 0 ? Math.round((numPrice / days) * 100) / 100 : 0;

  // Illustrative 30-Day Total return (excluding principal): dailyAmount * days
  const illustrativeTotal = Math.round(dailyAmount * days * 100) / 100;

  // Original Principal
  const principal = numPrice;

  // Total illustrative amount if principal is separately returned
  const totalWithPrincipal = Math.round((illustrativeTotal + principal) * 100) / 100;

  return {
    price: numPrice,
    durationDays: days,
    dailyPercentage: dailyPercentageFormatted,
    dailyPercentageExact,
    dailyAmount,
    illustrativeTotal,
    principal,
    totalWithPrincipal,
    disclosure: PLAN_RISK_DISCLOSURE,
  };
};

export default {
  PLAN_RISK_DISCLOSURE,
  calculatePlanMetrics,
};

