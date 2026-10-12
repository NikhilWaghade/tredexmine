import { Wallet } from '../models/Wallet.js';
import { Transaction } from '../models/Transaction.js';

/**
 * Automatically create a new wallet for a user
 * @param {string|mongoose.Types.ObjectId} userId
 * @returns {Promise<Wallet>}
 */
export const createWalletForUser = async (userId) => {
  // Check if wallet already exists
  const existingWallet = await Wallet.findOne({ user: userId });
  if (existingWallet) {
    return existingWallet;
  }

  const wallet = await Wallet.create({
    user: userId,
    balance: 0,
    referralIncome: 0,
    planIncome: 0,
    totalWithdrawn: 0,
  });

  return wallet;
};

/**
 * Get wallet belonging to a user (auto-creates if missing as a fallback)
 * @param {string|mongoose.Types.ObjectId} userId
 * @returns {Promise<Wallet>}
 */
export const getWalletByUserId = async (userId) => {
  let wallet = await Wallet.findOne({ user: userId });

  if (!wallet) {
    wallet = await createWalletForUser(userId);
  }

  return wallet;
};

/**
 * Get transaction history for a user's wallet
 * @param {string|mongoose.Types.ObjectId} userId
 * @param {Object} [options]
 * @returns {Promise<Array<Transaction>>}
 */
export const getTransactionsByUserId = async (userId, options = {}) => {
  const { limit = 50, page = 1 } = options;
  const skip = (Math.max(1, parseInt(page, 10)) - 1) * Math.max(1, parseInt(limit, 10));

  const transactions = await Transaction.find({ user: userId })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit, 10));

  const total = await Transaction.countDocuments({ user: userId });

  return {
    transactions,
    total,
    page: parseInt(page, 10),
    pages: Math.ceil(total / limit) || 1,
  };
};

export default {
  createWalletForUser,
  getWalletByUserId,
  getTransactionsByUserId,
};
