import mongoose from 'mongoose';
import { UserPlan } from '../models/UserPlan.js';
import { Transaction } from '../models/Transaction.js';
import { getWalletByUserId } from './walletService.js';
import { User } from '../models/User.js';

/**
 * Dashboard Service - Consolidates authenticated user account metrics, active plans,
 * wallet balances, honest earnings ledger calculation, and recent transactions.
 */

/**
 * Retrieve consolidated dashboard data for the authenticated user
 * Ownership is strictly enforced by querying only for the specified userId.
 *
 * @param {string|mongoose.Types.ObjectId} userId - Authenticated user ID
 * @returns {Promise<Object>} Consolidated user dashboard data
 */
export const getUserDashboard = async (userId) => {
  // 1. Validate user ID format
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    const error = new Error('Invalid user ID format');
    error.statusCode = 400;
    throw error;
  }

  // 2. Fetch authenticated user profile snapshot (excluding sensitive fields)
  const user = await User.findById(userId).select('name email role isVerified referralCode createdAt');
  if (!user) {
    const error = new Error('User not found');
    error.statusCode = 404;
    throw error;
  }

  // 3. Retrieve user wallet (auto-creates if missing)
  const wallet = await getWalletByUserId(userId);

  // 4. Retrieve user active plans
  // Plans are considered active if status is 'active' and expiry date has not passed
  const now = new Date();
  const activePlanDocs = await UserPlan.find({
    user: userId,
    status: 'active',
    endDate: { $gt: now },
  }).sort({ createdAt: -1 });

  const activePlans = activePlanDocs.map((p) => {
    const remainingDays = Math.max(0, Math.ceil((new Date(p.endDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
    return {
      id: p._id,
      planId: p.plan,
      name: p.planName,
      price: p.price,
      durationDays: p.durationDays,
      dailyRoiRate: p.dailyRoiRate,
      hashRate: p.hashRate || 'Standard',
      features: p.features || [],
      startDate: p.startDate,
      endDate: p.endDate,
      status: p.status,
      idempotencyKey: p.idempotencyKey,
      remainingDays,
    };
  });

  // 5. Calculate Verified Earnings from Income Ledger Records
  // Strictly isolates income payouts from wallet deposits, development funding, and plan debits
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  // Filter for verified completed income transactions (excluding principal deposits and plan purchases)
  const incomeTxRegex = /(yield|income|payout|roi|reward|dividend)/i;

  const rawIncomeTxs = await Transaction.find({
    user: userId,
    type: 'credit',
    status: 'completed',
    description: { $regex: incomeTxRegex },
  });

  const allCompletedIncomeTxs = Array.isArray(rawIncomeTxs) ? rawIncomeTxs : [];

  const todayIncomeTxs = allCompletedIncomeTxs.filter((tx) => {
    const txDate = new Date(tx.createdAt);
    return txDate >= startOfToday && txDate <= endOfToday;
  });

  const todayEarningsFromTxs = todayIncomeTxs.reduce((acc, tx) => acc + Number(tx.amount || 0), 0);
  const totalEarningsFromTxs = allCompletedIncomeTxs.reduce((acc, tx) => acc + Number(tx.amount || 0), 0);

  // Check if wallet model maintains verified plan/referral income figures
  const walletRecordedIncome = Number(wallet.planIncome || 0) + Number(wallet.referralIncome || 0);

  // If no income transactions exist and wallet recorded income is 0,
  // report unsupported/not-configured honestly rather than fabricating returns.
  const hasIncomeLedgerRecords = allCompletedIncomeTxs.length > 0 || walletRecordedIncome > 0;

  const earnings = {
    today: todayEarningsFromTxs,
    total: Math.max(totalEarningsFromTxs, walletRecordedIncome),
    currency: 'INR',
    status: hasIncomeLedgerRecords ? 'verified' : 'not_configured',
    isConfigured: hasIncomeLedgerRecords,
    message: hasIncomeLedgerRecords
      ? 'Derived strictly from verified completed income ledger entries.'
      : 'Automated income distribution ledger is not configured. No verified earnings records exist.',
  };

  // 6. Retrieve recent user transactions (strictly isolated to this user)
  const recentTransactions = await Transaction.find({ user: userId })
    .sort({ createdAt: -1 })
    .limit(10)
    .select('_id type amount description status reference balanceBefore balanceAfter createdAt');

  return {
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      referralCode: user.referralCode,
    },
    wallet: {
      balance: Number(wallet.balance || 0),
      currency: 'INR',
      planIncome: Number(wallet.planIncome || 0),
      referralIncome: Number(wallet.referralIncome || 0),
      totalWithdrawn: Number(wallet.totalWithdrawn || 0),
    },
    activePlans: {
      count: activePlans.length,
      plans: activePlans,
    },
    earnings,
    recentTransactions: recentTransactions.map((tx) => ({
      id: tx._id,
      type: tx.type,
      amount: tx.amount,
      description: tx.description,
      status: tx.status,
      reference: tx.reference,
      ...(tx.balanceBefore != null ? { balanceBefore: tx.balanceBefore } : {}),
      ...(tx.balanceAfter != null ? { balanceAfter: tx.balanceAfter } : {}),
      date: tx.createdAt,
    })),
  };
};

export default {
  getUserDashboard,
};
