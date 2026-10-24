import { useState, useEffect, useCallback } from 'react';
import { planService } from '../../services';
import { Container, Button, Card } from '../../components/common';
import { AdminPlanFormModal } from './AdminPlanFormModal';

export function AdminPlansPage() {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  // Filter & Search states
  const [filterStatus, setFilterStatus] = useState('all'); // 'all' | 'active' | 'inactive'
  const [searchQuery, setSearchQuery] = useState('');

  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState(null);

  // Status toggle in-flight tracker
  const [togglingId, setTogglingId] = useState(null);

  // Fetch all plans (active + inactive) using admin endpoint
  const fetchPlans = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await planService.getAdminPlans();
      if (res.success && Array.isArray(res.data)) {
        setPlans(res.data);
      } else {
        setPlans([]);
      }
    } catch (err) {
      console.error('Failed to load admin plans:', err);
      setError(err?.response?.data?.message || err?.message || 'Failed to fetch plan catalog');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    Promise.resolve().then(() => {
      if (isMounted) {
        fetchPlans();
      }
    });
    return () => {
      isMounted = false;
    };
  }, [fetchPlans]);

  // Handle status toggle (Activate / Deactivate)
  const handleToggleStatus = async (plan) => {
    const nextStatus = !plan.isActive;
    const actionWord = nextStatus ? 'activate' : 'deactivate';
    
    // Safety confirm for deactivation
    if (!nextStatus) {
      const confirmed = window.confirm(
        `Are you sure you want to deactivate "${plan.name}"?\n\nDeactivated plans cannot be purchased by users. Existing purchased contracts will remain unaffected.`
      );
      if (!confirmed) return;
    }

    try {
      setTogglingId(plan._id);
      setError(null);
      const res = await planService.togglePlanStatus(plan._id, nextStatus);
      if (res.success && res.data) {
        setPlans((prev) =>
          prev.map((p) => (p._id === plan._id ? res.data : p))
        );
        setSuccessMsg(`Plan "${plan.name}" successfully ${actionWord}d.`);
        setTimeout(() => setSuccessMsg(null), 4000);
      }
    } catch (err) {
      console.error(`Failed to ${actionWord} plan:`, err);
      setError(err?.response?.data?.message || err?.message || `Failed to ${actionWord} plan`);
    } finally {
      setTogglingId(null);
    }
  };

  // Open modal in Create mode
  const handleOpenCreate = () => {
    setSelectedPlan(null);
    setIsModalOpen(true);
  };

  // Open modal in Edit mode
  const handleOpenEdit = (plan) => {
    setSelectedPlan(plan);
    setIsModalOpen(true);
  };

  // Handle successful plan create/edit from modal
  const handleModalSuccess = (savedPlan) => {
    setIsModalOpen(false);
    setSelectedPlan(null);
    if (!savedPlan) {
      fetchPlans();
      return;
    }

    setPlans((prev) => {
      const exists = prev.some((p) => p._id === savedPlan._id);
      if (exists) {
        return prev.map((p) => (p._id === savedPlan._id ? savedPlan : p));
      }
      return [savedPlan, ...prev];
    });

    setSuccessMsg(`Plan "${savedPlan.name}" saved successfully.`);
    setTimeout(() => setSuccessMsg(null), 4000);
  };

  // Metrics
  const totalCount = plans.length;
  const activeCount = plans.filter((p) => p.isActive).length;
  const inactiveCount = totalCount - activeCount;

  // Filtered plans
  const filteredPlans = plans.filter((p) => {
    if (filterStatus === 'active' && !p.isActive) return false;
    if (filterStatus === 'inactive' && p.isActive) return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const matchName = p.name?.toLowerCase().includes(q);
      const matchTag = p.tag?.toLowerCase().includes(q);
      const matchHash = p.hashRate?.toLowerCase().includes(q);
      const matchDesc = p.description?.toLowerCase().includes(q);
      return matchName || matchTag || matchHash || matchDesc;
    }

    return true;
  });

  return (
    <div className="py-8 min-h-screen">
      <Container>
        {/* Top Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-white/10">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider bg-purple-500/20 text-purple-300 border border-purple-500/40 rounded">
                Admin Panel
              </span>
              <span className="text-xs text-gray-400">TreadExMine Cloud Computing</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              Plan Catalogue Management
            </h1>
            <p className="text-sm text-gray-400 mt-1">
              Configure mining contracts, pricing tiers, daily yield rates, and availability.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Button
              onClick={fetchPlans}
              variant="outline"
              size="sm"
              disabled={loading}
              className="text-xs flex items-center gap-1.5"
            >
              <svg className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span>Refresh</span>
            </Button>
            <Button
              onClick={handleOpenCreate}
              variant="primary"
              size="sm"
              className="text-xs flex items-center gap-1.5 shadow-md shadow-[#7A56D6]/30"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
              </svg>
              <span>New Mining Plan</span>
            </Button>
          </div>
        </div>

        {/* Success Alert Banner */}
        {successMsg && (
          <div className="mt-6 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-between text-emerald-300 text-sm animate-fadeIn">
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5 text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{successMsg}</span>
            </div>
            <button
              type="button"
              onClick={() => setSuccessMsg(null)}
              className="text-emerald-400 hover:text-emerald-200 text-xs font-semibold px-2 py-1"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Error Alert Banner */}
        {error && (
          <div className="mt-6 p-4 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center justify-between text-red-300 text-sm">
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5 text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{error}</span>
            </div>
            <Button onClick={fetchPlans} variant="ghost" size="sm" className="text-xs text-red-300 hover:bg-red-500/20">
              Retry
            </Button>
          </div>
        )}

        {/* Metrics Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6">
          <Card className="p-4 sm:p-5 flex items-center justify-between border-purple-900/30">
            <div>
              <span className="text-xs uppercase tracking-wider text-gray-400 font-medium">Total Catalogue</span>
              <div className="text-2xl font-bold text-white mt-1">
                {loading ? '...' : totalCount}
              </div>
              <span className="text-[11px] text-gray-400">All registered plan models</span>
            </div>
            <div className="w-12 h-12 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
          </Card>

          <Card className="p-4 sm:p-5 flex items-center justify-between border-emerald-900/30">
            <div>
              <span className="text-xs uppercase tracking-wider text-emerald-400 font-medium">Active Plans</span>
              <div className="text-2xl font-bold text-emerald-300 mt-1">
                {loading ? '...' : activeCount}
              </div>
              <span className="text-[11px] text-gray-400">Live in user plans catalogue</span>
            </div>
            <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </Card>

          <Card className="p-4 sm:p-5 flex items-center justify-between border-amber-900/30">
            <div>
              <span className="text-xs uppercase tracking-wider text-amber-400 font-medium">Deactivated Plans</span>
              <div className="text-2xl font-bold text-amber-300 mt-1">
                {loading ? '...' : inactiveCount}
              </div>
              <span className="text-[11px] text-gray-400">Hidden from user purchase</span>
            </div>
            <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
              </svg>
            </div>
          </Card>
        </div>

        {/* Filter and Search Bar */}
        <div className="mt-8 flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 rounded-xl bg-white/[0.02] border border-white/5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setFilterStatus('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                filterStatus === 'all'
                  ? 'bg-[#7A56D6] text-white shadow-sm shadow-[#7A56D6]/40'
                  : 'bg-white/5 text-gray-400 hover:text-white hover:bg-white/10'
              }`}
            >
              All Plans ({totalCount})
            </button>
            <button
              type="button"
              onClick={() => setFilterStatus('active')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                filterStatus === 'active'
                  ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-600/40'
                  : 'bg-white/5 text-gray-400 hover:text-emerald-300 hover:bg-white/10'
              }`}
            >
              Active ({activeCount})
            </button>
            <button
              type="button"
              onClick={() => setFilterStatus('inactive')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                filterStatus === 'inactive'
                  ? 'bg-amber-600 text-white shadow-sm shadow-amber-600/40'
                  : 'bg-white/5 text-gray-400 hover:text-amber-300 hover:bg-white/10'
              }`}
            >
              Deactivated ({inactiveCount})
            </button>
          </div>

          <div className="relative w-full md:w-72">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name, tag, hashrate..."
              className="w-full pl-9 pr-4 py-2 rounded-lg bg-black/50 border border-white/10 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-[#7A56D6]"
            />
            <svg
              className="w-4 h-4 text-gray-400 absolute left-3 top-2.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-2 text-gray-400 hover:text-white text-xs"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Plans Table / Cards */}
        <div className="mt-6">
          {loading ? (
            /* Loading Skeleton */
            <div className="space-y-3">
              {[1, 2, 3, 4].map((n) => (
                <div
                  key={n}
                  className="p-5 rounded-2xl bg-white/[0.02] border border-white/5 animate-pulse flex items-center justify-between"
                >
                  <div className="space-y-2">
                    <div className="h-4 bg-white/10 rounded w-48"></div>
                    <div className="h-3 bg-white/5 rounded w-32"></div>
                  </div>
                  <div className="h-8 bg-white/10 rounded w-24"></div>
                </div>
              ))}
            </div>
          ) : filteredPlans.length === 0 ? (
            /* Empty State */
            <div className="p-12 text-center rounded-2xl bg-white/[0.02] border border-white/5">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-white mb-1">No Mining Plans Found</h3>
              <p className="text-xs text-gray-400 max-w-sm mx-auto mb-5">
                {searchQuery || filterStatus !== 'all'
                  ? 'No plans match your current filter or search criteria. Try resetting your query.'
                  : 'Your catalogue currently contains no plans. Click below to create your first cloud mining plan.'}
              </p>
              {searchQuery || filterStatus !== 'all' ? (
                <Button
                  onClick={() => {
                    setSearchQuery('');
                    setFilterStatus('all');
                  }}
                  variant="outline"
                  size="sm"
                  className="text-xs"
                >
                  Clear Filters
                </Button>
              ) : (
                <Button onClick={handleOpenCreate} variant="primary" size="sm" className="text-xs">
                  Create First Plan
                </Button>
              )}
            </div>
          ) : (
            /* Responsive Table */
            <div className="overflow-x-auto rounded-2xl border border-white/10 bg-black/40 backdrop-blur-md">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-white/10 bg-white/[0.03] text-gray-400 font-semibold uppercase tracking-wider text-[10px]">
                    <th className="py-3.5 px-4">Plan Name & Details</th>
                    <th className="py-3.5 px-4">Price</th>
                    <th className="py-3.5 px-4">Duration</th>
                    <th className="py-3.5 px-4">Daily ROI</th>
                    <th className="py-3.5 px-4">Hash Rate</th>
                    <th className="py-3.5 px-4">Status</th>
                    <th className="py-3.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-gray-300">
                  {filteredPlans.map((plan) => {
                    const isTogglingThis = togglingId === plan._id;

                    return (
                      <tr
                        key={plan._id}
                        className="hover:bg-white/[0.02] transition-colors"
                      >
                        {/* Name & Tag */}
                        <td className="py-4 px-4">
                          <div className="flex items-center gap-2.5">
                            <div className="w-9 h-9 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-[#7A56D6] font-bold text-sm shrink-0">
                              {plan.name ? plan.name.charAt(0).toUpperCase() : 'P'}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-white text-sm truncate">
                                  {plan.name}
                                </span>
                                {plan.tag && (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-950/80 border border-purple-800/40 text-purple-300 shrink-0">
                                    {plan.tag}
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-gray-400 line-clamp-1 mt-0.5" title={plan.description}>
                                {plan.description || 'No description provided.'}
                              </p>
                              <span className="text-[10px] text-gray-500 font-mono">
                                ID: {plan._id}
                              </span>
                            </div>
                          </div>
                        </td>

                        {/* Price */}
                        <td className="py-4 px-4 whitespace-nowrap">
                          <span className="font-bold text-white text-sm">
                            ₹{Number(plan.price || 0).toLocaleString('en-IN')}
                          </span>
                        </td>

                        {/* Duration */}
                        <td className="py-4 px-4 whitespace-nowrap">
                          <span className="text-gray-300 font-medium">
                            {plan.durationDays} days
                          </span>
                        </td>

                        {/* Daily ROI */}
                        <td className="py-4 px-4 whitespace-nowrap">
                          <span className="font-semibold text-emerald-400">
                            {(Number(plan.dailyRoiRate || 0) * 100).toFixed(2)}%
                          </span>
                          <span className="text-[10px] text-gray-400 block">
                            ≈ ₹{((Number(plan.price || 0) * Number(plan.dailyRoiRate || 0))).toFixed(2)}/day
                          </span>
                        </td>

                        {/* Hash Rate */}
                        <td className="py-4 px-4 whitespace-nowrap">
                          <span className="font-mono text-purple-300 font-medium bg-purple-950/40 border border-purple-900/30 px-2 py-0.5 rounded text-[11px]">
                            {plan.hashRate || 'Standard'}
                          </span>
                        </td>

                        {/* Status Badge */}
                        <td className="py-4 px-4 whitespace-nowrap">
                          {plan.isActive ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                              Active
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-gray-500/10 text-gray-400 border border-gray-500/30">
                              <span className="w-1.5 h-1.5 rounded-full bg-gray-500"></span>
                              Deactivated
                            </span>
                          )}
                        </td>

                        {/* Actions */}
                        <td className="py-4 px-4 whitespace-nowrap text-right">
                          <div className="flex items-center justify-end gap-2">
                            {/* Edit Button */}
                            <button
                              type="button"
                              onClick={() => handleOpenEdit(plan)}
                              className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-200 hover:text-white border border-white/10 text-xs font-medium transition-colors flex items-center gap-1.5"
                              title="Edit Plan"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                              <span>Edit</span>
                            </button>

                            {/* Status Toggle Button */}
                            <button
                              type="button"
                              onClick={() => handleToggleStatus(plan)}
                              disabled={isTogglingThis}
                              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors flex items-center gap-1.5 ${
                                plan.isActive
                                  ? 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border-amber-500/30'
                                  : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                              } disabled:opacity-50`}
                              title={plan.isActive ? 'Deactivate this plan' : 'Activate this plan'}
                            >
                              {isTogglingThis ? (
                                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                                </svg>
                              ) : plan.isActive ? (
                                <>
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                                  </svg>
                                  <span>Deactivate</span>
                                </>
                              ) : (
                                <>
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                  </svg>
                                  <span>Activate</span>
                                </>
                              )}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Security & Ledger Integrity Guidelines Note */}
        <div className="mt-8 p-5 rounded-2xl bg-purple-950/20 border border-purple-900/30">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400 shrink-0 mt-0.5">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="text-xs text-gray-300 space-y-1">
              <h4 className="font-bold text-white text-sm">Ledger & Transaction Integrity Rules</h4>
              <p>
                • <strong>Immutable Snapshots:</strong> Modifying a plan's price, duration, or yield only affects future purchases. Active and past user contracts (<code className="text-purple-300 font-mono">UserPlan</code>) and wallet transactions retain their original contractual values.
              </p>
              <p>
                • <strong>Purchase Enforcement:</strong> Deactivated plans cannot be purchased via wallet balances or UPI gateway checkouts (rejected with HTTP 404).
              </p>
              <p>
                • <strong>Strict Backend Validation:</strong> Client-provided prices, timestamps, and IDs are ignored on purchase transactions. Server authoritative records govern all ledger entries.
              </p>
            </div>
          </div>
        </div>
      </Container>

      {/* Plan Form Modal (Create / Edit) */}
      {isModalOpen && (
        <AdminPlanFormModal
          key={selectedPlan?._id || 'new'}
          isOpen={isModalOpen}
          plan={selectedPlan}
          onClose={() => {
            setIsModalOpen(false);
            setSelectedPlan(null);
          }}
          onSuccess={handleModalSuccess}
        />
      )}
    </div>
  );
}

export default AdminPlansPage;
