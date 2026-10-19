import { useState } from 'react';
import { planService, paymentService } from '../../services';
import { Button } from '../../components/common';
import { useAuth } from '../../context';

export function PurchaseConfirmationModal({
  plan,
  wallet,
  onClose,
  onSuccess,
}) {
  const { user } = useAuth();

  // Payment method selection: 'upi' | 'wallet'
  const [paymentMethod, setPaymentMethod] = useState('upi');

  // Checkout process states: 'idle' | 'creating_order' | 'gateway_open' | 'verifying' | 'success' | 'error'
  const [checkoutState, setCheckoutState] = useState('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState(null);
  const [activatedData, setActivatedData] = useState(null);

  if (!plan) return null;

  const currentWalletBalance = wallet?.balance != null ? Number(wallet.balance) : 0;
  const planPrice = Number(plan.price);
  const formattedInrPrice = `₹${planPrice.toLocaleString('en-IN')}`;
  const isSufficientWalletBalance = currentWalletBalance >= planPrice;

  const isProcessing =
    checkoutState === 'creating_order' ||
    checkoutState === 'gateway_open' ||
    checkoutState === 'verifying';

  // --- UPI Gateway Checkout Flow (Razorpay) ---
  const handleUpiCheckout = async () => {
    setCheckoutState('creating_order');
    setError(null);
    setStatusMessage('Initiating secure gateway order...');

    try {
      // 1. Call backend order creation endpoint (server enforces MongoDB authoritative price)
      const orderResponse = await paymentService.createPaymentOrder(plan._id);
      if (!orderResponse.success || !orderResponse.data) {
        throw new Error(orderResponse.message || 'Failed to initialize payment order');
      }

      const { orderId, amountInPaise, currency, keyId } = orderResponse.data;

      // 2. Dynamically ensure Razorpay checkout script is loaded
      setStatusMessage('Loading gateway checkout...');
      const isScriptLoaded = await paymentService.loadRazorpayScript();
      if (!isScriptLoaded || typeof window.Razorpay === 'undefined') {
        throw new Error('Unable to load payment gateway checkout script. Please check your network connection.');
      }

      // Check if test key placeholder is present
      if (!keyId || keyId.includes('placeholder')) {
        throw new Error(
          'Gateway credentials pending: RAZORPAY_KEY_ID is not configured in server/.env. Please configure your Razorpay Sandbox keys.'
        );
      }

      // 3. Open official Razorpay Checkout modal
      setCheckoutState('gateway_open');
      setStatusMessage('Complete payment in UPI window / QR code...');

      const options = {
        key: keyId,
        amount: amountInPaise,
        currency: currency || 'INR',
        name: 'TreadExMine',
        description: `Activation for ${plan.name} Node (${plan.durationDays} Days)`,
        order_id: orderId,
        prefill: {
          name: user?.name || '',
          email: user?.email || '',
        },
        theme: {
          color: '#7A56D6',
        },
        handler: async (response) => {
          // 4. Gateway confirmed payment client-side; strictly verify cryptographic signature on server
          setCheckoutState('verifying');
          setStatusMessage('Verifying cryptographic signature with server...');

          try {
            const verifyResponse = await paymentService.verifyPayment({
              orderId: response.razorpay_order_id,
              paymentId: response.razorpay_payment_id,
              signature: response.razorpay_signature,
            });

            if (verifyResponse.success) {
              setCheckoutState('success');
              setActivatedData(verifyResponse.data);
              // Refresh active subscriptions in parent component
              if (onSuccess) {
                await onSuccess(verifyResponse);
              }
            } else {
              setCheckoutState('error');
              setError(verifyResponse.message || 'Payment signature verification failed');
            }
          } catch (verifyErr) {
            setCheckoutState('error');
            const errDetail =
              verifyErr.response?.data?.message ||
              verifyErr.message ||
              'Payment verification error occurred. Please contact support with Order ID: ' + orderId;
            setError(errDetail);
          }
        },
        modal: {
          ondismiss: () => {
            if (checkoutState !== 'success' && checkoutState !== 'verifying') {
              setCheckoutState('idle');
              setStatusMessage('');
              setError('Payment was cancelled. You can retry checkout whenever ready.');
            }
          },
        },
      };

      const rzpInstance = new window.Razorpay(options);

      rzpInstance.on('payment.failed', (resp) => {
        setCheckoutState('error');
        const reason =
          resp.error?.description ||
          resp.error?.reason ||
          'Payment was declined by your UPI provider / bank.';
        setError(`Payment failed: ${reason}`);
      });

      rzpInstance.open();
    } catch (err) {
      setCheckoutState('error');
      const apiMsg =
        err.response?.data?.message ||
        (err.request
          ? 'Network error: Unable to contact server. Please check your connection and retry.'
          : err.message || 'An error occurred while initiating checkout.');
      setError(apiMsg);
    }
  };

  // --- Existing Internal Wallet Balance Purchase Flow ---
  const handleWalletPurchase = async () => {
    setCheckoutState('verifying');
    setError(null);
    setStatusMessage('Deducting wallet balance & deploying node...');

    const idempotencyKey =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `plan-wallet-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    try {
      const response = await planService.purchasePlan(plan._id, { idempotencyKey });
      if (response.success) {
        setCheckoutState('success');
        setActivatedData(response.data);
        if (onSuccess) {
          await onSuccess(response);
        }
      } else {
        setCheckoutState('error');
        setError(response.message || 'Purchase could not be processed');
      }
    } catch (err) {
      setCheckoutState('error');
      const apiMsg =
        err.response?.data?.message ||
        (err.request
          ? 'Network error: Unable to reach server. Please check your connection.'
          : err.message || 'An error occurred during wallet purchase.');
      setError(apiMsg);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
      {/* Backdrop */}
      <div className="fixed inset-0" onClick={!isProcessing ? onClose : undefined} aria-hidden="true" />

      {/* Modal Dialog Card */}
      <div className="relative w-full max-w-lg rounded-2xl bg-[#0e081e] border border-purple-900/60 p-6 sm:p-8 shadow-2xl shadow-purple-950/80 z-10 max-h-[95vh] overflow-y-auto">
        {/* Close Button */}
        {!isProcessing && checkoutState !== 'success' && (
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-gray-400 hover:text-white p-2 rounded-lg hover:bg-white/5 transition-colors focus:outline-none"
            aria-label="Close purchase modal"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}

        {checkoutState === 'success' ? (
          /* --- Success Screen --- */
          <div className="text-center py-4 animate-fadeIn">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-emerald-950/60 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shadow-lg shadow-emerald-950/60">
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            </div>

            <h3 className="text-2xl font-bold text-white tracking-tight mb-2">
              Plan Activated!
            </h3>
            <p className="text-sm text-gray-300 max-w-sm mx-auto mb-6 leading-relaxed">
              Your computational cluster for <span className="text-white font-semibold">{plan.name}</span> has been verified and provisioned to your account.
            </p>

            <div className="p-4 rounded-xl bg-white/[0.03] border border-white/10 mb-6 text-left text-xs space-y-2.5">
              <div className="flex justify-between text-gray-400">
                <span>Plan Subscribed:</span>
                <span className="text-white font-semibold">{plan.name}</span>
              </div>
              <div className="flex justify-between text-gray-400">
                <span>Total Amount Paid:</span>
                <span className="text-emerald-400 font-bold">{formattedInrPrice}</span>
              </div>
              <div className="flex justify-between text-gray-400">
                <span>Contract Duration:</span>
                <span className="text-white font-medium">{plan.durationDays} Days</span>
              </div>
              <div className="flex justify-between text-gray-400">
                <span>Hash Allocation:</span>
                <span className="text-purple-300 font-semibold">{plan.hashRate || 'Standard'}</span>
              </div>
              {activatedData?.payment?.paymentId && (
                <div className="flex justify-between text-gray-400 pt-2 border-t border-white/10 text-[11px]">
                  <span>Payment Reference:</span>
                  <span className="text-gray-300 font-mono">{activatedData.payment.paymentId}</span>
                </div>
              )}
            </div>

            <Button onClick={onClose} variant="primary" size="md" className="w-full">
              View Active Plans
            </Button>
          </div>
        ) : (
          /* --- Confirmation & Checkout Selection Screen --- */
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
                  Checkout & Plan Activation
                </h3>
                <p className="text-xs text-gray-400">
                  Select payment method and confirm node allocation
                </p>
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <div className="mb-4 p-3.5 rounded-xl bg-rose-950/60 border border-rose-800/60 text-rose-200 text-xs flex items-start gap-2.5">
                <svg className="w-4 h-4 flex-shrink-0 text-rose-400 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div className="flex-1">
                  <span className="font-semibold block mb-0.5">Payment Notice</span>
                  <span>{error}</span>
                </div>
              </div>
            )}

            {/* Plan Overview Card */}
            <div className="p-4 rounded-xl bg-white/[0.03] border border-purple-900/30 mb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-white">{plan.name}</span>
                {plan.hashRate && (
                  <span className="text-xs px-2.5 py-0.5 rounded bg-purple-950/60 border border-purple-800/40 text-purple-300 font-semibold">
                    {plan.hashRate}
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-400 line-clamp-2 mb-3">
                {plan.description || 'Dedicated cloud computing node allocated to your account.'}
              </p>
              <div className="flex items-baseline justify-between pt-2 border-t border-white/10 text-xs">
                <span className="text-gray-400">Final Amount to Pay:</span>
                <span className="text-xl font-extrabold text-white tracking-tight">
                  {formattedInrPrice}
                  <span className="text-xs text-gray-400 ml-1.5 font-normal">INR</span>
                </span>
              </div>
            </div>

            {/* Payment Method Selector */}
            <div className="mb-5">
              <label className="text-xs font-semibold uppercase tracking-wider text-gray-400 block mb-2">
                Select Payment Method
              </label>

              <div className="grid grid-cols-2 gap-3">
                {/* Option 1: Direct UPI (Razorpay) */}
                <button
                  type="button"
                  onClick={() => setPaymentMethod('upi')}
                  disabled={isProcessing}
                  className={`p-3 rounded-xl border text-left transition-all relative ${
                    paymentMethod === 'upi'
                      ? 'bg-purple-950/40 border-[#7A56D6] shadow-sm shadow-[#7A56D6]/30'
                      : 'bg-white/[0.02] border-white/10 hover:border-white/20'
                  }`}
                >
                  <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-800/40 block w-fit mb-1.5">
                    Recommended
                  </span>
                  <span className="text-xs font-bold text-white block">UPI Gateway</span>
                  <span className="text-[11px] text-gray-400 block mt-0.5">
                    GPay, PhonePe, Paytm, QR
                  </span>
                </button>

                {/* Option 2: Internal Wallet */}
                <button
                  type="button"
                  onClick={() => setPaymentMethod('wallet')}
                  disabled={isProcessing}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    paymentMethod === 'wallet'
                      ? 'bg-purple-950/40 border-[#7A56D6] shadow-sm shadow-[#7A56D6]/30'
                      : 'bg-white/[0.02] border-white/10 hover:border-white/20'
                  }`}
                >
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 block mb-1.5">
                    Internal Wallet
                  </span>
                  <span className="text-xs font-bold text-white block">Balance</span>
                  <span className="text-[11px] text-gray-400 block mt-0.5">
                    ₹{currentWalletBalance.toFixed(2)}
                  </span>
                </button>
              </div>
            </div>

            {/* UPI Details Box */}
            {paymentMethod === 'upi' && (
              <div className="p-3.5 rounded-xl bg-purple-950/20 border border-purple-900/30 mb-5 text-xs text-gray-300 space-y-2">
                <div className="flex items-center gap-2 text-purple-300 font-semibold">
                  <svg className="w-4 h-4 text-[#7A56D6]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                  <span>Instant UPI Activation</span>
                </div>
                <p className="text-[11px] text-gray-400 leading-relaxed">
                  You can pay via PhonePe, Google Pay, Paytm, or scan the dynamic UPI QR code. No wallet deduction or wallet balance required.
                </p>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <span className="px-2 py-0.5 rounded bg-black/40 border border-white/10 text-[10px] text-gray-300">
                    PhonePe
                  </span>
                  <span className="px-2 py-0.5 rounded bg-black/40 border border-white/10 text-[10px] text-gray-300">
                    Google Pay
                  </span>
                  <span className="px-2 py-0.5 rounded bg-black/40 border border-white/10 text-[10px] text-gray-300">
                    Paytm
                  </span>
                  <span className="px-2 py-0.5 rounded bg-black/40 border border-white/10 text-[10px] text-gray-300">
                    UPI QR
                  </span>
                </div>
              </div>
            )}

            {/* Wallet Details Box */}
            {paymentMethod === 'wallet' && (
              <div className="p-4 rounded-xl bg-black/40 border border-white/10 space-y-3 mb-5 text-xs">
                <div className="flex items-center justify-between text-gray-400">
                  <span>Available Wallet Balance</span>
                  <span className="font-semibold text-white">₹{currentWalletBalance.toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between text-gray-400">
                  <span>Plan Cost</span>
                  <span className="font-semibold text-rose-400">-{formattedInrPrice}</span>
                </div>
                <div className="pt-2 border-t border-white/10 flex items-center justify-between">
                  <span className="text-gray-300">Projected Balance</span>
                  <span
                    className={`font-bold ${
                      isSufficientWalletBalance ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {isSufficientWalletBalance
                      ? `₹${(currentWalletBalance - planPrice).toFixed(2)}`
                      : 'Insufficient Wallet Funds'}
                  </span>
                </div>
                {!isSufficientWalletBalance && (
                  <p className="text-[11px] text-amber-300 pt-1">
                    Tip: Switch to <strong>UPI Gateway</strong> to pay directly without depositing into your wallet.
                  </p>
                )}
              </div>
            )}

            {/* Modal Actions */}
            <div className="flex flex-col sm:flex-row items-center justify-end gap-3">
              <Button
                onClick={onClose}
                variant="ghost"
                size="md"
                disabled={isProcessing}
                className="w-full sm:w-auto"
              >
                Cancel
              </Button>

              {paymentMethod === 'upi' ? (
                <Button
                  onClick={handleUpiCheckout}
                  variant="primary"
                  size="md"
                  disabled={isProcessing}
                  className="w-full sm:w-auto"
                >
                  {isProcessing ? (
                    <span className="flex items-center gap-2">
                      <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                      </svg>
                      {statusMessage || 'Processing...'}
                    </span>
                  ) : (
                    `Pay ${formattedInrPrice} via UPI`
                  )}
                </Button>
              ) : (
                <Button
                  onClick={handleWalletPurchase}
                  variant="primary"
                  size="md"
                  disabled={!isSufficientWalletBalance || isProcessing}
                  className="w-full sm:w-auto"
                >
                  {isProcessing ? (
                    <span className="flex items-center gap-2">
                      <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                      </svg>
                      Deploying...
                    </span>
                  ) : (
                    `Pay from Wallet (${formattedInrPrice})`
                  )}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default PurchaseConfirmationModal;
