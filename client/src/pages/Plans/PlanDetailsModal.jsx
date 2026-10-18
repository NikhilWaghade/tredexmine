import { useState, useEffect } from 'react';
import { planService } from '../../services';
import { Button } from '../../components/common';

export function PlanDetailsModal({
  planId,
  initialPlan,
  onClose,
  onProceedToPurchase,
  isAuthenticated,
}) {
  const [plan, setPlan] = useState(initialPlan || null);
  const [loading, setLoading] = useState(!initialPlan);
  const [error, setError] = useState(null);

  useEffect(() => {
    let isMounted = true;
    if (!planId) return;

    const fetchDetail = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await planService.getPlanById(planId);
        if (isMounted) {
          if (response.success && response.plan) {
            setPlan(response.plan);
          } else {
            setError('Plan details unavailable');
          }
        }
      } catch (err) {
        if (isMounted) {
          setError(
            err.response?.data?.message ||
              'Unable to load plan specifications. The plan may be inactive or unavailable.'
          );
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    fetchDetail();

    return () => {
      isMounted = false;
    };
  }, [planId]);

  if (!planId) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
      {/* Backdrop */}
      <div className="fixed inset-0" onClick={onClose} aria-hidden="true" />

      {/* Modal Dialog Card */}
      <div className="relative w-full max-w-2xl rounded-2xl bg-[#0e081e] border border-purple-900/60 p-6 sm:p-8 shadow-2xl shadow-purple-950/80 z-10 max-h-[90vh] overflow-y-auto">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-white p-2 rounded-lg hover:bg-white/5 transition-colors focus:outline-none"
          aria-label="Close details modal"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {loading ? (
          <div className="py-12 flex flex-col items-center justify-center gap-4 text-gray-400">
            <svg className="animate-spin w-8 h-8 text-[#7A56D6]" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            <p className="text-sm">Retrieving real-time plan telemetry...</p>
          </div>
        ) : error ? (
          <div className="py-8 text-center">
            <div className="w-12 h-12 mx-auto rounded-full bg-rose-950/60 border border-rose-800/60 flex items-center justify-center text-rose-400 mb-4">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h4 className="text-lg font-bold text-white mb-2">Notice</h4>
            <p className="text-sm text-gray-400 max-w-md mx-auto mb-6">{error}</p>
            <Button onClick={onClose} variant="outline" size="sm">
              Close
            </Button>
          </div>
        ) : plan ? (
          <div>
            {/* Modal Header */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-2">
                {plan.tag && (
                  <span className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider text-purple-300 bg-[#7A56D6]/20 border border-[#7A56D6]/40">
                    {plan.tag}
                  </span>
                )}
                <span className="px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider text-emerald-300 bg-emerald-950/50 border border-emerald-800/40">
                  {plan.isActive ? 'Active Node Available' : 'Inactive'}
                </span>
              </div>

              {plan.hashRate && (
                <div className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-purple-950/60 border border-purple-800/50 text-[#7A56D6] font-bold text-sm">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  <span>{plan.hashRate}</span>
                </div>
              )}
            </div>

            <h3 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight mb-2">
              {plan.name}
            </h3>
            <p className="text-sm text-gray-300 leading-relaxed mb-6">
              {plan.description ||
                'High-performance distributed cloud mining hardware allocated across Tier-4 climate-controlled compute centers.'}
            </p>

            {/* Metrics Breakdown Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 rounded-xl bg-white/[0.03] border border-white/10 mb-6">
              <div>
                <span className="text-[10px] uppercase font-semibold text-gray-400 block">
                  Price
                </span>
                <span className="text-lg font-bold text-white">
                  ${Number(plan.price).toFixed(2)}
                </span>
              </div>
              <div>
                <span className="text-[10px] uppercase font-semibold text-gray-400 block">
                  Contract Duration
                </span>
                <span className="text-lg font-bold text-white">
                  {plan.durationDays} Days
                </span>
              </div>
              <div>
                <span className="text-[10px] uppercase font-semibold text-gray-400 block">
                  Daily Yield Rate
                </span>
                <span className="text-lg font-bold text-emerald-400">
                  {plan.dailyRoiRate ? `+${(plan.dailyRoiRate * 100).toFixed(2)}%` : 'Variable'}
                </span>
              </div>
              <div>
                <span className="text-[10px] uppercase font-semibold text-gray-400 block">
                  Hardware Class
                </span>
                <span className="text-lg font-bold text-purple-300">
                  Enterprise ASIC
                </span>
              </div>
            </div>

            {/* Full Features Specification */}
            <div className="mb-6">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">
                Full Technical Specifications & Architecture
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {plan.features && plan.features.length > 0 ? (
                  plan.features.map((feat, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 p-2.5 rounded-lg bg-white/[0.02] border border-purple-900/30 text-xs text-gray-200"
                    >
                      <svg className="w-4 h-4 text-[#7A56D6] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <span>{feat}</span>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-gray-400">Standard cloud mining provisions included.</p>
                )}
                <div className="flex items-center gap-2 p-2.5 rounded-lg bg-white/[0.02] border border-purple-900/30 text-xs text-gray-200">
                  <svg className="w-4 h-4 text-[#7A56D6] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span>99.98% Hardware SLA Uptime</span>
                </div>
                <div className="flex items-center gap-2 p-2.5 rounded-lg bg-white/[0.02] border border-purple-900/30 text-xs text-gray-200">
                  <svg className="w-4 h-4 text-[#7A56D6] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span>Zero Maintenance Downtime</span>
                </div>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="pt-4 border-t border-white/10 flex flex-col sm:flex-row items-center justify-end gap-3">
              <Button onClick={onClose} variant="ghost" size="md" className="w-full sm:w-auto">
                Close Specifications
              </Button>
              <Button
                onClick={() => {
                  onClose();
                  onProceedToPurchase(plan);
                }}
                variant="primary"
                size="md"
                className="w-full sm:w-auto"
              >
                {isAuthenticated ? 'Proceed to Purchase' : 'Sign In to Purchase'}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default PlanDetailsModal;
