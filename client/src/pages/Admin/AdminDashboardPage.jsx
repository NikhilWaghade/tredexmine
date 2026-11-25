import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Container, Card, SectionHeader, Button } from '../../components/common';
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

  const navigateToTab = (tabId, options = {}) => {
    if (tabId === 'investments' && options.status) {
      setInvestmentsStatus(options.status);
      setInvestmentsPage(1);
    }
    if (tabId === 'payments' && options.status) {
      setPaymentsStatus(options.status);
      setPaymentsPage(1);
    }
    if (tabId === 'deposits' && options.status) {
      setDepositsStatus(options.status);
      setDepositsPage(1);
    }
    handleTabChange(tabId);
  };

  // State for Overview tab
  const [overviewMetrics, setOverviewMetrics] = useState(null);
  const [overviewLoading, setOverviewLoading] = useState(false);

  // State for Users tab
  const [users, setUsers] = useState([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [usersPage, setUsersPage] = useState(1);
  const [usersPages, setUsersPages] = useState(1);
  const [usersSearch, setUsersSearch] = useState('');
  const [usersRole, setUsersRole] = useState('');
  const [usersLoading, setUsersLoading] = useState(false);

  // State for Active Investments tab
  const [investments, setInvestments] = useState([]);
  const [investmentsTotal, setInvestmentsTotal] = useState(0);
  const [investmentsPage, setInvestmentsPage] = useState(1);
  const [investmentsPages, setInvestmentsPages] = useState(1);
  const [investmentsSearch, setInvestmentsSearch] = useState('');
  const [investmentsStatus, setInvestmentsStatus] = useState('active');
  const [investmentsLoading, setInvestmentsLoading] = useState(false);

  // State for Wallets tab
  const [wallets, setWallets] = useState([]);
  const [walletsTotal, setWalletsTotal] = useState(0);
  const [walletsPage, setWalletsPage] = useState(1);
  const [walletsPages, setWalletsPages] = useState(1);
  const [walletsSearch, setWalletsSearch] = useState('');
  const [walletsLoading, setWalletsLoading] = useState(false);

  // State for Deposits tab
  const [deposits, setDeposits] = useState([]);
  const [depositsTotal, setDepositsTotal] = useState(0);
  const [depositsPage, setDepositsPage] = useState(1);
  const [depositsPages, setDepositsPages] = useState(1);
  const [depositsSearch, setDepositsSearch] = useState('');
  const [depositsStatus, setDepositsStatus] = useState('all');
  const [depositsLoading, setDepositsLoading] = useState(false);
  const [reconcilingRef, setReconcilingRef] = useState(null);

  // State for Referrals tab
  const [referrals, setReferrals] = useState([]);
  const [referralsTotal, setReferralsTotal] = useState(0);
  const [referralsPage, setReferralsPage] = useState(1);
  const [referralsPages, setReferralsPages] = useState(1);
  const [referralsSearch, setReferralsSearch] = useState('');
  const [referralsLoading, setReferralsLoading] = useState(false);

  // State for Payments tab
  const [payments, setPayments] = useState([]);
  const [paymentsTotal, setPaymentsTotal] = useState(0);
  const [paymentsPage, setPaymentsPage] = useState(1);
  const [paymentsPages, setPaymentsPages] = useState(1);
  const [paymentsSearch, setPaymentsSearch] = useState('');
  const [paymentsStatus, setPaymentsStatus] = useState('all');
  const [paymentsLoading, setPaymentsLoading] = useState(false);

  // Feedback notifications
  const [feedback, setFeedback] = useState(null);

  // 1. Fetch Overview
  const fetchOverview = useCallback(async () => {
    setOverviewLoading(true);
    try {
      const res = await adminService.getOverview();
      if (res.success) {
        setOverviewMetrics(res.data || res);
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
        const payload = res.data || res;
        setUsers(payload.users || []);
        setUsersTotal(payload.total || 0);
        setUsersPages(payload.pages || 1);
      }
    } catch (err) {
      console.error('Failed to load users:', err);
      setFeedback({ type: 'error', message: 'Failed to load user accounts' });
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
        status: investmentsStatus,
        search: investmentsSearch,
      });
      if (res.success) {
        const payload = res.data || res;
        setInvestments(payload.investments || []);
        setInvestmentsTotal(payload.total || 0);
        setInvestmentsPages(payload.pages || 1);
      }
    } catch (err) {
      console.error('Failed to load investments:', err);
      setFeedback({ type: 'error', message: 'Failed to load investment contracts' });
    } finally {
      setInvestmentsLoading(false);
    }
  }, [investmentsPage, investmentsStatus, investmentsSearch]);

  // 4. Fetch Wallets
  const fetchWallets = useCallback(async () => {
    setWalletsLoading(true);
    try {
      const res = await adminService.getWallets({
        page: walletsPage,
        limit: 15,
        search: walletsSearch,
      });
      if (res.success) {
        const payload = res.data || res;
        setWallets(payload.wallets || []);
        setWalletsTotal(payload.total || 0);
        setWalletsPages(payload.pages || 1);
      }
    } catch (err) {
      console.error('Failed to load wallets:', err);
      setFeedback({ type: 'error', message: 'Failed to load wallet ledger records' });
    } finally {
      setWalletsLoading(false);
    }
  }, [walletsPage, walletsSearch]);

  // 5. Fetch Deposits
  const fetchDeposits = useCallback(async () => {
    setDepositsLoading(true);
    try {
      const res = await adminService.getDeposits({
        page: depositsPage,
        limit: 15,
        status: depositsStatus,
        search: depositsSearch,
      });
      if (res.success) {
        const payload = res.data || res;
        setDeposits(payload.deposits || []);
        setDepositsTotal(payload.total || 0);
        setDepositsPages(payload.pages || 1);
      }
    } catch (err) {
      console.error('Failed to load deposits:', err);
      setFeedback({ type: 'error', message: 'Failed to load deposit intents' });
    } finally {
      setDepositsLoading(false);
    }
  }, [depositsPage, depositsStatus, depositsSearch]);

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
        search: referralsSearch,
      });
      if (res.success) {
        const payload = res.data || res;
        setReferrals(payload.rewards || []);
        setReferralsTotal(payload.total || 0);
        setReferralsPages(payload.pages || 1);
      }
    } catch (err) {
      console.error('Failed to load referrals:', err);
      setFeedback({ type: 'error', message: 'Failed to load referral incentive records' });
    } finally {
      setReferralsLoading(false);
    }
  }, [referralsPage, referralsSearch]);

  // 7. Fetch Payments
  const fetchPayments = useCallback(async () => {
    setPaymentsLoading(true);
    try {
      const res = await adminService.getPayments({
        page: paymentsPage,
        limit: 15,
        status: paymentsStatus,
        search: paymentsSearch,
      });
      if (res.success) {
        const payload = res.data || res;
        setPayments(payload.payments || []);
        setPaymentsTotal(payload.total || 0);
        setPaymentsPages(payload.pages || 1);
      }
    } catch (err) {
      console.error('Failed to load payments:', err);
      setFeedback({ type: 'error', message: 'Failed to load payment checkout records' });
    } finally {
      setPaymentsLoading(false);
    }
  }, [paymentsPage, paymentsStatus, paymentsSearch]);

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
                {/* Admin Profile Banner */}
                <div className="p-6 rounded-2xl bg-gradient-to-r from-purple-950/50 via-purple-900/30 to-black/60 border border-purple-800/40 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-2xl bg-purple-600/20 border border-purple-500/40 flex items-center justify-center text-purple-300 font-extrabold text-xl shadow-inner">
                      {overviewMetrics.adminProfile?.name ? overviewMetrics.adminProfile.name.charAt(0).toUpperCase() : 'A'}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="text-xl font-extrabold text-white">
                          {overviewMetrics.adminProfile?.name || 'Administrator'}
                        </h2>
                        <span className="px-2.5 py-0.5 rounded-full bg-purple-500/20 border border-purple-500/50 text-[10px] font-bold text-purple-200 tracking-wider uppercase flex items-center gap-1">
                          <span>🛡️</span> {overviewMetrics.adminProfile?.role?.toUpperCase() || 'ADMINISTRATOR'}
                        </span>
                        <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-[10px] font-bold text-emerald-300 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          {overviewMetrics.adminProfile?.status?.toUpperCase() || 'ACTIVE'}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 mt-1.5 text-xs text-gray-400 flex-wrap">
                        <span className="flex items-center gap-1">
                          <span className="text-gray-500">Email:</span>
                          <span className="text-gray-200 font-medium">{overviewMetrics.adminProfile?.email || 'admin@minetrades.com'}</span>
                        </span>
                        <span className="hidden sm:inline text-gray-700">•</span>
                        <span className="flex items-center gap-1">
                          <span className="text-gray-500">Admin ID:</span>
                          <span className="font-mono text-purple-300">{overviewMetrics.adminProfile?.id || 'ROOT'}</span>
                        </span>
                        <span className="hidden sm:inline text-gray-700">•</span>
                        <span className="flex items-center gap-1">
                          <span className="text-gray-500">Session Verified:</span>
                          <span className="text-gray-300">{formatDate(overviewMetrics.adminProfile?.lastLogin)}</span>
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 w-full md:w-auto">
                    <button
                      onClick={fetchOverview}
                      className="px-3.5 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-gray-300 hover:text-white transition-all flex items-center gap-2 w-full sm:w-auto justify-center"
                    >
                      <svg className={`w-3.5 h-3.5 ${overviewLoading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Refresh Metrics
                    </button>
                  </div>
                </div>

                {/* 8 Interactive Overview Metric Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {/* Card 1: Total Users */}
                  <Card
                    onClick={() => navigateToTab('users')}
                    className="p-5 bg-gradient-to-br from-white/[0.04] to-transparent border-white/10 hover:border-purple-500/70 hover:bg-white/[0.06] cursor-pointer transition-all group flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-gray-400 text-xs uppercase tracking-wider font-semibold">Total Registered Users</span>
                        <span className="text-xs text-purple-400 opacity-0 group-hover:opacity-100 transition-opacity">→</span>
                      </div>
                      <div className="text-3xl font-extrabold text-white mt-2">{overviewMetrics.users?.total ?? 0}</div>
                      <div className="text-xs text-purple-300 mt-1">
                        {overviewMetrics.users?.regularUsers ?? overviewMetrics.users?.total ?? 0} regular • {overviewMetrics.users?.admins ?? 0} admin
                      </div>
                    </div>
                    <div className="mt-3 pt-2 border-t border-white/5 text-[10px] text-gray-400 group-hover:text-purple-300 transition-colors flex items-center justify-between">
                      <span>Inspect member roster</span>
                      <span>View details →</span>
                    </div>
                  </Card>

                  {/* Card 2: Active Investments */}
                  <Card
                    onClick={() => navigateToTab('investments', { status: 'active' })}
                    className="p-5 bg-gradient-to-br from-white/[0.04] to-transparent border-white/10 hover:border-purple-500/70 hover:bg-white/[0.06] cursor-pointer transition-all group flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-gray-400 text-xs uppercase tracking-wider font-semibold">Active Investments</span>
                        <span className="text-xs text-purple-400 opacity-0 group-hover:opacity-100 transition-opacity">→</span>
                      </div>
                      <div className="text-3xl font-extrabold text-white mt-2">{overviewMetrics.investments?.activePlansCount ?? 0}</div>
                      <div className="text-xs text-purple-300 mt-1">Live running compute slots</div>
                    </div>
                    <div className="mt-3 pt-2 border-t border-white/5 text-[10px] text-gray-400 group-hover:text-purple-300 transition-colors flex items-center justify-between">
                      <span>Inspect active contracts</span>
                      <span>View details →</span>
                    </div>
                  </Card>

                  {/* Card 3: Total Invested Volume */}
                  <Card
                    onClick={() => navigateToTab('payments', { status: 'captured' })}
                    className="p-5 bg-gradient-to-br from-white/[0.04] to-transparent border-white/10 hover:border-purple-500/70 hover:bg-white/[0.06] cursor-pointer transition-all group flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-gray-400 text-xs uppercase tracking-wider font-semibold">Total Invested Volume</span>
                        <span className="text-xs text-purple-400 opacity-0 group-hover:opacity-100 transition-opacity">→</span>
                      </div>
                      <div className="text-3xl font-extrabold text-purple-300 mt-2">
                        {formatINR(overviewMetrics.investments?.totalInvestedVolume ?? overviewMetrics.investments?.totalInvestmentAmount ?? 0)}
                      </div>
                      <div className="text-xs text-gray-400 mt-1">Backend verified captured orders</div>
                    </div>
                    <div className="mt-3 pt-2 border-t border-white/5 text-[10px] text-gray-400 group-hover:text-purple-300 transition-colors flex items-center justify-between">
                      <span>Inspect payment checkouts</span>
                      <span>View details →</span>
                    </div>
                  </Card>

                  {/* Card 4: Total User Balances */}
                  <Card
                    onClick={() => navigateToTab('wallets')}
                    className="p-5 bg-gradient-to-br from-white/[0.04] to-transparent border-white/10 hover:border-emerald-500/70 hover:bg-white/[0.06] cursor-pointer transition-all group flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-gray-400 text-xs uppercase tracking-wider font-semibold">Total User Balances</span>
                        <span className="text-xs text-emerald-400 opacity-0 group-hover:opacity-100 transition-opacity">→</span>
                      </div>
                      <div className="text-3xl font-extrabold text-emerald-400 mt-2">
                        {formatINR(overviewMetrics.wallets?.totalSystemBalance ?? 0)}
                      </div>
                      <div className="text-xs text-gray-400 mt-1">Authoritative wallet liabilities (excl. admin)</div>
                    </div>
                    <div className="mt-3 pt-2 border-t border-white/5 text-[10px] text-gray-400 group-hover:text-emerald-300 transition-colors flex items-center justify-between">
                      <span>Inspect user wallets</span>
                      <span>View details →</span>
                    </div>
                  </Card>

                  {/* Card 5: Pending Deposits */}
                  <Card
                    onClick={() => navigateToTab('deposits', { status: 'all' })}
                    className="p-5 bg-gradient-to-br from-white/[0.04] to-transparent border-white/10 hover:border-amber-500/70 hover:bg-white/[0.06] cursor-pointer transition-all group flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-gray-400 text-xs uppercase tracking-wider font-semibold">Pending Deposits</span>
                        <span className="text-xs text-amber-400 opacity-0 group-hover:opacity-100 transition-opacity">→</span>
                      </div>
                      <div className="text-3xl font-extrabold text-amber-400 mt-2">
                        {overviewMetrics.deposits?.pendingCount ?? 0}
                      </div>
                      <div className="text-xs text-amber-300/80 mt-1">
                        {formatINR(overviewMetrics.deposits?.pendingAmount ?? 0)} awaiting gateway capture
                      </div>
                    </div>
                    <div className="mt-3 pt-2 border-t border-white/5 text-[10px] text-gray-400 group-hover:text-amber-300 transition-colors flex items-center justify-between">
                      <span>Review pending deposits</span>
                      <span>View details →</span>
                    </div>
                  </Card>

                  {/* Card 6: Completed Deposits */}
                  <Card
                    onClick={() => navigateToTab('deposits', { status: 'completed' })}
                    className="p-5 bg-gradient-to-br from-white/[0.04] to-transparent border-white/10 hover:border-purple-500/70 hover:bg-white/[0.06] cursor-pointer transition-all group flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-gray-400 text-xs uppercase tracking-wider font-semibold">Completed Deposits</span>
                        <span className="text-xs text-purple-400 opacity-0 group-hover:opacity-100 transition-opacity">→</span>
                      </div>
                      <div className="text-2xl font-bold text-white mt-2">{formatINR(overviewMetrics.deposits?.totalAmount ?? 0)}</div>
                      <div className="text-xs text-gray-400 mt-1">{overviewMetrics.deposits?.totalCount ?? 0} successful gateway deposits</div>
                    </div>
                    <div className="mt-3 pt-2 border-t border-white/5 text-[10px] text-gray-400 group-hover:text-purple-300 transition-colors flex items-center justify-between">
                      <span>Review settled deposits</span>
                      <span>View details →</span>
                    </div>
                  </Card>

                  {/* Card 7: Pending Withdrawals */}
                  <Card
                    onClick={() => navigateToTab('withdrawals')}
                    className="p-5 bg-gradient-to-br from-white/[0.04] to-transparent border-white/10 hover:border-amber-500/70 hover:bg-white/[0.06] cursor-pointer transition-all group flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-gray-400 text-xs uppercase tracking-wider font-semibold">Pending Withdrawals</span>
                        <span className="text-xs text-amber-400 opacity-0 group-hover:opacity-100 transition-opacity">→</span>
                      </div>
                      <div className="text-3xl font-extrabold text-amber-400 mt-2">{overviewMetrics.withdrawals?.pendingCount ?? 0}</div>
                      <div className="text-xs text-amber-300/80 mt-1">Requires review & processing</div>
                    </div>
                    <div className="mt-3 pt-2 border-t border-white/5 text-[10px] text-gray-400 group-hover:text-amber-300 transition-colors flex items-center justify-between">
                      <span>Review withdrawal queue</span>
                      <span>View details →</span>
                    </div>
                  </Card>

                  {/* Card 8: Completed Payouts */}
                  <Card
                    onClick={() => navigateToTab('withdrawals')}
                    className="p-5 bg-gradient-to-br from-white/[0.04] to-transparent border-white/10 hover:border-emerald-500/70 hover:bg-white/[0.06] cursor-pointer transition-all group flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-gray-400 text-xs uppercase tracking-wider font-semibold">Completed Payouts</span>
                        <span className="text-xs text-emerald-400 opacity-0 group-hover:opacity-100 transition-opacity">→</span>
                      </div>
                      <div className="text-2xl font-bold text-white mt-2">{formatINR(overviewMetrics.withdrawals?.totalCompletedAmount ?? 0)}</div>
                      <div className="text-xs text-gray-400 mt-1">{overviewMetrics.withdrawals?.totalCompletedCount ?? 0} payouts completed</div>
                    </div>
                    <div className="mt-3 pt-2 border-t border-white/5 text-[10px] text-gray-400 group-hover:text-emerald-300 transition-colors flex items-center justify-between">
                      <span>Review completed payouts</span>
                      <span>View details →</span>
                    </div>
                  </Card>
                </div>

                {/* Quick Navigation Cards */}
                <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div
                    onClick={() => handleTabChange('users')}
                    className="p-5 rounded-2xl bg-purple-950/20 border border-purple-800/40 hover:border-purple-500 cursor-pointer transition-all"
                  >
                    <div className="text-sm font-bold text-white flex items-center justify-between">
                      <span>Users Management</span>
                      <span>→</span>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">
                      Inspect all registered members, wallet balances, plan earnings, and active cloud nodes.
                    </p>
                  </div>

                  <div
                    onClick={() => handleTabChange('investments')}
                    className="p-5 rounded-2xl bg-purple-950/20 border border-purple-800/40 hover:border-purple-500 cursor-pointer transition-all"
                  >
                    <div className="text-sm font-bold text-white flex items-center justify-between">
                      <span>Active Node Contracts</span>
                      <span>→</span>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">
                      Monitor running compute nodes, start/maturity schedules, daily yields, and purchase amounts.
                    </p>
                  </div>

                  <div
                    onClick={() => handleTabChange('withdrawals')}
                    className="p-5 rounded-2xl bg-amber-950/20 border border-amber-800/40 hover:border-amber-500 cursor-pointer transition-all"
                  >
                    <div className="text-sm font-bold text-white flex items-center justify-between">
                      <span>Withdrawal Operations</span>
                      <span>→</span>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">
                      Review submitted payout requests, reveal decrypted credentials, and approve or reject transfers.
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
                              <div className="text-[10px] text-gray-400 font-normal">By: {u.referredBy.referralCode || u.referredBy.name}</div>
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
                            <span className="px-2.5 py-0.5 rounded-full bg-purple-500/20 border border-purple-500/40 font-bold text-purple-200">
                              {u.activePlansCount || 0}
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

            {/* Pagination Controls */}
            {usersPages > 1 && (
              <div className="flex items-center justify-between text-xs text-gray-400 pt-2">
                <span>Page {usersPage} of {usersPages} ({usersTotal} users)</span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={usersPage <= 1}
                    onClick={() => setUsersPage((p) => Math.max(1, p - 1))}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={usersPage >= usersPages}
                    onClick={() => setUsersPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
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
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <input
                  type="text"
                  value={investmentsSearch}
                  onChange={(e) => {
                    setInvestmentsSearch(e.target.value);
                    setInvestmentsPage(1);
                  }}
                  placeholder="Search by user, plan name, investment ID..."
                  className="px-3.5 py-2 rounded-xl bg-black/60 border border-white/10 text-white text-xs w-full sm:w-80 focus:outline-none focus:border-purple-500"
                />
                <select
                  value={investmentsStatus}
                  onChange={(e) => {
                    setInvestmentsStatus(e.target.value);
                    setInvestmentsPage(1);
                  }}
                  className="px-3 py-2 rounded-xl bg-black/60 border border-white/10 text-white text-xs focus:outline-none focus:border-purple-500"
                >
                  <option value="active">Active Investments</option>
                  <option value="completed">Completed Investments</option>
                  <option value="cancelled">Cancelled Investments</option>
                  <option value="all">All Statuses</option>
                </select>
              </div>
              <div className="text-xs text-gray-400">
                Total Investments: <strong className="text-white">{investmentsTotal}</strong>
              </div>
            </div>

            <Card className="p-0 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-white/[0.04] text-gray-400 uppercase font-semibold border-b border-white/5">
                    <tr>
                      <th className="px-5 py-4">User</th>
                      <th className="px-5 py-4">Plan Name</th>
                      <th className="px-5 py-4">Plan Amount</th>
                      <th className="px-5 py-4">Investment ID</th>
                      <th className="px-5 py-4">Purchase Date</th>
                      <th className="px-5 py-4">Start Date</th>
                      <th className="px-5 py-4">End Date</th>
                      <th className="px-5 py-4">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {investmentsLoading ? (
                      <tr>
                        <td colSpan={8} className="px-5 py-12 text-center text-gray-400">Loading investment contracts...</td>
                      </tr>
                    ) : investments.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-5 py-12 text-center text-gray-500">No investment contracts found.</td>
                      </tr>
                    ) : (
                      investments.map((inv) => (
                        <tr key={inv._id} className="hover:bg-white/[0.02]">
                          <td className="px-5 py-4">
                            <div className="font-bold text-white">{inv.user?.name || 'Investor'}</div>
                            <div className="text-[11px] text-gray-400">{inv.user?.email}</div>
                          </td>
                          <td className="px-5 py-4">
                            <div className="font-bold text-purple-300">{inv.planName}</div>
                            {inv.hashRate && (
                              <div className="text-[10px] text-gray-400">{inv.hashRate} • {formatINR(inv.dailyYield)}/day</div>
                            )}
                          </td>
                          <td className="px-5 py-4 font-bold text-emerald-400 text-sm">
                            {formatINR(inv.planAmount || inv.price)}
                          </td>
                          <td className="px-5 py-4 font-mono text-[11px] text-purple-200">
                            {inv.investmentId || inv._id}
                          </td>
                          <td className="px-5 py-4 text-gray-400 whitespace-nowrap">
                            {formatDate(inv.createdAt)}
                          </td>
                          <td className="px-5 py-4 text-gray-300 whitespace-nowrap">
                            {formatDate(inv.startDate)}
                          </td>
                          <td className="px-5 py-4 text-gray-300 whitespace-nowrap">
                            {formatDate(inv.endDate)}
                            {inv.remainingDays != null && inv.status === 'active' && (
                              <div className="text-[10px] text-amber-300 font-semibold">{inv.remainingDays} days left</div>
                            )}
                          </td>
                          <td className="px-5 py-4">
                            <span className={`px-2.5 py-0.5 rounded text-[10px] font-bold uppercase border ${
                              inv.status === 'active'
                                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                                : inv.status === 'completed'
                                ? 'bg-blue-500/20 text-blue-300 border-blue-500/40'
                                : 'bg-gray-800 text-gray-400 border-gray-700'
                            }`}>
                              {inv.status}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* Pagination Controls */}
            {investmentsPages > 1 && (
              <div className="flex items-center justify-between text-xs text-gray-400 pt-2">
                <span>Page {investmentsPage} of {investmentsPages} ({investmentsTotal} investments)</span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={investmentsPage <= 1}
                    onClick={() => setInvestmentsPage((p) => Math.max(1, p - 1))}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={investmentsPage >= investmentsPages}
                    onClick={() => setInvestmentsPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 5: WALLET MANAGEMENT */}
        {activeTab === 'wallets' && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
              <input
                type="text"
                value={walletsSearch}
                onChange={(e) => {
                  setWalletsSearch(e.target.value);
                  setWalletsPage(1);
                }}
                placeholder="Search wallet by user name, email, referral code..."
                className="px-3.5 py-2 rounded-xl bg-black/60 border border-white/10 text-white text-xs w-full sm:w-80 focus:outline-none focus:border-purple-500"
              />
              <div className="text-xs text-gray-400">
                Total Wallets: <strong className="text-white">{walletsTotal}</strong>
              </div>
            </div>

            <Card className="p-0 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-white/[0.04] text-gray-400 uppercase font-semibold border-b border-white/5">
                    <tr>
                      <th className="px-5 py-4">User</th>
                      <th className="px-5 py-4">Wallet Balance</th>
                      <th className="px-5 py-4">Plan Income</th>
                      <th className="px-5 py-4">Referral Income</th>
                      <th className="px-5 py-4">Total Deposits</th>
                      <th className="px-5 py-4">Total Withdrawals</th>
                      <th className="px-5 py-4">Last Activity</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {walletsLoading ? (
                      <tr>
                        <td colSpan={7} className="px-5 py-12 text-center text-gray-400">Loading wallets...</td>
                      </tr>
                    ) : wallets.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-5 py-12 text-center text-gray-500">No wallets found.</td>
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
                          <td className="px-5 py-4 text-emerald-300 font-semibold">
                            {formatINR(w.totalDeposits)}
                          </td>
                          <td className="px-5 py-4 text-rose-300 font-semibold">
                            {formatINR(w.totalWithdrawals || w.totalWithdrawn)}
                          </td>
                          <td className="px-5 py-4 text-gray-400 whitespace-nowrap">
                            {formatDate(w.lastTransactionDate || w.updatedAt || w.createdAt)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* Pagination Controls */}
            {walletsPages > 1 && (
              <div className="flex items-center justify-between text-xs text-gray-400 pt-2">
                <span>Page {walletsPage} of {walletsPages} ({walletsTotal} wallets)</span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={walletsPage <= 1}
                    onClick={() => setWalletsPage((p) => Math.max(1, p - 1))}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={walletsPage >= walletsPages}
                    onClick={() => setWalletsPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 6: DEPOSIT MANAGEMENT */}
        {activeTab === 'deposits' && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <input
                  type="text"
                  value={depositsSearch}
                  onChange={(e) => {
                    setDepositsSearch(e.target.value);
                    setDepositsPage(1);
                  }}
                  placeholder="Search by reference, payment ID, user..."
                  className="px-3.5 py-2 rounded-xl bg-black/60 border border-white/10 text-white text-xs w-full sm:w-80 focus:outline-none focus:border-purple-500"
                />
                <select
                  value={depositsStatus}
                  onChange={(e) => {
                    setDepositsStatus(e.target.value);
                    setDepositsPage(1);
                  }}
                  className="px-3 py-2 rounded-xl bg-black/60 border border-white/10 text-white text-xs focus:outline-none focus:border-purple-500"
                >
                  <option value="all">All Statuses</option>
                  <option value="completed">Completed</option>
                  <option value="pending">Pending</option>
                  <option value="failed">Failed</option>
                  <option value="created">Created</option>
                </select>
              </div>
              <div className="text-xs text-gray-400">
                Total Deposits: <strong className="text-white">{depositsTotal}</strong>
              </div>
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
                      <th className="px-5 py-4">Creation Date</th>
                      <th className="px-5 py-4">Verified Date</th>
                      <th className="px-5 py-4 text-right">Reconcile</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {depositsLoading ? (
                      <tr>
                        <td colSpan={8} className="px-5 py-12 text-center text-gray-400">Loading deposits...</td>
                      </tr>
                    ) : deposits.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-5 py-12 text-center text-gray-500">No deposit records found.</td>
                      </tr>
                    ) : (
                      deposits.map((d) => (
                        <tr key={d._id} className="hover:bg-white/[0.02]">
                          <td className="px-5 py-4 font-mono">
                            <div className="font-bold text-purple-300">{d.depositReference}</div>
                            {d.paymentId && (
                              <div className="text-[10px] text-gray-400 font-mono">PID: {d.paymentId}</div>
                            )}
                            {d.orderId && !d.paymentId && (
                              <div className="text-[10px] text-gray-500 font-mono">OID: {d.orderId}</div>
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
                                : d.status === 'pending' || d.status === 'created'
                                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                            }`}>
                              {d.status}
                            </span>
                          </td>
                          <td className="px-5 py-4 text-gray-400 whitespace-nowrap">
                            {formatDate(d.createdAt)}
                          </td>
                          <td className="px-5 py-4 text-gray-400 whitespace-nowrap">
                            {formatDate(d.creditedAt)}
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

            {/* Pagination Controls */}
            {depositsPages > 1 && (
              <div className="flex items-center justify-between text-xs text-gray-400 pt-2">
                <span>Page {depositsPage} of {depositsPages} ({depositsTotal} deposits)</span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={depositsPage <= 1}
                    onClick={() => setDepositsPage((p) => Math.max(1, p - 1))}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={depositsPage >= depositsPages}
                    onClick={() => setDepositsPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
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
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
              <input
                type="text"
                value={referralsSearch}
                onChange={(e) => {
                  setReferralsSearch(e.target.value);
                  setReferralsPage(1);
                }}
                placeholder="Search referrals by user, referral code, reference..."
                className="px-3.5 py-2 rounded-xl bg-black/60 border border-white/10 text-white text-xs w-full sm:w-80 focus:outline-none focus:border-purple-500"
              />
              <div className="text-xs text-gray-400">
                Total Rewards Credited: <strong className="text-white">{referralsTotal}</strong>
              </div>
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

            {/* Pagination Controls */}
            {referralsPages > 1 && (
              <div className="flex items-center justify-between text-xs text-gray-400 pt-2">
                <span>Page {referralsPage} of {referralsPages} ({referralsTotal} rewards)</span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={referralsPage <= 1}
                    onClick={() => setReferralsPage((p) => Math.max(1, p - 1))}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={referralsPage >= referralsPages}
                    onClick={() => setReferralsPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 9: PAYMENT RECORDS */}
        {activeTab === 'payments' && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <input
                  type="text"
                  value={paymentsSearch}
                  onChange={(e) => {
                    setPaymentsSearch(e.target.value);
                    setPaymentsPage(1);
                  }}
                  placeholder="Search by order ID, payment ID, receipt, user..."
                  className="px-3.5 py-2 rounded-xl bg-black/60 border border-white/10 text-white text-xs w-full sm:w-80 focus:outline-none focus:border-purple-500"
                />
                <select
                  value={paymentsStatus}
                  onChange={(e) => {
                    setPaymentsStatus(e.target.value);
                    setPaymentsPage(1);
                  }}
                  className="px-3 py-2 rounded-xl bg-black/60 border border-white/10 text-white text-xs focus:outline-none focus:border-purple-500"
                >
                  <option value="all">All Statuses</option>
                  <option value="captured">Captured</option>
                  <option value="created">Created</option>
                  <option value="failed">Failed</option>
                  <option value="refunded">Refunded</option>
                </select>
              </div>
              <div className="text-xs text-gray-400">
                Total Payment Orders: <strong className="text-white">{paymentsTotal}</strong>
              </div>
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
                            <div className="font-bold text-purple-300">{p.orderId || p.razorpayOrderId || p._id}</div>
                            {(p.paymentId || p.razorpayPaymentId) && (
                              <div className="text-[10px] text-gray-400 font-mono">PID: {p.paymentId || p.razorpayPaymentId}</div>
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
                            {p.gateway || p.paymentGateway || 'Razorpay'}
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

            {/* Pagination Controls */}
            {paymentsPages > 1 && (
              <div className="flex items-center justify-between text-xs text-gray-400 pt-2">
                <span>Page {paymentsPage} of {paymentsPages} ({paymentsTotal} payments)</span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={paymentsPage <= 1}
                    onClick={() => setPaymentsPage((p) => Math.max(1, p - 1))}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={paymentsPage >= paymentsPages}
                    onClick={() => setPaymentsPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
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
