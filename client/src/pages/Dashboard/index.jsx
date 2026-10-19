import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context';
import { dashboardService, planService, walletService } from '../../services';
import { Container, Button, Card, SectionHeader } from '../../components/common';
import { ROUTES } from '../../constants';

// Pure date formatting helpers placed outside component
function formatDate(dateString) {
  if (!dateString) return 'N/A';
  try {
    const d = new Date(dateString);
    return d.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return String(dateString);
  }
}

function formatDateTime(dateString) {
  if (!dateString) return 'N/A';
  try {
    const d = new Date(dateString);
    return d.toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(dateString);
  }
}

export function DashboardPage() {
  const { user, wallet: contextWallet, isAuthenticated, isLoading: isAuthLoading, openAuthModal, refreshWallet } = useAuth();

  const [dashboardData, setDashboardData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Consolidated and resilient data fetch using existing authenticated APIs
  const reloadDashboard = useCallback(async () => {
    if (!isAuthenticated) return;
    setLoading(true);
    setError(null);

    try {
      // Parallel fetch from authenticated backend APIs
      const [dashResult, activePlansResult, walletResult, txResult] = await Promise.allSettled([
        dashboardService.getDashboard(),
        planService.getMyActivePlans(),
        walletService.getWallet(),
        walletService.getTransactions({ limit: 10 }),
      ]);

      let consolidatedData = null;
      if (dashResult.status === 'fulfilled' && dashResult.value?.success && dashResult.value?.data) {
        consolidatedData = dashResult.value.data;
      }

      // 1. Active plans: derive from active-plan API or consolidated dashboard
      let activePlansList = consolidatedData?.activePlans?.plans || [];
      let activePlansCount = consolidatedData?.activePlans?.count || activePlansList.length;

      if (activePlansResult.status === 'fulfilled' && activePlansResult.value?.success) {
        const rawPlans = activePlansResult.value.userPlans || [];
        activePlansCount = activePlansResult.value.count ?? rawPlans.length;
        const nowMs = Date.now();
        activePlansList = rawPlans.map((p) => {
          const endMs = p.endDate ? new Date(p.endDate).getTime() : nowMs;
          const calcRemaining = Math.max(0, Math.ceil((endMs - nowMs) / (1000 * 60 * 60 * 24)));
          return {
            id: p._id || p.id,
            planId: p.plan,
            name: p.planName || p.name || 'Mining Plan',
            price: p.price,
            durationDays: p.durationDays,
            dailyRoiRate: p.dailyRoiRate,
            hashRate: p.hashRate || 'Standard',
            features: p.features || [],
            startDate: p.startDate,
            endDate: p.endDate,
            status: p.status || 'active',
            remainingDays: p.remainingDays ?? calcRemaining,
          };
        });
      }

      // 2. Wallet balance: derive from wallet API or consolidated dashboard
      let walletData = consolidatedData?.wallet || {
        balance: contextWallet?.balance != null ? Number(contextWallet.balance) : 0,
        currency: 'INR',
      };
      if (walletResult.status === 'fulfilled' && walletResult.value?.success && walletResult.value?.wallet) {
        walletData = {
          ...walletData,
          ...walletResult.value.wallet,
        };
      }

      // 3. Transactions: derive from transaction API or consolidated dashboard
      let transactionsList = consolidatedData?.recentTransactions || [];
      if (txResult.status === 'fulfilled' && txResult.value?.success && Array.isArray(txResult.value?.transactions)) {
        transactionsList = txResult.value.transactions.map((tx) => ({
          id: tx._id || tx.id,
          type: tx.type,
          amount: tx.amount,
          description: tx.description,
          status: tx.status,
          reference: tx.reference,
          date: tx.createdAt || tx.date,
        }));
      }

      // 4. Honest verified earnings: derived strictly from verified ledger records
      const earningsData = consolidatedData?.earnings || {
        today: 0,
        total: 0,
        currency: 'INR',
        status: 'not_configured',
        isConfigured: false,
        message: 'Automated income distribution ledger is not configured. No verified earnings records exist.',
      };

      if (!consolidatedData && activePlansResult.status === 'rejected' && walletResult.status === 'rejected') {
        throw new Error('Failed to load dashboard data from server.');
      }

      setDashboardData({
        user: consolidatedData?.user || user,
        wallet: walletData,
        activePlans: {
          count: activePlansCount,
          plans: activePlansList,
        },
        earnings: earningsData,
        recentTransactions: transactionsList,
      });
      setError(null);
    } catch (err) {
      console.error('[DashboardPage] Error fetching dashboard data:', err);
      const message =
        err.response?.data?.message ||
        (err.request
          ? 'Network error: Unable to contact server. Please check your internet connection.'
          : err.message || 'Failed to load user dashboard.');
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, user, contextWallet]);

  // Initial load & real-time refresh listener
  useEffect(() => {
    let isMounted = true;

    if (!isAuthLoading && isAuthenticated) {
      Promise.resolve().then(() => {
        if (isMounted) {
          reloadDashboard();
        }
      });
    }

    const handleRefresh = () => {
      if (isMounted && isAuthenticated) {
        reloadDashboard();
      }
    };

    window.addEventListener('treadex:refresh', handleRefresh);
    window.addEventListener('wallet:updated', handleRefresh);

    return () => {
      isMounted = false;
      window.removeEventListener('treadex:refresh', handleRefresh);
      window.removeEventListener('wallet:updated', handleRefresh);
    };
  }, [isAuthLoading, isAuthenticated, reloadDashboard]);

  // Synchronize dashboard and wallet balances
  const handleSync = async () => {
    await Promise.allSettled([reloadDashboard(), refreshWallet()]);
  };

  // 1. Unauthorized State
  if (!isAuthLoading && !isAuthenticated) {
    return (
      <div className="py-16 sm:py-24">
        <Container>
          <div className="max-w-md mx-auto text-center p-8 sm:p-10 rounded-2xl bg-[#0e081e] border border-purple-900/60 shadow-2xl shadow-purple-950/80">
            <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-purple-950/60 border border-purple-800/60 flex items-center justify-center text-purple-400">
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <h3 className="text-xl font-bold text-white mb-2 tracking-tight">Authentication Required</h3>
            <p className="text-sm text-gray-400 mb-6 leading-relaxed">
              Please sign in or create an account to view your computational nodes, wallet ledger, and transaction history.
            </p>
            <Button onClick={openAuthModal} variant="primary" size="md" className="w-full">
              Sign In / Register
            </Button>
          </div>
        </Container>
      </div>
    );
  }

  // 2. Loading State
  if (isAuthLoading || (loading && !dashboardData)) {
    return (
      <div className="py-12 sm:py-20">
        <Container>
          <div className="space-y-8 animate-pulse">
            <div className="h-12 w-64 bg-white/5 rounded-xl mb-4" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-32 bg-white/[0.03] border border-purple-900/20 rounded-2xl p-6" />
              ))}
            </div>
            <div className="h-64 bg-white/[0.03] border border-purple-900/20 rounded-2xl" />
          </div>
        </Container>
      </div>
    );
  }

  // 3. Network or Server Error State
  if (error && !dashboardData) {
    return (
      <div className="py-16 sm:py-24">
        <Container>
          <div className="max-w-lg mx-auto text-center p-8 rounded-2xl bg-[#0e081e] border border-rose-900/40">
            <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-rose-950/60 border border-rose-800/60 flex items-center justify-center text-rose-400">
              <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h3 className="text-xl font-bold text-white mb-2">Dashboard Error</h3>
            <p className="text-sm text-gray-400 mb-6">{error}</p>
            <Button onClick={reloadDashboard} variant="primary" size="md">
              Retry Loading Dashboard
            </Button>
          </div>
        </Container>
      </div>
    );
  }

  const {
    wallet = { balance: 0 },
    activePlans = { count: 0, plans: [] },
    earnings = { today: 0, total: 0, isConfigured: false },
    recentTransactions = [],
  } = dashboardData || {};

  return (
    <div className="py-10 sm:py-16 flex flex-col gap-10">
      <Container>
        {/* Top Header & User Status Bar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
          <div>
            <SectionHeader
              badge="Terminal Overview"
              title={`Welcome back, ${user?.name || 'Miner'}`}
              description="Real-time telemetrics for your computational nodes, wallet balance, and verified ledger transactions."
              align="left"
            />
            {user?.referralCode && (
              <div className="mt-2 inline-flex items-center gap-2 px-3 py-1 rounded-lg bg-purple-950/40 border border-purple-800/30 text-xs text-purple-300">
                <span className="text-gray-400">Referral Code:</span>
                <span className="font-mono font-bold text-white">{user.referralCode}</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            <button
              onClick={handleSync}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-gray-300 hover:text-white transition-all w-full sm:w-auto"
              title="Synchronize real-time metrics"
            >
              <svg className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Sync Dashboard
            </button>

            <Link to={ROUTES.PLANS} className="w-full sm:w-auto">
              <Button variant="primary" size="md" className="w-full">
                + Browse Plans
              </Button>
            </Link>
          </div>
        </div>

        {/* 4 Core Financial & Node Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-10">
          {/* Card 1: Wallet Balance */}
          <Card className="bg-white/[0.03] border-purple-900/40 p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs uppercase tracking-wider text-gray-400 font-semibold">
                Wallet Balance
              </span>
              <div className="w-8 h-8 rounded-lg bg-emerald-950/60 border border-emerald-800/40 flex items-center justify-center text-emerald-400">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                </svg>
              </div>
            </div>
            <div className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              ₹{Number(wallet.balance || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <p className="text-[11px] text-gray-400 mt-2">Available for node deployment or withdrawals</p>
          </Card>

          {/* Card 2: Active Plans Count */}
          <Card className="bg-white/[0.03] border-purple-900/40 p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs uppercase tracking-wider text-gray-400 font-semibold">
                Active Nodes
              </span>
              <div className="w-8 h-8 rounded-lg bg-purple-950/60 border border-purple-800/40 flex items-center justify-center text-purple-400">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
            </div>
            <div className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight flex items-baseline gap-2">
              <span>{activePlans.count}</span>
              <span className="text-xs font-semibold text-emerald-400">
                {activePlans.count > 0 ? 'Online' : 'Idle'}
              </span>
            </div>
            <p className="text-[11px] text-gray-400 mt-2">Live computational mining capacity</p>
          </Card>

          {/* Card 3: Today's Verified Earnings */}
          <Card className="bg-white/[0.03] border-purple-900/40 p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs uppercase tracking-wider text-gray-400 font-semibold">
                Today's Earnings
              </span>
              <div className="w-8 h-8 rounded-lg bg-blue-950/60 border border-blue-800/40 flex items-center justify-center text-blue-400">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            </div>
            <div className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              {earnings.isConfigured ? (
                `₹${Number(earnings.today || 0).toLocaleString('en-IN')}`
              ) : (
                <span className="text-gray-400 text-lg">₹0</span>
              )}
            </div>
            <p className="text-[11px] text-gray-400 mt-2">
              {earnings.isConfigured ? 'Settled daily yield' : 'Automated payouts not configured'}
            </p>
          </Card>

          {/* Card 4: Total Verified Earnings */}
          <Card className="bg-white/[0.03] border-purple-900/40 p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs uppercase tracking-wider text-gray-400 font-semibold">
                Total Verified Earnings
              </span>
              <div className="w-8 h-8 rounded-lg bg-amber-950/60 border border-amber-800/40 flex items-center justify-center text-amber-400">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
            </div>
            <div className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              {earnings.isConfigured ? (
                `₹${Number(earnings.total || 0).toLocaleString('en-IN')}`
              ) : (
                <span className="text-gray-400 text-lg">₹0</span>
              )}
            </div>
            <p className="text-[11px] text-gray-400 mt-2">
              {earnings.isConfigured ? 'Cumulative ledger settlement' : 'Verified payout ledger pending'}
            </p>
          </Card>
        </div>

        {/* Ledger Integrity Notice */}
        <div className="mb-10 p-4 rounded-xl bg-purple-950/20 border border-purple-900/30 flex items-start gap-3 text-xs text-gray-300">
          <svg className="w-4 h-4 text-[#7A56D6] flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div>
            <span className="font-semibold text-white block mb-0.5">Verified Ledger Policy</span>
            <span className="text-gray-400 leading-relaxed">
              TreadExMine strictly derives income metrics from authenticated, settled transaction records.
              In accordance with financial compliance, unverified or fabricated daily ROI is never calculated or credited.
            </span>
          </div>
        </div>

        {/* Active Node Subscriptions */}
        <div className="mb-12">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Active Node Subscriptions ({activePlans.count})
            </h3>
            <Link to={ROUTES.PLANS} className="text-xs text-purple-300 hover:text-white transition-colors">
              Explore All Plans →
            </Link>
          </div>

          {activePlans.plans.length === 0 ? (
            <div className="p-8 sm:p-12 text-center rounded-2xl bg-white/[0.02] border border-purple-900/30">
              <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-purple-950/60 border border-purple-800/40 flex items-center justify-center text-purple-400">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
              </div>
              <h4 className="text-base font-semibold text-white mb-1">No Active Plans Deployed</h4>
              <p className="text-xs text-gray-400 max-w-sm mx-auto mb-5">
                You do not have any active computational clusters running. Select a package from the catalog to allocate hashrate.
              </p>
              <Link to={ROUTES.PLANS}>
                <Button variant="primary" size="sm">
                  Deploy First Mining Node
                </Button>
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {activePlans.plans.map((p) => {
                const remaining = p.remainingDays ?? 0;
                return (
                  <div
                    key={p.id}
                    className="p-5 rounded-2xl bg-white/[0.03] border border-purple-900/40 hover:border-[#7A56D6]/60 transition-all flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-base font-bold text-white">{p.name}</span>
                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold text-emerald-300 bg-emerald-950/60 border border-emerald-800/40 uppercase">
                          {p.status}
                        </span>
                      </div>

                      <div className="space-y-2 text-xs mb-4">
                        <div className="flex justify-between text-gray-400">
                          <span>Purchase Price:</span>
                          <span className="text-white font-semibold">₹{Number(p.price).toLocaleString('en-IN')}</span>
                        </div>
                        <div className="flex justify-between text-gray-400">
                          <span>Hash Capacity:</span>
                          <span className="text-purple-300 font-semibold">{p.hashRate || 'Standard'}</span>
                        </div>
                        <div className="flex justify-between text-gray-400">
                          <span>Activated:</span>
                          <span className="text-gray-300">{formatDate(p.startDate)}</span>
                        </div>
                        <div className="flex justify-between text-gray-400">
                          <span>Expires:</span>
                          <span className="text-gray-300">{formatDate(p.endDate)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-white/10 flex items-center justify-between text-[11px]">
                      <span className="text-gray-400">Remaining Term:</span>
                      <span className="font-bold text-purple-300">{remaining} Days Left</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Recent Transactions Ledger */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <svg className="w-5 h-5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
              </svg>
              Recent Transactions Ledger
            </h3>
            <span className="text-xs text-gray-400">Latest activity records</span>
          </div>

          {recentTransactions.length === 0 ? (
            <div className="p-8 text-center rounded-2xl bg-white/[0.02] border border-white/10 text-xs text-gray-400">
              No recent transactions recorded on your account ledger.
            </div>
          ) : (
            <div className="rounded-2xl border border-white/10 bg-white/[0.02] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-white/5 border-b border-white/10 text-gray-400 font-semibold uppercase tracking-wider text-[10px]">
                    <tr>
                      <th className="py-3 px-4">Date & Time</th>
                      <th className="py-3 px-4">Type</th>
                      <th className="py-3 px-4">Description</th>
                      <th className="py-3 px-4 text-right">Amount</th>
                      <th className="py-3 px-4 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-gray-300">
                    {recentTransactions.map((tx) => {
                      const isCredit = tx.type === 'credit';
                      return (
                        <tr key={tx.id} className="hover:bg-white/[0.02] transition-colors">
                          <td className="py-3.5 px-4 whitespace-nowrap text-gray-400">
                            {formatDateTime(tx.date)}
                          </td>
                          <td className="py-3.5 px-4 whitespace-nowrap">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                                isCredit
                                  ? 'bg-emerald-950/60 border border-emerald-800/40 text-emerald-400'
                                  : 'bg-rose-950/60 border border-rose-800/40 text-rose-400'
                              }`}
                            >
                              {tx.type}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 max-w-xs truncate text-white">
                            {tx.description || 'General Account Transaction'}
                          </td>
                          <td
                            className={`py-3.5 px-4 whitespace-nowrap text-right font-bold ${
                              isCredit ? 'text-emerald-400' : 'text-rose-400'
                            }`}
                          >
                            {isCredit ? '+' : '-'}₹{Number(tx.amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          <td className="py-3.5 px-4 whitespace-nowrap text-center">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                                tx.status === 'completed'
                                  ? 'text-emerald-300 bg-emerald-950/40'
                                  : tx.status === 'pending'
                                  ? 'text-amber-300 bg-amber-950/40'
                                  : 'text-rose-300 bg-rose-950/40'
                              }`}
                            >
                              {tx.status}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </Container>
    </div>
  );
}

export default DashboardPage;
