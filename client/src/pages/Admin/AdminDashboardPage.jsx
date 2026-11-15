import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Container, Card, SectionHeader } from '../../components/common';
import { adminService, walletService } from '../../services';
import { AdminPlansPage } from './index.jsx';
import { AdminWithdrawalsPage } from './AdminWithdrawalsPage.jsx';

// Helpers
const formatINR = (val) => {
  const num = Number(val || 0);
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(num);
};

const formatDate = (dateStr) => {
  if (!dateStr) return 'N/A';
  try {
    const d = new Date(dateStr);
    return d.toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(dateStr);
  }
};

const TABS = [
  { id: 'overview', label: 'Overview', icon: '📊' },
  { id: 'users', label: 'Users Management', icon: '👥' },
  { id: 'plans', label: 'Investment Plans', icon: '⚡' },
  { id: 'investments', label: 'Active Investments', icon: '⛏️' },
  { id: 'wallets', label: 'Wallet Management', icon: '💰' },
  { id: 'deposits', label: 'Deposit Management', icon: '📥' },
  { id: 'withdrawals', label: 'Withdrawal Management', icon: '📤' },
  { id: 'referrals', label: 'Referral Management', icon: '🎁' },
  { id: 'payments', label: 'Payment Records', icon: '💳' },
  { id: 'quarantine', label: 'Review & Quarantine', icon: '🛡️' },
];

