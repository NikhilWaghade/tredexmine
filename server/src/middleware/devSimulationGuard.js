/**
 * Middleware to protect the development-only referral/payment simulation endpoint.
 *
 * Strict Security Rules:
 * 1. Permanently disabled in production (returns HTTP 404 mimicking a non-existent route)
 * 2. Disabled unless NODE_ENV === 'development'
 * 3. Disabled unless ENABLE_TEST_PAYMENT_SIMULATION === 'true'
 */

export const isSimulationAllowed = () => {
  return (
    process.env.NODE_ENV === 'development' &&
    String(process.env.ENABLE_TEST_PAYMENT_SIMULATION).toLowerCase() === 'true'
  );
};

export const devSimulationGuard = (req, res, next) => {
  // 1. Permanently blocked in production (returns 404 mimicking non-existent route)
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({
      success: false,
      message: 'Endpoint not found',
    });
  }

  // 2. Disabled unless explicitly in development mode and flag is true
  if (!isSimulationAllowed()) {
    return res.status(403).json({
      success: false,
      message:
        'Payment simulation is disabled. Set NODE_ENV=development and ENABLE_TEST_PAYMENT_SIMULATION=true to enable.',
    });
  }

  next();
};

export default devSimulationGuard;

