import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context';
import { dashboardService, planService, walletService } from '../../services';
import { Container, Button, Card, SectionHeader } from '../../components/common';
import { ROUTES } from '../../constants';

// Pure date formatting helpers
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

function formatINR(val) {
  const num = Number(val || 0);
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(num);
}

export function DashboardPage() {
  const { user, wallet: contextWallet, isAuthenticated, isLoading: isAuthLoading, openAuthModal, refreshWallet } = useAuth();

  const [dashboardData, setDashboardData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [copiedCode, setCopiedCode] = useState(false);

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
        walletService.getTransactions({ limit: 15 }),
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
          const dailyRoi = Number(p.dailyRoiRate || 0.01);
          const dailyEarning = p.price && dailyRoi ? Math.round(p.price * dailyRoi * 100) / 100 : 0;
          return {
            id: p._id || p.id,
            planId: p.plan,
            name: p.planName || p.name || 'Mining Plan',
            planName: p.planName || p.name || 'Mining Plan',
            price: Number(p.price || 0),
            purchaseAmount: Number(p.price || 0),
            purchaseDate: p.createdAt || p.startDate,
            durationDays: p.durationDays || 30,
            totalDuration: `${p.durationDays || 30} Days`,
            dailyRoiRate: dailyRoi,
            dailyEarning,
            hashRate: p.hashRate || 'Standard',
            features: p.features || [],
            startDate: p.startDate,
            endDate: p.endDate,
            status: p.status || 'active',
            remainingDays: p.remainingDays ?? calcRemaining,
            totalVerifiedEarning: 0,
          };
        });
      }

      // 2. Wallet balance: derive from wallet API or consolidated dashboard
      let walletData = consolidatedData?.wallet || {
        balance: contextWallet?.balance != null ? Number(contextWallet.balance) : 0,
        currency: 'INR',
        planIncome: 0,
        referralIncome: 0,
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

      // 5. Daily earnings history
      const dailyEarningsList = consolidatedData?.dailyEarningsHistory || [];

      // 6. Purchased plans
      const purchasedPlansList = consolidatedData?.purchasedPlans || activePlansList;

      // 7. Referral summary
      const referralSummaryData = consolidatedData?.referralSummary || {
        referralCode: user?.referralCode || consolidatedData?.user?.referralCode,
        totalReferrals: 0,
        rewardedReferrals: 0,
        totalRewardsEarned: Number(walletData.referralIncome || 0),
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
        purchasedPlans: purchasedPlansList,
        earnings: earningsData,
        dailyEarningsHistory: dailyEarningsList,
        referralSummary: referralSummaryData,
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

    window.addEventListener('minetrades:refresh', handleRefresh);
    window.addEventListener('treadex:refresh', handleRefresh);
    window.addEventListener('wallet:updated', handleRefresh);

    return () => {
      isMounted = false;
      window.removeEventListener('minetrades:refresh', handleRefresh);
      window.removeEventListener('treadex:refresh', handleRefresh);
      window.removeEventListener('wallet:updated', handleRefresh);
    };
  }, [isAuthLoading, isAuthenticated, reloadDashboard]);

  // Synchronize dashboard and wallet balances
  const handleSync = async () => {
    await Promise.allSettled([reloadDashboard(), refreshWallet()]);
  };

  const handleCopyReferral = () => {
    const code = dashboardData?.user?.referralCode || user?.referralCode;
    if (code) {
      navigator.clipboard.writeText(code);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    }
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
            <div className="h-28 bg-white/[0.03] border border-purple-900/20 rounded-2xl" />
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
    user: profileUser = user,
    wallet = { balance: 0 },
    activePlans = { count: 0, plans: [] },
    purchasedPlans = [],
    earnings = { today: 0, total: 0, isConfigured: false },
    dailyEarningsHistory = [],
    referralSummary = null,
    recentTransactions = [],
  } = dashboardData || {};

  const displayedPlans = purchasedPlans.length > 0 ? purchasedPlans : activePlans.plans;

  return (
    <div className="py-10 sm:py-16 flex flex-col gap-10">
      <Container>
        {/* User Profile Banner */}
        <div className="mb-8 p-6 rounded-2xl bg-gradient-to-r from-purple-950/40 via-purple-900/20 to-black/60 border border-purple-800/40 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-purple-600/20 border border-purple-500/40 flex items-center justify-center text-purple-300 font-extrabold text-xl shadow-inner">
              {profileUser?.name ? profileUser.name.charAt(0).toUpperCase() : 'M'}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-xl font-extrabold text-white">
                  {profileUser?.name || 'Miner'}
                </h2>
                <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-[10px] font-bold text-emerald-300 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  {profileUser?.accountStatus === 'suspended' ? 'SUSPENDED' : 'ACTIVE'}
                </span>
                <span className="px-2 py-0.5 rounded-full bg-purple-500/20 border border-purple-500/40 text-[10px] font-bold text-purple-300 uppercase">
                  {profileUser?.role || 'USER'}
                </span>
              </div>
              <div className="flex items-center gap-4 mt-1.5 text-xs text-gray-400 flex-wrap">
                <span className="flex items-center gap-1">
                  <span className="text-gray-500">Email:</span>
                  <span className="text-gray-200 font-medium">{profileUser?.email || 'N/A'}</span>
                </span>
                <span className="hidden sm:inline text-gray-700">•</span>
                <span className="flex items-center gap-1">
                  <span className="text-gray-500">User ID:</span>
                  <span className="font-mono text-purple-300">{profileUser?.id || profileUser?._id || 'N/A'}</span>
                </span>
                <span className="hidden sm:inline text-gray-700">•</span>
                <span className="flex items-center gap-1">
                  <span className="text-gray-500">Registered:</span>
                  <span className="text-gray-300">{formatDate(profileUser?.registrationDate || profileUser?.createdAt)}</span>
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 w-full md:w-auto">
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
              <Button variant="primary" size="md" className="w-full whitespace-nowrap">
                + Browse Plans
              </Button>
            </Link>
          </div>
        </div>

        {/* 4 Core Financial & Node Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-10">
          {/* Card 1: Wallet Balance */}
          <Card className="bg-white/[0.03] border-purple-900/40 p-5 flex flex-col justify-between">
            <div>
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
                {formatINR(wallet.balance)}
              </div>
            </div>
            <div className="mt-4 flex items-center gap-2">
              <Link
                to={ROUTES.WALLET}
                className="flex-1 text-center py-2 px-2 rounded-xl bg-[#7A56D6]/20 hover:bg-[#7A56D6]/40 text-purple-200 hover:text-white border border-[#7A56D6]/40 text-xs font-semibold transition-all"
              >
                + Deposit
              </Link>
              <Link
                to={ROUTES.WALLET}
                className="flex-1 text-center py-2 px-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white border border-white/10 text-xs font-semibold transition-all"
              >
                Withdraw
              </Link>
            </div>
          </Card>

          {/* Card 2: Active Investments Count */}
          <Card className="bg-white/[0.03] border-purple-900/40 p-5 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs uppercase tracking-wider text-gray-400 font-semibold">
                  Active Investments
                </span>
                <div className="w-8 h-8 rounded-lg bg-purple-950/60 border border-purple-800/40 flex items-center justify-center text-purple-400">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
              </div>
              <div className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight flex items-baseline gap-2">
                <span>{activePlans.count}</span>
                <span className={`text-xs font-semibold ${activePlans.count > 0 ? 'text-emerald-400' : 'text-gray-400'}`}>
                  {activePlans.count > 0 ? 'Online' : 'Idle'}
                </span>
              </div>
            </div>
            <p className="text-[11px] text-gray-400 mt-3">Live computational mining nodes</p>
          </Card>

          {/* Card 3: Today's Verified Earnings */}
          <Card className="bg-white/[0.03] border-purple-900/40 p-5 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs uppercase tracking-wider text-gray-400 font-semibold">
                  Today's Verified Earnings
                </span>
                <div className="w-8 h-8 rounded-lg bg-blue-950/60 border border-blue-800/40 flex items-center justify-center text-blue-400">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
              </div>
              <div className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                {earnings.isConfigured ? formatINR(earnings.today) : <span className="text-gray-400 text-2xl">₹0.00</span>}
              </div>
            </div>
            <p className="text-[11px] text-gray-400 mt-3">
              {earnings.isConfigured ? 'Settled daily yield' : 'Automated distributions pending'}
            </p>
          </Card>

          {/* Card 4: Total Verified Earnings */}
          <Card className="bg-white/[0.03] border-purple-900/40 p-5 flex flex-col justify-between">
            <div>
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
                {earnings.isConfigured ? formatINR(earnings.total) : <span className="text-gray-400 text-2xl">₹0.00</span>}
              </div>
            </div>
            <p className="text-[11px] text-gray-400 mt-3">
              {earnings.isConfigured ? 'Cumulative ledger settlement' : 'Ledger settlement not configured'}
            </p>
          </Card>
        </div>

        {/* Referral Overview Widget */}
        <div className="mb-10 p-6 rounded-2xl bg-purple-950/20 border border-purple-800/40 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-base">🎁</span>
              <h3 className="text-base font-bold text-white">Refer & Earn Program</h3>
            </div>
            <p className="text-xs text-gray-300 leading-relaxed max-w-xl">
              Invite friends to Minetrades. Earn instant wallet cash rewards whenever your referred miners activate an investment plan.
            </p>
            <div className="mt-4 flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-black/60 border border-purple-700/50">
                <span className="text-xs text-gray-400">Referral Code:</span>
                <span className="font-mono font-bold text-purple-300 text-sm">
                  {dashboardData?.user?.referralCode || user?.referralCode || 'N/A'}
                </span>
                <button
                  onClick={handleCopyReferral}
                  className="ml-2 px-2.5 py-1 rounded-lg bg-purple-600/30 hover:bg-purple-600/50 text-[11px] font-semibold text-purple-200 transition-all flex items-center gap-1"
                  title="Copy referral code"
                >
                  {copiedCode ? (
                    <span className="text-emerald-400 font-bold">✓ Copied!</span>
                  ) : (
                    <span>Copy Code</span>
                  )}
                </button>
              </div>

              <div className="px-3 py-1.5 rounded-xl bg-white/[0.03] border border-white/10 text-xs text-gray-300">
                Total Referrals: <strong className="text-white">{referralSummary?.totalReferrals ?? 0}</strong>
              </div>

              <div className="px-3 py-1.5 rounded-xl bg-white/[0.03] border border-white/10 text-xs text-gray-300">
                Rewards Earned: <strong className="text-emerald-400">{formatINR(referralSummary?.totalRewardsEarned ?? wallet.referralIncome ?? 0)}</strong>
              </div>
            </div>
          </div>

          <Link to={ROUTES.REFERRALS} className="w-full md:w-auto">
            <Button variant="secondary" size="sm" className="w-full whitespace-nowrap">
              View Refer & Earn Program →
            </Button>
          </Link>
        </div>

        {/* Purchased Plan Details Section (10 Fields) */}
        <div className="mb-12">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Purchased Plan Details ({displayedPlans.length})
            </h3>
            <Link to={ROUTES.PLANS} className="text-xs text-purple-300 hover:text-white transition-colors">
              Explore All Plans →
            </Link>
          </div>

          {displayedPlans.length === 0 ? (
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {displayedPlans.map((p) => {
                const remaining = p.remainingDays ?? 0;
                const dailyEarningCalc = p.dailyEarning || (p.price && p.dailyRoiRate ? Math.round(p.price * p.dailyRoiRate * 100) / 100 : 0);
                const dailyPercent = p.dailyRoiRate ? (p.dailyRoiRate * 100).toFixed(2) : '1.00';
                return (
                  <div
                    key={p.id}
                    className="p-6 rounded-2xl bg-white/[0.03] border border-purple-900/40 hover:border-[#7A56D6]/60 transition-all flex flex-col justify-between"
                  >
                    <div>
                      {/* 1. Plan Name & 10. Status */}
                      <div className="flex items-center justify-between mb-4 pb-3 border-b border-white/5">
                        <div className="flex items-center gap-2">
                          <span className="text-lg font-bold text-white">{p.planName || p.name}</span>
                          {p.hashRate && (
                            <span className="text-[10px] text-purple-300 font-semibold px-2 py-0.5 rounded bg-purple-950/60 border border-purple-800/40">
                              {p.hashRate}
                            </span>
                          )}
                        </div>
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase border ${
                            p.status === 'active'
                              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                              : p.status === 'completed'
                              ? 'bg-blue-500/20 text-blue-300 border-blue-500/40'
                              : 'bg-gray-800 text-gray-400 border-gray-700'
                          }`}
                        >
                          {p.status}
                        </span>
                      </div>

                      {/* 10 Required Data Fields */}
                      <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs mb-4">
                        {/* 2. Purchase Amount */}
                        <div>
                          <span className="text-gray-400 block text-[11px]">Purchase Amount</span>
                          <span className="text-white font-bold text-sm">
                            {formatINR(p.purchaseAmount || p.price)}
                          </span>
                        </div>

                        {/* 8. Daily Earning Amount */}
                        <div>
                          <span className="text-gray-400 block text-[11px]">Daily Earning Amount</span>
                          <span className="text-emerald-400 font-bold text-sm">
                            {formatINR(dailyEarningCalc)} <span className="text-[10px] font-normal text-gray-400">({dailyPercent}%/day)</span>
                          </span>
                        </div>

                        {/* 3. Purchase Date */}
                        <div>
                          <span className="text-gray-400 block text-[11px]">Purchase Date</span>
                          <span className="text-gray-200">{formatDate(p.purchaseDate || p.createdAt || p.startDate)}</span>
                        </div>

                        {/* 6. Total Duration */}
                        <div>
                          <span className="text-gray-400 block text-[11px]">Total Duration</span>
                          <span className="text-gray-200 font-medium">{p.totalDuration || `${p.durationDays || 30} Days`}</span>
                        </div>

                        {/* 4. Start Date */}
                        <div>
                          <span className="text-gray-400 block text-[11px]">Start Date</span>
                          <span className="text-gray-200">{formatDate(p.startDate)}</span>
                        </div>

                        {/* 5. End Date */}
                        <div>
                          <span className="text-gray-400 block text-[11px]">End Date</span>
                          <span className="text-gray-200">{formatDate(p.endDate)}</span>
                        </div>

                        {/* 7. Remaining Days */}
                        <div>
                          <span className="text-gray-400 block text-[11px]">Remaining Days</span>
                          <span className="text-purple-300 font-bold">
                            {remaining > 0 ? `${remaining} Days Left` : 'Matured / Expired'}
                          </span>
                        </div>

                        {/* 9. Total Verified Earning */}
                        <div>
                          <span className="text-gray-400 block text-[11px]">Total Verified Earning</span>
                          <span className="text-emerald-300 font-semibold">
                            {formatINR(p.totalVerifiedEarning || 0)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-white/5 flex items-center justify-between text-[11px] text-gray-400">
                      <span>Node Status: <strong className="text-white capitalize">{p.status}</strong></span>
                      <span className="font-mono text-purple-300 text-[10px]">Slot ID: {String(p.id).substring(0, 10)}...</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Daily Earning History Section */}
        <div className="mb-12">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Daily Earning History
              </h3>
              <p className="text-xs text-gray-400">Direct ledger credits from verified network settlement batches</p>
            </div>
            <span className="text-xs text-gray-400 font-medium">
              Verified Credits: <strong className="text-white">{dailyEarningsHistory.length}</strong>
            </span>
          </div>

          {dailyEarningsHistory.length === 0 ? (
            <div className="p-8 sm:p-10 text-center rounded-2xl bg-white/[0.02] border border-white/10">
              <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-purple-950/40 border border-purple-800/40 flex items-center justify-center text-purple-400">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h4 className="text-sm font-semibold text-white mb-1">No Daily Earnings Credited Yet</h4>
              <p className="text-xs text-gray-400 max-w-md mx-auto leading-relaxed">
                No daily earnings have been credited yet. Earnings will appear here once verified returns are settled to your wallet.
              </p>
              <div className="mt-4 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-500/10 border border-purple-500/20 text-[10px] text-purple-300">
                <span>🛡️</span> Zero Fabricated Returns • Strict Ledger Compliance
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-white/10 bg-white/[0.02] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-white/5 border-b border-white/10 text-gray-400 font-semibold uppercase tracking-wider text-[10px]">
                    <tr>
                      <th className="py-3 px-4">Earning Date</th>
                      <th className="py-3 px-4">Credited Amount</th>
                      <th className="py-3 px-4">Transaction Reference</th>
                      <th className="py-3 px-4">Description</th>
                      <th className="py-3 px-4 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-gray-300">
                    {dailyEarningsHistory.map((item) => (
                      <tr key={item.id} className="hover:bg-white/[0.02] transition-colors">
                        <td className="py-3.5 px-4 whitespace-nowrap text-gray-300 font-medium">
                          {formatDateTime(item.earningDate || item.date)}
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap font-bold text-emerald-400">
                          +{formatINR(item.amountCredited || item.amount)}
                        </td>
                        <td className="py-3.5 px-4 font-mono text-[11px] text-purple-300">
                          {item.transactionReference || item.reference || 'N/A'}
                        </td>
                        <td className="py-3.5 px-4 text-gray-300">
                          {item.description || 'Verified Cloud Mining Yield'}
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap text-center">
                          <span className="px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-950/60 border border-emerald-800/40 text-emerald-400">
                            {item.earningStatus || 'VERIFIED'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
            <span className="text-xs text-gray-400">Latest wallet transactions</span>
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
                            <div>{tx.description || 'General Account Transaction'}</div>
                            {tx.reference && (
                              <div className="text-[10px] text-gray-500 font-mono mt-0.5" title={`Reference: ${tx.reference}`}>
                                Ref: {tx.reference.length > 14 ? `${tx.reference.substring(0, 12)}...` : tx.reference}
                              </div>
                            )}
                          </td>
                          <td
                            className={`py-3.5 px-4 whitespace-nowrap text-right font-bold ${
                              isCredit ? 'text-emerald-400' : 'text-rose-400'
                            }`}
                          >
                            {isCredit ? '+' : '-'}{formatINR(tx.amount)}
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