export function AdminDashboardPage({ initialTab = 'overview' }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryTab = searchParams.get('tab');
  const [localTab, setLocalTab] = useState(initialTab);
  const activeTab = queryTab || localTab;

  const handleTabChange = (tabId) => {
    setLocalTab(tabId);
    setSearchParams({ tab: tabId });
  };

  // State for Overview tab
  const [overviewMetrics, setOverviewMetrics] = useState(null);
  const [overviewLoading, setOverviewLoading] = useState(false);

  // State for Users tab
  const [users, setUsers] = useState([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [usersPage, setUsersPage] = useState(1);
  const [usersSearch, setUsersSearch] = useState('');
  const [usersRole, setUsersRole] = useState('');
  const [usersLoading, setUsersLoading] = useState(false);

  // State for Active Investments tab
  const [investments, setInvestments] = useState([]);
  const [investmentsTotal, setInvestmentsTotal] = useState(0);
  const investmentsPage = 1;
  const [investmentsLoading, setInvestmentsLoading] = useState(false);

  // State for Wallets tab
  const [wallets, setWallets] = useState([]);
  const [walletsTotal, setWalletsTotal] = useState(0);
  const walletsPage = 1;
  const [walletsLoading, setWalletsLoading] = useState(false);

  // State for Deposits tab
  const [deposits, setDeposits] = useState([]);
  const [depositsTotal, setDepositsTotal] = useState(0);
  const depositsPage = 1;
  const [depositsLoading, setDepositsLoading] = useState(false);
  const [reconcilingRef, setReconcilingRef] = useState(null);

  // State for Referrals tab
  const [referrals, setReferrals] = useState([]);
  const [referralsTotal, setReferralsTotal] = useState(0);
  const referralsPage = 1;
  const [referralsLoading, setReferralsLoading] = useState(false);

  // State for Payments tab
  const [payments, setPayments] = useState([]);
  const [paymentsTotal, setPaymentsTotal] = useState(0);
  const paymentsPage = 1;
  const [paymentsLoading, setPaymentsLoading] = useState(false);

  // Feedback notifications
  const [feedback, setFeedback] = useState(null);

  // 1. Fetch Overview
  const fetchOverview = useCallback(async () => {
    setOverviewLoading(true);
    try {
      const res = await adminService.getOverview();
      if (res.success) {
        setOverviewMetrics(res.data);
      }
    } catch (err) {
      console.error('Failed to load admin overview:', err);
      setFeedback({ type: 'error', message: 'Failed to load system metrics' });
    } finally {
      setOverviewLoading(false);
    }
  }, []);

  // 2. Fetch Users
  const fetchUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const res = await adminService.getUsers({
        page: usersPage,
        limit: 15,
        search: usersSearch,
        role: usersRole,
      });
      if (res.success) {
        setUsers(res.data.users || []);
        setUsersTotal(res.data.total || 0);
      }
    } catch (err) {
      console.error('Failed to load users:', err);
    } finally {
      setUsersLoading(false);
    }
  }, [usersPage, usersSearch, usersRole]);

  // 3. Fetch Active Investments
  const fetchInvestments = useCallback(async () => {
    setInvestmentsLoading(true);
    try {
      const res = await adminService.getActiveInvestments({
        page: investmentsPage,
        limit: 15,
      });
      if (res.success) {
        setInvestments(res.data.investments || []);
        setInvestmentsTotal(res.data.total || 0);
      }
    } catch (err) {
      console.error('Failed to load investments:', err);
    } finally {
      setInvestmentsLoading(false);
    }
  }, [investmentsPage]);

  // 4. Fetch Wallets
  const fetchWallets = useCallback(async () => {
    setWalletsLoading(true);
    try {
      const res = await adminService.getWallets({
        page: walletsPage,
        limit: 15,
      });
      if (res.success) {
        setWallets(res.data.wallets || []);
        setWalletsTotal(res.data.total || 0);
      }
    } catch (err) {
      console.error('Failed to load wallets:', err);
    } finally {
      setWalletsLoading(false);
    }
  }, [walletsPage]);

  // 5. Fetch Deposits
  const fetchDeposits = useCallback(async () => {
    setDepositsLoading(true);
    try {
      const res = await adminService.getDeposits({
        page: depositsPage,
        limit: 15,
      });
      if (res.success) {
        setDeposits(res.data.deposits || []);
        setDepositsTotal(res.data.total || 0);
      }
    } catch (err) {
      console.error('Failed to load deposits:', err);
    } finally {
      setDepositsLoading(false);
    }
  }, [depositsPage]);

  // Handle Deposit Reconcile
  const handleReconcileDeposit = async (ref) => {
    if (!window.confirm(`Run authoritative ledger reconciliation for deposit ${ref}?`)) return;
    setReconcilingRef(ref);
    try {
      const res = await walletService.reconcileDepositAdmin(ref);
      if (res.success) {
        setFeedback({
          type: 'success',
          message: `Deposit ${ref} reconciled: ${res.message || 'Ledger up to date'}`,
        });
        await fetchDeposits();
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err.response?.data?.message || err.message || 'Reconciliation failed',
      });
    } finally {
      setReconcilingRef(null);
    }
  };

  // 6. Fetch Referrals
  const fetchReferrals = useCallback(async () => {
    setReferralsLoading(true);
    try {
      const res = await adminService.getReferrals({
        page: referralsPage,
        limit: 15,
      });
      if (res.success) {
        setReferrals(res.data.rewards || []);
        setReferralsTotal(res.data.total || 0);
      }
    } catch (err) {
      console.error('Failed to load referrals:', err);
    } finally {
      setReferralsLoading(false);
    }
  }, [referralsPage]);

  // 7. Fetch Payments
  const fetchPayments = useCallback(async () => {
    setPaymentsLoading(true);
    try {
      const res = await adminService.getPayments({
        page: paymentsPage,
        limit: 15,
      });
      if (res.success) {
        setPayments(res.data.payments || []);
        setPaymentsTotal(res.data.total || 0);
      }
    } catch (err) {
      console.error('Failed to load payments:', err);
    } finally {
      setPaymentsLoading(false);
    }
  }, [paymentsPage]);

  // Load relevant data on tab change
  useEffect(() => {
    let isMounted = true;
    Promise.resolve().then(() => {
      if (!isMounted) return;
      if (activeTab === 'overview') fetchOverview();
      if (activeTab === 'users') fetchUsers();
      if (activeTab === 'investments') fetchInvestments();
      if (activeTab === 'wallets') fetchWallets();
      if (activeTab === 'deposits') fetchDeposits();
      if (activeTab === 'referrals') fetchReferrals();
      if (activeTab === 'payments') fetchPayments();
    });
    return () => {
      isMounted = false;
    };
  }, [
    activeTab,
    fetchOverview,
    fetchUsers,
    fetchInvestments,
    fetchWallets,
    fetchDeposits,
    fetchReferrals,
    fetchPayments,
  ]);

  return (
    <div className="min-h-screen bg-[#07050d] text-white pt-24 pb-20">
      <Container>
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
            <SectionHeader
              title="Minetrades Admin & Governance Hub"
              subtitle="Central administrative oversight, financial ledger controls, user management, and risk quarantine."
              align="left"
              className="mb-0"
            />
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <span className="px-3 py-1.5 rounded-xl bg-purple-500/10 border border-purple-500/30 text-purple-300 text-xs font-bold flex items-center gap-1.5">
              <span>🛡️</span>
              <span>Financial Safety Active</span>
            </span>
            <span className="px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-bold flex items-center gap-1.5">
              <span>🔐</span>
              <span>AES-256-GCM Vault</span>
            </span>
          </div>
        </div>

        {/* Global Feedback Alert */}
        {feedback && (
          <div
            className={`mb-6 p-4 rounded-xl border flex items-center justify-between ${
              feedback.type === 'success'
                ? 'bg-emerald-950/60 border-emerald-800/80 text-emerald-200'
                : 'bg-rose-950/60 border-rose-800/80 text-rose-200'
            }`}
          >
            <p className="text-sm font-medium">{feedback.message}</p>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              className="text-gray-400 hover:text-white text-lg font-bold px-2"
            >
              ×
            </button>
          </div>
        )}

        {/* Tab Navigation */}
        <div className="flex items-center gap-2 border-b border-white/10 pb-4 mb-8 overflow-x-auto scrollbar-none">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                id={`admin-tab-${tab.id}`}
                onClick={() => handleTabChange(tab.id)}
                className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap flex items-center gap-2 border ${
                  isActive
                    ? 'bg-[#7A56D6] text-white border-[#7A56D6] shadow-md shadow-[#7A56D6]/40'
                    : 'bg-white/[0.03] text-gray-400 border-white/10 hover:text-white hover:bg-white/[0.06]'
                }`}
              >
                <span>{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* TAB 1: OVERVIEW */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {overviewLoading || !overviewMetrics ? (
              <div className="py-16 text-center text-gray-400 text-sm">
                Loading high-level governance metrics...
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {/* Total Users */}
                  <Card className="p-5 bg-gradient-to-br from-white/[0.04] to-transparent border-white/10">
                    <div className="text-gray-400 text-xs uppercase tracking-wider font-semibold">Total Registered Users</div>
                    <div className="text-3xl font-extrabold text-white mt-2">{overviewMetrics.users.total}</div>
                    <div className="text-xs text-purple-300 mt-1">{overviewMetrics.users.active} active accounts</div>
                  </Card>

                  {/* Active Cloud Investments */}
                  <Card className="p-5 bg-gradient-to-br from-white/[0.04] to-transparent border-white/10">
                    <div className="text-gray-400 text-xs uppercase tracking-wider font-semibold">Active Investments</div>
                    <div className="text-3xl font-extrabold text-white mt-2">{overviewMetrics.investments.activePlansCount}</div>
                    <div className="text-xs text-purple-300 mt-1">Live running compute slots</div>
                  </Card>

                  {/* Total System Balances */}
                  <Card className="p-5 bg-gradient-to-br from-white/[0.04] to-transparent border-white/10">
                    <div className="text-gray-400 text-xs uppercase tracking-wider font-semibold">Total User Balances</div>
                    <div className="text-3xl font-extrabold text-emerald-400 mt-2">{formatINR(overviewMetrics.wallets.totalSystemBalance)}</div>
                    <div className="text-xs text-gray-400 mt-1">Authoritative wallet liabilities</div>
                  </Card>

                  {/* Pending Withdrawals */}
                  <Card className="p-5 bg-gradient-to-br from-white/[0.04] to-transparent border-white/10">
                    <div className="text-gray-400 text-xs uppercase tracking-wider font-semibold">Pending Withdrawals</div>
                    <div className="text-3xl font-extrabold text-amber-400 mt-2">{overviewMetrics.withdrawals.pendingCount}</div>
                    <div className="text-xs text-amber-300/80 mt-1">Requires review & processing</div>
                  </Card>

                  {/* Completed Deposits */}
                  <Card className="p-5 bg-gradient-to-br from-white/[0.04] to-transparent border-white/10">
                    <div className="text-gray-400 text-xs uppercase tracking-wider font-semibold">Completed Deposits</div>
                    <div className="text-2xl font-bold text-white mt-2">{formatINR(overviewMetrics.deposits.totalAmount)}</div>
                    <div className="text-xs text-gray-400 mt-1">{overviewMetrics.deposits.totalCount} successful deposits</div>
                  </Card>

                  {/* Completed Withdrawals */}
                  <Card className="p-5 bg-gradient-to-br from-white/[0.04] to-transparent border-white/10">
                    <div className="text-gray-400 text-xs uppercase tracking-wider font-semibold">Completed Payouts</div>
                    <div className="text-2xl font-bold text-white mt-2">{formatINR(overviewMetrics.withdrawals.totalCompletedAmount)}</div>
                    <div className="text-xs text-gray-400 mt-1">{overviewMetrics.withdrawals.totalCompletedCount} payouts completed</div>
                  </Card>

                  {/* Quarantined Records */}
                  <Card className="p-5 bg-gradient-to-br from-white/[0.04] to-transparent border-white/10">
                    <div className="text-gray-400 text-xs uppercase tracking-wider font-semibold">Quarantined Items</div>
                    <div className="text-2xl font-bold text-rose-400 mt-2">{overviewMetrics.withdrawals.quarantinedCount}</div>
                    <div className="text-xs text-rose-300/80 mt-1">Flagged for manual audit</div>
                  </Card>

                  {/* Referral Rewards */}
                  <Card className="p-5 bg-gradient-to-br from-white/[0.04] to-transparent border-white/10">
                    <div className="text-gray-400 text-xs uppercase tracking-wider font-semibold">Referral Rewards (₹300)</div>
                    <div className="text-2xl font-bold text-purple-300 mt-2">{formatINR(overviewMetrics.referrals.totalRewardedAmount)}</div>
                    <div className="text-xs text-gray-400 mt-1">{overviewMetrics.referrals.totalRewardedCount} rewards issued</div>
                  </Card>
                </div>

                {/* Quick Navigation Cards */}
                <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div
                    onClick={() => handleTabChange('withdrawals')}
                    className="p-5 rounded-2xl bg-purple-950/20 border border-purple-800/40 hover:border-purple-500 cursor-pointer transition-all"
                  >
                    <div className="text-sm font-bold text-white flex items-center justify-between">
                      <span>Withdrawal Operations</span>
                      <span>→</span>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">
                      Review submitted payout requests, reveal decrypted credentials, and approve or reject transfers.
                    </p>
                  </div>

                  <div
                    onClick={() => handleTabChange('plans')}
                    className="p-5 rounded-2xl bg-purple-950/20 border border-purple-800/40 hover:border-purple-500 cursor-pointer transition-all"
                  >
                    <div className="text-sm font-bold text-white flex items-center justify-between">
                      <span>Investment Plan Catalog</span>
                      <span>→</span>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">
                      Create new plans, update prices, duration, hashrates, and toggle active/inactive status.
                    </p>
                  </div>

                  <div
                    onClick={() => handleTabChange('quarantine')}
                    className="p-5 rounded-2xl bg-amber-950/20 border border-amber-800/40 hover:border-amber-500 cursor-pointer transition-all"
                  >
                    <div className="text-sm font-bold text-white flex items-center justify-between">
                      <span>Quarantine & Risk Review</span>
                      <span>→</span>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">
                      Inspect flagged operations with ledger balance discrepancies and perform authoritative resolution.
                    </p>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* TAB 2: USERS MANAGEMENT */}
        {activeTab === 'users' && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <input
                  type="text"
                  value={usersSearch}
                  onChange={(e) => {
                    setUsersSearch(e.target.value);
                    setUsersPage(1);
                  }}
                  placeholder="Search user by name, email, referral code..."
                  className="px-3.5 py-2 rounded-xl bg-black/60 border border-white/10 text-white text-xs w-full sm:w-80 focus:outline-none focus:border-purple-500"
                />
                <select
                  value={usersRole}
                  onChange={(e) => {
                    setUsersRole(e.target.value);
                    setUsersPage(1);
                  }}
                  className="px-3 py-2 rounded-xl bg-black/60 border border-white/10 text-white text-xs focus:outline-none focus:border-purple-500"
                >
                  <option value="">All Roles</option>
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div className="text-xs text-gray-400">
                Total Users: <span className="font-bold text-white">{usersTotal}</span>
              </div>
            </div>

            <Card className="p-0 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-white/[0.04] text-gray-400 uppercase font-semibold border-b border-white/5">
                    <tr>
                      <th className="px-5 py-4">User</th>
                      <th className="px-5 py-4">Role</th>
                      <th className="px-5 py-4">Referral Code</th>
                      <th className="px-5 py-4">Wallet Balance</th>
                      <th className="px-5 py-4">Plan Income</th>
                      <th className="px-5 py-4">Referral Income</th>
                      <th className="px-5 py-4">Active Plans</th>
                      <th className="px-5 py-4">Joined Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {usersLoading ? (
                      <tr>
                        <td colSpan={8} className="px-5 py-12 text-center text-gray-400">Loading users...</td>
                      </tr>
                    ) : users.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-5 py-12 text-center text-gray-500">No users found.</td>
                      </tr>
                    ) : (
                      users.map((u) => (
                        <tr key={u._id} className="hover:bg-white/[0.02]">
                          <td className="px-5 py-4">
                            <div className="font-bold text-white">{u.name}</div>
                            <div className="text-[11px] text-gray-400">{u.email}</div>
                            <div className="text-[10px] font-mono text-gray-500">ID: {u._id}</div>
                          </td>
                          <td className="px-5 py-4">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                              u.role === 'admin'
                                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                : 'bg-purple-500/10 text-purple-300 border border-purple-500/20'
                            }`}>
                              {u.role}
                            </span>
                          </td>
                          <td className="px-5 py-4 font-mono font-bold text-purple-300">
                            {u.referralCode}
                            {u.referredBy && (
                              <div className="text-[10px] text-gray-400">By: {u.referredBy.referralCode}</div>
                            )}
                          </td>
                          <td className="px-5 py-4 font-bold text-emerald-400">
                            {formatINR(u.walletBalance)}
                          </td>
                          <td className="px-5 py-4 text-gray-300">
                            {formatINR(u.planIncome)}
                          </td>
                          <td className="px-5 py-4 text-purple-300">
                            {formatINR(u.referralIncome)}
                          </td>
                          <td className="px-5 py-4">
                            <span className="px-2 py-0.5 rounded-full bg-white/5 border border-white/10 font-bold text-white">
                              {u.activePlansCount}
                            </span>
                          </td>
                          <td className="px-5 py-4 text-gray-400 whitespace-nowrap">
                            {formatDate(u.createdAt)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        )}

        {/* TAB 3: INVESTMENT PLANS (CATALOG CRUD) */}
        {activeTab === 'plans' && (
          <div>
            <AdminPlansPage />
          </div>
        )}

        {/* TAB 4: ACTIVE INVESTMENTS */}
        {activeTab === 'investments' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between text-xs text-gray-400">
              <span>All purchased compute node contracts currently active or completed</span>
              <span>Total Active Plans: <strong className="text-white">{investmentsTotal}</strong></span>
            </div>

            <Card className="p-0 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-white/[0.04] text-gray-400 uppercase font-semibold border-b border-white/5">
                    <tr>
                      <th className="px-5 py-4">User</th>
                      <th className="px-5 py-4">Plan Name</th>
                      <th className="px-5 py-4">Price</th>
                      <th className="px-5 py-4">Hashrate</th>
                      <th className="px-5 py-4">Daily Yield</th>
                      <th className="px-5 py-4">Remaining Days</th>
                      <th className="px-5 py-4">Status</th>
                      <th className="px-5 py-4">Expiry Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {investmentsLoading ? (
                      <tr>
                        <td colSpan={8} className="px-5 py-12 text-center text-gray-400">Loading active investments...</td>
                      </tr>
                    ) : investments.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-5 py-12 text-center text-gray-500">No investment contracts found.</td>
                      </tr>
                    ) : (
                      investments.map((inv) => (
                        <tr key={inv._id} className="hover:bg-white/[0.02]">
                          <td className="px-5 py-4">
                            <div className="font-bold text-white">{inv.user?.name || 'User'}</div>
                            <div className="text-[11px] text-gray-400">{inv.user?.email}</div>
                          </td>
                          <td className="px-5 py-4 font-bold text-purple-300">
                            {inv.planName}
                          </td>
                          <td className="px-5 py-4 font-bold text-white">
                            {formatINR(inv.price)}
                          </td>
                          <td className="px-5 py-4 text-purple-200">
                            {inv.hashRate}
                          </td>
                          <td className="px-5 py-4 text-emerald-400 font-semibold">
                            {formatINR(inv.dailyYield)} / day
                          </td>
                          <td className="px-5 py-4 font-bold text-amber-300">
                            {inv.remainingDays} days
                          </td>
                          <td className="px-5 py-4">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                              inv.status === 'active'
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                : 'bg-gray-800 text-gray-400 border border-gray-700'
                            }`}>
                              {inv.status}
                            </span>
                          </td>
                          <td className="px-5 py-4 text-gray-400 whitespace-nowrap">
                            {formatDate(inv.endDate)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        )}

        {/* TAB 5: WALLET MANAGEMENT */}
        {activeTab === 'wallets' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between text-xs text-gray-400">
              <span>Authoritative balances and cumulative financial ledgers</span>
              <span>Total Wallets: <strong className="text-white">{walletsTotal}</strong></span>
            </div>

            <Card className="p-0 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-white/[0.04] text-gray-400 uppercase font-semibold border-b border-white/5">
                    <tr>
                      <th className="px-5 py-4">User</th>
                      <th className="px-5 py-4">Available Balance</th>
                      <th className="px-5 py-4">Plan Income</th>
                      <th className="px-5 py-4">Referral Income</th>
                      <th className="px-5 py-4">Total Withdrawn</th>
                      <th className="px-5 py-4">Last Updated</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {walletsLoading ? (
                      <tr>
                        <td colSpan={6} className="px-5 py-12 text-center text-gray-400">Loading wallets...</td>
                      </tr>
                    ) : wallets.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-5 py-12 text-center text-gray-500">No wallets found.</td>
                      </tr>
                    ) : (
                      wallets.map((w) => (
                        <tr key={w._id} className="hover:bg-white/[0.02]">
                          <td className="px-5 py-4">
                            <div className="font-bold text-white">{w.user?.name || 'User'}</div>
                            <div className="text-[11px] text-gray-400">{w.user?.email}</div>
                            <div className="text-[10px] font-mono text-gray-500">UID: {w.user?._id || w.user}</div>
                          </td>
                          <td className="px-5 py-4 font-bold text-emerald-400 text-sm">
                            {formatINR(w.balance)}
                          </td>
                          <td className="px-5 py-4 text-gray-300 font-semibold">
                            {formatINR(w.planIncome)}
                          </td>
                          <td className="px-5 py-4 text-purple-300 font-semibold">
                            {formatINR(w.referralIncome)}
                          </td>
                          <td className="px-5 py-4 text-rose-300 font-semibold">
                            {formatINR(w.totalWithdrawn)}
                          </td>
                          <td className="px-5 py-4 text-gray-400 whitespace-nowrap">
                            {formatDate(w.updatedAt || w.createdAt)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        )}

        {/* TAB 6: DEPOSIT MANAGEMENT */}
        {activeTab === 'deposits' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between text-xs text-gray-400">
              <span>Deposit intents, verification status, and authoritative ledger reconciliations</span>
              <span>Total Deposits: <strong className="text-white">{depositsTotal}</strong></span>
            </div>

            <Card className="p-0 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-white/[0.04] text-gray-400 uppercase font-semibold border-b border-white/5">
                    <tr>
                      <th className="px-5 py-4">Reference</th>
                      <th className="px-5 py-4">User</th>
                      <th className="px-5 py-4">Amount</th>
                      <th className="px-5 py-4">Provider</th>
                      <th className="px-5 py-4">Status</th>
                      <th className="px-5 py-4">Date</th>
                      <th className="px-5 py-4 text-right">Reconcile</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {depositsLoading ? (
                      <tr>
                        <td colSpan={7} className="px-5 py-12 text-center text-gray-400">Loading deposits...</td>
                      </tr>
                    ) : deposits.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-5 py-12 text-center text-gray-500">No deposit records found.</td>
                      </tr>
                    ) : (
                      deposits.map((d) => (
                        <tr key={d._id} className="hover:bg-white/[0.02]">
                          <td className="px-5 py-4 font-mono font-bold text-purple-300">
                            {d.depositReference}
                            {d.paymentId && (
                              <div className="text-[10px] text-gray-400 font-mono">PID: {d.paymentId}</div>
                            )}
                          </td>
                          <td className="px-5 py-4">
                            <div className="font-bold text-white">{d.user?.name || 'User'}</div>
                            <div className="text-[11px] text-gray-400">{d.user?.email}</div>
                          </td>
                          <td className="px-5 py-4 font-bold text-emerald-400 text-sm">
                            {formatINR(d.amount)}
                          </td>
                          <td className="px-5 py-4 uppercase font-semibold text-gray-300">
                            {d.provider}
                          </td>
                          <td className="px-5 py-4">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                              d.status === 'completed'
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                : d.status === 'pending'
                                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                            }`}>
                              {d.status}
                            </span>
                          </td>
                          <td className="px-5 py-4 text-gray-400 whitespace-nowrap">
                            {formatDate(d.createdAt)}
                          </td>
                          <td className="px-5 py-4 text-right">
                            <button
                              type="button"
                              onClick={() => handleReconcileDeposit(d.depositReference)}
                              disabled={reconcilingRef === d.depositReference}
                              className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white text-[11px] font-semibold border border-white/10 transition-colors disabled:opacity-50"
                              title="Reconcile with authoritative ledger"
                            >
                              {reconcilingRef === d.depositReference ? 'Reconciling...' : 'Reconcile'}
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        )}

        {/* TAB 7: WITHDRAWAL MANAGEMENT */}
        {activeTab === 'withdrawals' && (
          <div>
            <AdminWithdrawalsPage />
          </div>
        )}

        {/* TAB 8: REFERRAL MANAGEMENT */}
        {activeTab === 'referrals' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between text-xs text-gray-400">
              <span>Referral relationships and ₹300 incentive rewards credited</span>
              <span>Total Rewards Credited: <strong className="text-white">{referralsTotal}</strong></span>
            </div>

            <Card className="p-0 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-white/[0.04] text-gray-400 uppercase font-semibold border-b border-white/5">
                    <tr>
                      <th className="px-5 py-4">Reference</th>
                      <th className="px-5 py-4">Referrer (Received Bonus)</th>
                      <th className="px-5 py-4">Referred User (New Member)</th>
                      <th className="px-5 py-4">Bonus Amount</th>
                      <th className="px-5 py-4">Status</th>
                      <th className="px-5 py-4">Credited At</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {referralsLoading ? (
                      <tr>
                        <td colSpan={6} className="px-5 py-12 text-center text-gray-400">Loading referral rewards...</td>
                      </tr>
                    ) : referrals.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-5 py-12 text-center text-gray-500">No referral rewards recorded yet.</td>
                      </tr>
                    ) : (
                      referrals.map((r) => (
                        <tr key={r._id} className="hover:bg-white/[0.02]">
                          <td className="px-5 py-4 font-mono font-bold text-purple-300">
                            {r.rewardReference || r._id}
                          </td>
                          <td className="px-5 py-4">
                            <div className="font-bold text-white">{r.referrer?.name || 'Referrer'}</div>
                            <div className="text-[11px] text-gray-400">{r.referrer?.email}</div>
                            <div className="text-[10px] font-mono text-purple-400">Code: {r.referrer?.referralCode}</div>
                          </td>
                          <td className="px-5 py-4">
                            <div className="font-bold text-white">{r.referredUser?.name || 'Referred User'}</div>
                            <div className="text-[11px] text-gray-400">{r.referredUser?.email}</div>
                          </td>
                          <td className="px-5 py-4 font-bold text-emerald-400 text-sm">
                            {formatINR(r.rewardAmount || 300)}
                          </td>
                          <td className="px-5 py-4">
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                              {r.status || 'completed'}
                            </span>
                          </td>
                          <td className="px-5 py-4 text-gray-400 whitespace-nowrap">
                            {formatDate(r.createdAt)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        )}

        {/* TAB 9: PAYMENT RECORDS */}
        {activeTab === 'payments' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between text-xs text-gray-400">
              <span>Checkout transactions and payment gateway audit records</span>
              <span>Total Payment Orders: <strong className="text-white">{paymentsTotal}</strong></span>
            </div>

            <Card className="p-0 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-white/[0.04] text-gray-400 uppercase font-semibold border-b border-white/5">
                    <tr>
                      <th className="px-5 py-4">Order / Payment ID</th>
                      <th className="px-5 py-4">User</th>
                      <th className="px-5 py-4">Plan Purchased</th>
                      <th className="px-5 py-4">Amount</th>
                      <th className="px-5 py-4">Gateway</th>
                      <th className="px-5 py-4">Status</th>
                      <th className="px-5 py-4">Timestamp</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {paymentsLoading ? (
                      <tr>
                        <td colSpan={7} className="px-5 py-12 text-center text-gray-400">Loading payment records...</td>
                      </tr>
                    ) : payments.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-5 py-12 text-center text-gray-500">No payment records found.</td>
                      </tr>
                    ) : (
                      payments.map((p) => (
                        <tr key={p._id} className="hover:bg-white/[0.02]">
                          <td className="px-5 py-4 font-mono">
                            <div className="font-bold text-purple-300">{p.razorpayOrderId || p._id}</div>
                            {p.razorpayPaymentId && (
                              <div className="text-[10px] text-gray-400 font-mono">PID: {p.razorpayPaymentId}</div>
                            )}
                          </td>
                          <td className="px-5 py-4">
                            <div className="font-bold text-white">{p.user?.name || 'User'}</div>
                            <div className="text-[11px] text-gray-400">{p.user?.email}</div>
                          </td>
                          <td className="px-5 py-4 font-semibold text-purple-200">
                            {p.plan?.name || 'Cloud Investment Plan'}
                          </td>
                          <td className="px-5 py-4 font-bold text-emerald-400 text-sm">
                            {formatINR(p.amount)}
                          </td>
                          <td className="px-5 py-4 uppercase text-gray-300 font-semibold">
                            {p.paymentGateway || 'Razorpay'}
                          </td>
                          <td className="px-5 py-4">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                              p.status === 'captured' || p.status === 'completed'
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                : p.status === 'created'
                                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                            }`}>
                              {p.status}
                            </span>
                          </td>
                          <td className="px-5 py-4 text-gray-400 whitespace-nowrap">
                            {formatDate(p.createdAt)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        )}

        {/* TAB 10: REVIEW & QUARANTINE */}
        {activeTab === 'quarantine' && (
          <div>
            <AdminWithdrawalsPage />
          </div>
        )}
      </Container>
    </div>
  );
}

export default AdminDashboardPage;
