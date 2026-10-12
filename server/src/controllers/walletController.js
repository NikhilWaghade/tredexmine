import {
  getWalletByUserId,
  getTransactionsByUserId,
} from '../services/walletService.js';

/**
 * Get current authenticated user's wallet
 * @route GET /api/v1/wallet
 */
export const getWallet = async (req, res, next) => {
  try {
    const userId = req.user._id;

    // Retrieve or auto-provision wallet strictly for the authenticated user
    const wallet = await getWalletByUserId(userId);

    return res.status(200).json({
      success: true,
      wallet,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get current authenticated user's wallet transaction history
 * @route GET /api/v1/wallet/transactions
 */
export const getTransactions = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { page, limit } = req.query;

    const result = await getTransactionsByUserId(userId, { page, limit });

    return res.status(200).json({
      success: true,
      count: result.transactions.length,
      total: result.total,
      page: result.page,
      pages: result.pages,
      transactions: result.transactions,
    });
  } catch (error) {
    next(error);
  }
};

export default {
  getWallet,
  getTransactions,
};
