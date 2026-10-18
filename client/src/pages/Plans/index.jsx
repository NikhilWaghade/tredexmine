import { useState, useEffect, useCallback } from 'react';
import { planService } from '../../services';
import { useAuth } from '../../context';
import { Container, Button, SectionHeader } from '../../components/common';
import { PlanCard } from './PlanCard';
import { PlanDetailsModal } from './PlanDetailsModal';
import { PurchaseConfirmationModal } from './PurchaseConfirmationModal';
import { ActivePlansSection } from './ActivePlansSection';
import { TransactionsModal } from './TransactionsModal';
import { AdminCreatePlanModal } from './AdminCreatePlanModal';

export function PlansPage() {
  const { user, wallet, isAuthenticated, openAuthModal, refreshWallet } = useAuth();

  // Plans catalog state
  const [plans, setPlans] = useState([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [plansError, setPlansError] = useState(null);

  // Active user plans state
  const [activePlans, setActivePlans] = useState([]);
  const [activePlansLoading, setActivePlansLoading] = useState(false);

  // Modal states
  const [selectedPlanForDetails, setSelectedPlanForDetails] = useState(null);
  const [selectedPlanForPurchase, setSelectedPlanForPurchase] = useState(null);
  const [isTransactionsModalOpen, setIsTransactionsModalOpen] = useState(false);
  const [isAdminCreateModalOpen, setIsAdminCreateModalOpen] = useState(false);


  // View filter (all plans vs active subscriptions)
  const [activeTab, setActiveTab] = useState('catalog'); // 'catalog' | 'active'

  // Fetch all active plans from backend
  const reloadPlans = useCallback(() => {
    setPlansLoading(true);
    setPlansError(null);
    planService
      .getPlans()
      .then((data) => {
        setPlans(data.success && Array.isArray(data.plans) ? data.plans : []);
      })
      .catch((err) => {
        console.error('[PlansPage] Error fetching plans:', err);
        const message =
          err.response?.data?.message ||
          (err.request
            ? 'Network error: Unable to reach the TreadExMine server. Please check your connection and try again.'
            : 'Failed to load mining plans. Please try again later.');
        setPlansError(message);
      })
      .finally(() => {
        setPlansLoading(false);
      });
  }, []);

  // Fetch current authenticated user's active purchased plans
  const reloadActivePlans = useCallback(() => {
    if (!isAuthenticated) return;
    setActivePlansLoading(true);
    planService
      .getMyActivePlans()
      .then((data) => {
        setActivePlans(data.success && Array.isArray(data.userPlans) ? data.userPlans : []);
      })
      .catch((err) => {
        console.warn('[PlansPage] Error fetching user active plans:', err.message);
      })
      .finally(() => {
        setActivePlansLoading(false);
      });
  }, [isAuthenticated]);

  // Initial catalog load
  useEffect(() => {
    let isMounted = true;
    planService
      .getPlans()
      .then((data) => {
        if (isMounted) {
          setPlans(data.success && Array.isArray(data.plans) ? data.plans : []);
          setPlansLoading(false);
        }
      })
      .catch((err) => {
        if (isMounted) {
          console.error('[PlansPage] Error fetching plans:', err);
          const message =
            err.response?.data?.message ||
            (err.request
              ? 'Network error: Unable to reach the TreadExMine server. Please check your connection and try again.'
              : 'Failed to load mining plans. Please try again later.');
          setPlansError(message);
          setPlansLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  // Fetch active plans when user becomes authenticated
  useEffect(() => {
    let isMounted = true;
    if (!isAuthenticated) {
      return;
    }

    planService
      .getMyActivePlans()
      .then((data) => {
        if (isMounted) {
          setActivePlans(data.success && Array.isArray(data.userPlans) ? data.userPlans : []);
        }
      })
      .catch((err) => {
        console.warn('[PlansPage] Error fetching user active plans:', err.message);
      });

    return () => {
      isMounted = false;
    };
  }, [isAuthenticated]);

  const displayedActivePlans = isAuthenticated ? activePlans : [];

  // Handle plan purchase click
  const handlePurchaseClick = (plan) => {
    if (!isAuthenticated) {
      openAuthModal();
      return;
    }
    setSelectedPlanForPurchase(plan);
  };

  // Callback on successful purchase
  const handlePurchaseSuccess = async () => {
    // Refresh both wallet and active plans strictly from server
    await Promise.allSettled([refreshWallet(), reloadActivePlans()]);
  };


  return (
    <div className="py-12 sm:py-20 flex flex-col gap-12 sm:gap-16">
      <Container>
        {/* Header Section */}
        <SectionHeader
          badge="Computational Infrastructure"
          title="High-Yield Cloud Mining Plans"
          description="Deploy dedicated computational hash power backed by institutional Tier-4 data centers. Transparent daily yields, zero setup fees, and 24/7 cluster monitoring."
        />

        {/* Authenticated User Status Bar */}
        {isAuthenticated ? (
          <div className="mb-8 p-4 sm:p-5 rounded-2xl bg-white/[0.03] border border-purple-900/40 backdrop-blur-md flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-purple-950/80 border border-purple-700/50 flex items-center justify-center text-[#7A56D6]">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                </svg>
              </div>
              <div>
                <span className="text-xs uppercase tracking-wider text-gray-400 font-medium block">
                  Available Wallet Balance
                </span>
                <span className="text-xl sm:text-2xl font-extrabold text-emerald-400">
                  ${wallet?.balance != null ? Number(wallet.balance).toFixed(2) : '0.00'}{' '}
                  <span className="text-xs text-gray-400 font-normal">USD</span>
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
              <button
                onClick={refreshWallet}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium text-gray-300 hover:text-white transition-colors"
                title="Sync balance from server"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Sync Wallet
              </button>

              <button
                onClick={() => setIsTransactionsModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium text-gray-300 hover:text-white transition-colors"
                title="View wallet transactions"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                </svg>
                Transactions
              </button>

              {user?.role === 'admin' && (
                <button
                  onClick={() => setIsAdminCreateModalOpen(true)}
                  className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-purple-900/40 hover:bg-purple-900/60 border border-purple-700/60 text-xs font-semibold text-purple-200 transition-colors"
                  title="Administrator: Create Plan"
                >
                  <span className="text-purple-400 font-bold">+</span> Create Plan
                </button>
              )}


              {/* Tab Selector if user has active plans */}
              {displayedActivePlans.length > 0 && (
                <div className="inline-flex p-1 bg-black/40 border border-white/10 rounded-xl">
                  <button
                    onClick={() => setActiveTab('catalog')}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                      activeTab === 'catalog'
                        ? 'bg-[#7A56D6] text-white shadow-sm'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    Catalog
                  </button>
                  <button
                    onClick={() => setActiveTab('active')}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 ${
                      activeTab === 'active'
                        ? 'bg-[#7A56D6] text-white shadow-sm'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    <span>My Nodes</span>
                    <span className="w-4 h-4 rounded-full bg-emerald-400/20 text-emerald-400 text-[10px] flex items-center justify-center font-bold">
                      {displayedActivePlans.length}
                    </span>
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Unauthenticated Prompt Banner */
          <div className="mb-8 p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-purple-950/40 via-purple-900/20 to-black border border-purple-900/40 backdrop-blur-md flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#7A56D6]/20 border border-[#7A56D6]/40 flex items-center justify-center text-purple-300 flex-shrink-0">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <div>
                <h4 className="text-sm font-semibold text-white">
                  Connect your account to purchase cloud mining plans
                </h4>
                <p className="text-xs text-gray-400">
                  Authenticate securely to allocate compute power and link hashrate to your wallet.
                </p>
              </div>
            </div>

            <Button onClick={openAuthModal} variant="primary" size="sm" className="w-full sm:w-auto">
              Sign In / Register
            </Button>
          </div>
        )}

        {/* Tab Content: Active Subscriptions */}
        {isAuthenticated && activeTab === 'active' ? (
          <div>
            <ActivePlansSection
              userPlans={displayedActivePlans}
              isLoading={activePlansLoading}
              onRefresh={reloadActivePlans}
            />
            <div className="text-center mt-6">
              <Button onClick={() => setActiveTab('catalog')} variant="outline" size="sm">
                ← Browse More Plans
              </Button>
            </div>
          </div>
        ) : (
          /* Tab Content: Plans Catalog */
          <div>
            {/* Active plans preview banner if user has active nodes while in catalog */}
            {isAuthenticated && displayedActivePlans.length > 0 && activeTab === 'catalog' && (
              <div className="mb-8">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    Your Active Nodes ({displayedActivePlans.length})
                  </h3>
                  <button
                    onClick={() => setActiveTab('active')}
                    className="text-xs text-purple-300 hover:text-white transition-colors"
                  >
                    View All My Subscriptions →
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {displayedActivePlans.slice(0, 3).map((up) => (
                    <div
                      key={up._id}
                      className="p-3.5 rounded-xl bg-purple-950/20 border border-emerald-900/30 flex items-center justify-between text-xs"
                    >
                      <div>
                        <span className="font-semibold text-white block">{up.planName}</span>
                        <span className="text-gray-400 text-[11px]">
                          Hashrate: {up.hashRate || 'Standard'}
                        </span>
                      </div>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold text-emerald-300 bg-emerald-950/60 border border-emerald-800/40">
                        Active
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Catalog Grid State Handling */}
            {plansLoading ? (
              /* Shimmer Skeletons */
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                {[1, 2, 3].map((n) => (
                  <div
                    key={n}
                    className="h-96 rounded-2xl bg-white/[0.02] border border-purple-900/20 p-8 flex flex-col justify-between animate-pulse"
                  >
                    <div>
                      <div className="flex justify-between items-center mb-4">
                        <div className="h-5 w-20 bg-white/5 rounded-full" />
                        <div className="h-5 w-16 bg-white/5 rounded-lg" />
                      </div>
                      <div className="h-7 w-3/4 bg-white/5 rounded mb-3" />
                      <div className="h-4 w-full bg-white/5 rounded mb-2" />
                      <div className="h-4 w-2/3 bg-white/5 rounded mb-6" />
                      <div className="h-10 w-1/2 bg-white/5 rounded mb-6" />
                      <div className="space-y-2">
                        <div className="h-3 w-4/5 bg-white/5 rounded" />
                        <div className="h-3 w-3/4 bg-white/5 rounded" />
                        <div className="h-3 w-5/6 bg-white/5 rounded" />
                      </div>
                    </div>
                    <div className="h-11 w-full bg-white/5 rounded-xl" />
                  </div>
                ))}
              </div>
            ) : plansError ? (
              /* Error State */
              <div className="text-center py-16 px-4 rounded-2xl bg-white/[0.02] border border-rose-900/30 max-w-lg mx-auto">
                <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-rose-950/60 border border-rose-800/50 flex items-center justify-center text-rose-400">
                  <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <h3 className="text-xl font-bold text-white mb-2">Unable to Retrieve Plans</h3>
                <p className="text-sm text-gray-400 mb-6 leading-relaxed">{plansError}</p>
                <Button onClick={reloadPlans} variant="primary" size="md">
                  Retry Loading Plans
                </Button>
              </div>
            ) : plans.length === 0 ? (
              /* Empty State */
              <div className="text-center py-16 px-4 rounded-2xl bg-white/[0.02] border border-purple-900/30 max-w-md mx-auto">
                <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-purple-950/60 border border-purple-800/40 flex items-center justify-center text-purple-400">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                  </svg>
                </div>
                <h3 className="text-lg font-bold text-white mb-1">No Active Plans Available</h3>
                <p className="text-xs text-gray-400 mb-6">
                  There are currently no active cloud mining packages available for public purchase. Please check back soon.
                </p>
                <Button onClick={reloadPlans} variant="outline" size="sm">
                  Refresh Catalog
                </Button>
              </div>
            ) : (
              /* Plans Grid */
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                {plans.map((plan) => (
                  <PlanCard
                    key={plan._id}
                    plan={plan}
                    walletBalance={wallet?.balance}
                    isAuthenticated={isAuthenticated}
                    onPurchase={handlePurchaseClick}
                    onViewDetails={(p) => setSelectedPlanForDetails(p)}
                  />
                ))}
              </div>
            )}

          </div>
        )}
      </Container>

      {/* Plan Details Modal (Single plan lookup GET /api/v1/plans/:id) */}
      {selectedPlanForDetails && (
        <PlanDetailsModal
          planId={selectedPlanForDetails._id}
          initialPlan={selectedPlanForDetails}
          isAuthenticated={isAuthenticated}
          onClose={() => setSelectedPlanForDetails(null)}
          onProceedToPurchase={(p) => {
            setSelectedPlanForDetails(null);
            handlePurchaseClick(p);
          }}
        />
      )}

      {/* Purchase Confirmation Modal (Balance check & POST /api/v1/plans/:id/purchase) */}
      {selectedPlanForPurchase && (
        <PurchaseConfirmationModal
          plan={selectedPlanForPurchase}
          wallet={wallet}
          onClose={() => setSelectedPlanForPurchase(null)}
          onSuccess={handlePurchaseSuccess}
        />
      )}

      {/* Transaction History Ledger Modal (GET /api/v1/wallet/transactions) */}
      <TransactionsModal
        isOpen={isTransactionsModalOpen}
        onClose={() => setIsTransactionsModalOpen(false)}
      />

      {/* Admin Create Plan Modal (POST /api/v1/plans) */}
      {user?.role === 'admin' && (
        <AdminCreatePlanModal
          isOpen={isAdminCreateModalOpen}
          onClose={() => setIsAdminCreateModalOpen(false)}
          onSuccess={reloadPlans}
        />
      )}
    </div>

  );
}

export default PlansPage;
