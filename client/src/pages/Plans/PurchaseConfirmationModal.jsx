import { useState } from 'react';
import { planService } from '../../services';
import { Button } from '../../components/common';

export function PurchaseConfirmationModal({
  plan,
  wallet,
  onClose,
  onSuccess,
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [successData, setSuccessData] = useState(null);

  if (!plan) return null;

  const currentBalance = wallet?.balance != null ? Number(wallet.balance) : 0;
  const planPrice = Number(plan.price);
  const isSufficientBalance = currentBalance >= planPrice;
  const remainingBalance = (currentBalance - planPrice).toFixed(2);
  const shortfall = (planPrice - currentBalance).toFixed(2);

  const handleConfirmPurchase = async () => {
    setIsSubmitting(true);
    setError(null);

    // Generate safe client idempotency key to prevent accidental duplicate purchases
    const idempotencyKey =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `plan-sub-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    try {
      const response = await planService.purchasePlan(plan._id, { idempotencyKey });
      if (response.success) {
        setSuccessData(response);
        // Notify parent to refresh wallet balance and active plans list
        if (onSuccess) {
          await onSuccess(response);
        }
      } else {
        setError(response.message || 'Purchase could not be processed');
      }
    } catch (err) {
      const apiMsg =
        err.response?.data?.message ||
        (err.request
          ? 'Network error: Unable to contact server. Please check your connection and retry.'
          : err.message || 'An unexpected error occurred during purchase.');
      setError(apiMsg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
      {/* Backdrop */}
      <div className="fixed inset-0" onClick={!isSubmitting ? onClose : undefined} aria-hidden="true" />

      {/* Modal Dialog Card */}
      <div className="relative w-full max-w-lg rounded-2xl bg-[#0e081e] border border-purple-900/60 p-6 sm:p-8 shadow-2xl shadow-purple-950/80 z-10">
        {/* Close Button */}
        {!isSubmitting && !successData && (
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-gray-400 hover:text-white p-2 rounded-lg hover:bg-white/5 transition-colors focus:outline-none"
            aria-label="Close purchase confirmation modal"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}

        {successData ? (
          /* Success Screen */
          <div className="text-center py-4">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-emerald-950/60 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            </div>

            <h3 className="text-2xl font-bold text-white tracking-tight mb-2">
              Plan Purchased Successfully!
            </h3>
            <p className="text-sm text-gray-300 max-w-sm mx-auto mb-6 leading-relaxed">
              Your computational node for <span className="text-white font-semibold">{plan.name}</span> has been provisioned and added to your active subscriptions.
            </p>

            <div className="p-4 rounded-xl bg-white/[0.03] border border-white/10 mb-6 text-left text-xs space-y-2">
              <div className="flex justify-between text-gray-400">
                <span>Contract Duration:</span>
                <span className="text-white font-medium">{plan.durationDays} Days</span>
              </div>
              <div className="flex justify-between text-gray-400">
                <span>Hash Allocation:</span>
                <span className="text-purple-300 font-semibold">{plan.hashRate || 'Standard'}</span>
              </div>
              <div className="flex justify-between text-gray-400 pt-2 border-t border-white/10">
                <span>New Wallet Balance:</span>
                <span className="text-emerald-400 font-bold">
                  ${successData.data?.walletBalance != null ? Number(successData.data.walletBalance).toFixed(2) : remainingBalance}
                </span>
              </div>
            </div>

            <Button onClick={onClose} variant="primary" size="md" className="w-full">
              Done
            </Button>
          </div>
        ) : (
          /* Confirmation Screen */
          <div>
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#7A56D6] to-purple-400 p-0.5 shadow-md shadow-[#7A56D6]/40 flex-shrink-0">
                <div className="w-full h-full bg-black/90 rounded-[10px] flex items-center justify-center">
                  <svg className="w-5 h-5 text-purple-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
              </div>
              <div>
                <h3 className="text-xl font-bold text-white tracking-tight">
                  Confirm Plan Purchase
                </h3>
                <p className="text-xs text-gray-400">
                  Review transaction specifications before activation
                </p>
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <div className="mb-4 p-3.5 rounded-xl bg-rose-950/60 border border-rose-800/60 text-rose-200 text-xs flex items-start gap-2.5">
                <svg className="w-4 h-4 flex-shrink-0 text-rose-400 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>{error}</span>
              </div>
            )}

            {/* Plan Info Card */}
            <div className="p-4 rounded-xl bg-white/[0.03] border border-purple-900/30 mb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-white">{plan.name}</span>
                {plan.hashRate && (
                  <span className="text-xs px-2 py-0.5 rounded bg-purple-950/60 border border-purple-800/40 text-purple-300 font-semibold">
                    {plan.hashRate}
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-400 line-clamp-2">
                {plan.description || 'Dedicated cloud computing node allocated to your account.'}
              </p>
            </div>

            {/* Financial Ledger Breakdown */}
            <div className="p-4 rounded-xl bg-black/40 border border-white/10 space-y-3 mb-5 text-sm">
              <div className="flex items-center justify-between text-gray-400">
                <span>Current Wallet Balance</span>
                <span className="font-semibold text-white">${currentBalance.toFixed(2)}</span>
              </div>

              <div className="flex items-center justify-between text-gray-400">
                <span>Plan Cost ({plan.durationDays} Days)</span>
                <span className="font-semibold text-rose-400">-${planPrice.toFixed(2)}</span>
              </div>

              <div className="pt-2 border-t border-white/10 flex items-center justify-between">
                <span className="font-medium text-gray-300">Projected Balance</span>
                <span
                  className={`font-bold ${
                    isSufficientBalance ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  ${isSufficientBalance ? remainingBalance : 'Insufficient Funds'}
                </span>
              </div>
            </div>

            {/* Insufficient Balance Notice */}
            {!isSufficientBalance && (
              <div className="mb-5 p-3.5 rounded-xl bg-amber-950/50 border border-amber-800/50 text-amber-200 text-xs flex items-start gap-2.5">
                <svg className="w-4 h-4 flex-shrink-0 text-amber-400 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div>
                  <span className="font-semibold block mb-0.5">Insufficient Wallet Balance</span>
                  <span>
                    You need an additional <strong>${shortfall}</strong> to purchase this plan. Please add funds to your wallet balance.
                  </span>
                </div>
              </div>
            )}

            {/* Modal Actions */}
            <div className="flex flex-col sm:flex-row items-center justify-end gap-3">
              <Button
                onClick={onClose}
                variant="ghost"
                size="md"
                disabled={isSubmitting}
                className="w-full sm:w-auto"
              >
                Cancel
              </Button>

              <Button
                onClick={handleConfirmPurchase}
                variant="primary"
                size="md"
                disabled={!isSufficientBalance || isSubmitting}
                className="w-full sm:w-auto"
              >
                {isSubmitting ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    Deducting & Deploying...
                  </span>
                ) : (
                  'Confirm & Activate Compute'
                )}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default PurchaseConfirmationModal;
