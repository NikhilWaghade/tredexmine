import { User } from '../models/User.js';
import { Wallet } from '../models/Wallet.js';
import { UserPlan } from '../models/UserPlan.js';
import { Deposit } from '../models/Deposit.js';
import { Withdrawal } from '../models/Withdrawal.js';
import { Payment } from '../models/Payment.js';
import { ReferralReward } from '../models/ReferralReward.js';
import { WebhookEvent } from '../models/WebhookEvent.js';

/**
 * Admin Service - Aggregates system metrics, user rosters, investments, wallets,
 * deposits, withdrawals, referrals, and payment records for admin supervision.
 */

/**
 * Get consolidated high-level system metrics
 */
export const getAdminOverviewMetrics = async () => {
  const [
    totalUsers,
    activeUsers,
    totalActivePlans,
    wallets,
    depositsAgg,
    withdrawalsAgg,
    pendingWithdrawalsCount,
    quarantinedWithdrawalsCount,
    quarantinedWebhooksCount,
    totalReferralRewards,
  ] = await Promise.all([
    User.countDocuments({ role: 'user' }),
    User.countDocuments({ role: 'user', isActive: true }),
    UserPlan.countDocuments({ status: 'active', endDate: { $gt: new Date() } }),
    Wallet.find({}),
    Deposit.aggregate([
      { $match: { status: 'completed' } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
    Withdrawal.aggregate([
      { $match: { status: 'COMPLETED' } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
    Withdrawal.countDocuments({ status: 'PENDING' }),
    Withdrawal.countDocuments({
      $or: [
        { status: 'QUARANTINED' },
        { 'metadata.reconciliationRequiresManualReview': true },
      ],
    }),
    WebhookEvent.countDocuments({ status: 'quarantined' }),
    ReferralReward.countDocuments({ status: 'completed' }),
  ]);

  const totalDepositedAmount = depositsAgg[0]?.total || 0;
  const totalCompletedDeposits = depositsAgg[0]?.count || 0;

  const totalWithdrawnAmount = withdrawalsAgg[0]?.total || 0;
  const totalCompletedWithdrawals = withdrawalsAgg[0]?.count || 0;

  const totalWalletBalances = wallets.reduce(
    (acc, w) => acc + Number(w.balance || 0),
    0
  );

  return {
    users: {
      total: totalUsers,
      active: activeUsers,
    },
    investments: {
      activePlansCount: totalActivePlans,
    },
    wallets: {
      totalSystemBalance: Math.round(totalWalletBalances * 100) / 100,
    },
    deposits: {
      totalAmount: totalDepositedAmount,
      totalCount: totalCompletedDeposits,
    },
    withdrawals: {
      totalCompletedAmount: totalWithdrawnAmount,
      totalCompletedCount: totalCompletedWithdrawals,
      pendingCount: pendingWithdrawalsCount,
      quarantinedCount: quarantinedWithdrawalsCount,
    },
    webhooks: {
      quarantinedCount: quarantinedWebhooksCount,
    },
    referrals: {
      totalRewardedCount: totalReferralRewards,
      totalRewardedAmount: totalReferralRewards * 300,
    },
  };
};

/**
 * Get paginated list of users with search and wallet/investment enrichment
 */
export const getAllUsersAdmin = async (options = {}) => {
  const { search = '', page = 1, limit = 20, role = '' } = options;
  const skip = (Math.max(1, parseInt(page, 10)) - 1) * Math.max(1, parseInt(limit, 10));

  const query = {};
  if (role) {
    query.role = role;
  }
  if (search.trim()) {
    const q = search.trim();
    query.$or = [
      { name: { $regex: q, $options: 'i' } },
      { email: { $regex: q, $options: 'i' } },
      { referralCode: { $regex: q, $options: 'i' } },
    ];
  }

  const [rawUsers, total] = await Promise.all([
    User.find(query)
      .populate('referredBy', 'name email referralCode')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit, 10))
      .select('-password'),
    User.countDocuments(query),
  ]);

  const userIds = rawUsers.map((u) => u._id);

  // Batch query wallets & active plans count
  const [wallets, userPlans] = await Promise.all([
    Wallet.find({ user: { $in: userIds } }),
    UserPlan.find({ user: { $in: userIds }, status: 'active', endDate: { $gt: new Date() } }),
  ]);

  const walletMap = new Map();
  wallets.forEach((w) => walletMap.set(String(w.user), w));

  const planCountMap = new Map();
  userPlans.forEach((p) => {
    const uId = String(p.user);
    planCountMap.set(uId, (planCountMap.get(uId) || 0) + 1);
  });

  const enrichedUsers = rawUsers.map((u) => {
    const userDoc = u.toObject ? u.toObject() : { ...u };
    const userWallet = walletMap.get(String(u._id));
    return {
      ...userDoc,
      walletBalance: Number(userWallet?.balance || 0),
      planIncome: Number(userWallet?.planIncome || 0),
      referralIncome: Number(userWallet?.referralIncome || 0),
      totalWithdrawn: Number(userWallet?.totalWithdrawn || 0),
      activePlansCount: planCountMap.get(String(u._id)) || 0,
    };
  });

  return {
    users: enrichedUsers,
    total,
    page: parseInt(page, 10),
    pages: Math.ceil(total / limit) || 1,
  };
};

/**
 * Get paginated list of all active UserPlans
 */
export const getActiveInvestmentsAdmin = async (options = {}) => {
  const { page = 1, limit = 20, status = 'active' } = options;
  const skip = (Math.max(1, parseInt(page, 10)) - 1) * Math.max(1, parseInt(limit, 10));

  const query = {};
  if (status && status !== 'all') {
    query.status = status;
  }

  const [rawPlans, total] = await Promise.all([
    UserPlan.find(query)
      .populate('user', 'name email referralCode')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit, 10)),
    UserPlan.countDocuments(query),
  ]);

  const now = new Date();
  const plans = rawPlans.map((p) => {
    const doc = p.toObject ? p.toObject() : { ...p };
    const remainingDays = p.endDate
      ? Math.max(0, Math.ceil((new Date(p.endDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
      : 0;
    return {
      ...doc,
      remainingDays,
    };
  });

  return {
    investments: plans,
    total,
    page: parseInt(page, 10),
    pages: Math.ceil(total / limit) || 1,
  };
};

/**
 * Get paginated list of all Wallets
 */
export const getAllWalletsAdmin = async (options = {}) => {
  const { page = 1, limit = 20 } = options;
  const skip = (Math.max(1, parseInt(page, 10)) - 1) * Math.max(1, parseInt(limit, 10));

  const [wallets, total] = await Promise.all([
    Wallet.find({})
      .populate('user', 'name email referralCode')
      .sort({ balance: -1 })
      .skip(skip)
      .limit(parseInt(limit, 10)),
    Wallet.countDocuments({}),
  ]);

  return {
    wallets,
    total,
    page: parseInt(page, 10),
    pages: Math.ceil(total / limit) || 1,
  };
};

/**
 * Get paginated list of all Deposits
 */
export const getAllDepositsAdmin = async (options = {}) => {
  const { page = 1, limit = 20, status } = options;
  const skip = (Math.max(1, parseInt(page, 10)) - 1) * Math.max(1, parseInt(limit, 10));

  const query = {};
  if (status && status !== 'all') {
    query.status = status;
  }

  const [deposits, total] = await Promise.all([
    Deposit.find(query)
      .populate('user', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit, 10)),
    Deposit.countDocuments(query),
  ]);

  return {
    deposits,
    total,
    page: parseInt(page, 10),
    pages: Math.ceil(total / limit) || 1,
  };
};

/**
 * Get paginated list of all Referral Rewards
 */
export const getAllReferralsAdmin = async (options = {}) => {
  const { page = 1, limit = 20 } = options;
  const skip = (Math.max(1, parseInt(page, 10)) - 1) * Math.max(1, parseInt(limit, 10));

  const [rewards, total] = await Promise.all([
    ReferralReward.find({})
      .populate('referrer', 'name email referralCode')
      .populate('referredUser', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit, 10)),
    ReferralReward.countDocuments({}),
  ]);

  return {
    rewards,
    total,
    page: parseInt(page, 10),
    pages: Math.ceil(total / limit) || 1,
  };
};

/**
 * Get paginated list of all Payments
 */
export const getAllPaymentsAdmin = async (options = {}) => {
  const { page = 1, limit = 20, status } = options;
  const skip = (Math.max(1, parseInt(page, 10)) - 1) * Math.max(1, parseInt(limit, 10));

  const query = {};
  if (status && status !== 'all') {
    query.status = status;
  }

  const [payments, total] = await Promise.all([
    Payment.find(query)
      .populate('user', 'name email')
      .populate('plan', 'name price durationDays hashRate')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit, 10)),
    Payment.countDocuments(query),
  ]);

  return {
    payments,
    total,
    page: parseInt(page, 10),
    pages: Math.ceil(total / limit) || 1,
  };
};

export default {
  getAdminOverviewMetrics,
  getAllUsersAdmin,
  getActiveInvestmentsAdmin,
  getAllWalletsAdmin,
  getAllDepositsAdmin,
  getAllReferralsAdmin,
  getAllPaymentsAdmin,
};

