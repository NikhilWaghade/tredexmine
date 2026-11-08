import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context';
import { walletService, paymentService } from '../../services';
import { Container, Button, Card, SectionHeader } from '../../components/common';

// Helper to format currency
const formatINR = (val) => {
  const num = Number(val || 0);
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(num);
};

// Helper to format date
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

// Pure Status Badge Component
function StatusBadge({ status }) {
  const s = String(status || '').toUpperCase();
  let colorClasses = 'bg-gray-800 text-gray-300 border-gray-700';

  if (s === 'COMPLETED' || s === 'CAPTURED') {
    colorClasses = 'bg-emerald-950/70 text-emerald-300 border-emerald-800/60 shadow-sm shadow-emerald-900/30';
  } else if (s === 'PENDING' || s === 'CREATED') {
    colorClasses = 'bg-amber-950/70 text-amber-300 border-amber-800/60 shadow-sm shadow-amber-900/30';
  } else if (s === 'APPROVED' || s === 'AUTHORIZED') {
    colorClasses = 'bg-blue-950/70 text-blue-300 border-blue-800/60 shadow-sm shadow-blue-900/30';
  } else if (s === 'PROCESSING') {
    colorClasses = 'bg-purple-950/70 text-purple-300 border-purple-800/60 shadow-sm shadow-purple-900/30';
  } else if (s === 'REJECTED' || s === 'FAILED') {
    colorClasses = 'bg-rose-950/70 text-rose-300 border-rose-800/60 shadow-sm shadow-rose-900/30';
  } else if (s === 'CANCELLED') {
    colorClasses = 'bg-zinc-900 text-zinc-400 border-zinc-800';
  }

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${colorClasses}`}>
      {s}
    </span>
  );
}

export function WalletPage() {
  const { user, wallet: contextWallet, refreshWallet } = useAuth();

  // Active view tab: 'overview' | 'deposit' | 'withdraw' | 'history'
  const [activeTab, setActiveTab] = useState('overview');
  const [historySubTab, setHistorySubTab] = useState('withdrawals'); // 'deposits' | 'withdrawals' | 'transactions'

  // Loading & error states
  const [loading, setLoading] = useState(true);
  const [walletData, setWalletData] = useState(null);
  const [deposits, setDeposits] = useState([]);
  const [withdrawals, setWithdrawals] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [feedback, setFeedback] = useState(null); // { type: 'success' | 'error', message: '' }

  // Deposit form state
  const [depositAmount, setDepositAmount] = useState('1000');
  const [depositProvider, setDepositProvider] = useState('mock'); // 'mock' | 'razorpay'
  const [depositSubmitting, setDepositSubmitting] = useState(false);

  // Withdrawal form state
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [payoutMethod, setPayoutMethod] = useState('upi'); // 'upi' | 'bank_transfer'
  const [payoutIdentifier, setPayoutIdentifier] = useState('');
  const [accountHolderName, setAccountHolderName] = useState('');
  const [withdrawSubmitting, setWithdrawSubmitting] = useState(false);
  const [confirmWithdrawModal, setConfirmWithdrawModal] = useState(false);

  // Cancellation state
  const [cancellingId, setCancellingId] = useState(null);

  // Fetch full wallet overview and histories
  const loadWalletDetails = useCallback(async () => {
    setLoading(true);
    try {
      const [walletRes, depRes, withRes, txRes] = await Promise.allSettled([
        walletService.getWallet(),
        walletService.getDeposits({ limit: 20 }),
        walletService.getWithdrawals({ limit: 20 }),
        walletService.getTransactions({ limit: 20 }),
      ]);

      if (walletRes.status === 'fulfilled' && walletRes.value?.success) {
        setWalletData(walletRes.value.wallet);
      } else if (contextWallet) {
        setWalletData(contextWallet);
      }

      if (depRes.status === 'fulfilled' && depRes.value?.success) {
        setDeposits(depRes.value.deposits || []);
      }

      if (withRes.status === 'fulfilled' && withRes.value?.success) {
        setWithdrawals(withRes.value.withdrawals || []);
      }

      if (txRes.status === 'fulfilled' && txRes.value?.success) {
        setTransactions(txRes.value.transactions || []);
      }
    } catch (err) {
      console.error('[WalletPage] Error loading wallet details:', err);
    } finally {
      setLoading(false);
    }
  }, [contextWallet]);

  useEffect(() => {
    let isMounted = true;
    Promise.resolve().then(() => {
      if (isMounted) {
        loadWalletDetails();
      }
    });
    return () => {
      isMounted = false;
    };
  }, [loadWalletDetails]);

  // Handle Deposit Submission
  const handleDepositSubmit = async (e) => {
    e.preventDefault();
    setFeedback(null);

    const amountNum = Number(depositAmount);
    if (!amountNum || amountNum < 100 || amountNum > 500000) {
      setFeedback({
        type: 'error',
        message: 'Deposit amount must be between ₹100 and ₹500,000',
      });
      return;
    }

    setDepositSubmitting(true);
    try {
      const idempotencyKey = `dep_intent_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

      // 1. Create deposit intent
      const intentRes = await walletService.createDepositIntent({
        amount: amountNum,
        provider: depositProvider,
        idempotencyKey,
      });

      if (!intentRes.success) {
        throw new Error(intentRes.message || 'Failed to initiate deposit intent');
      }

      const intentData = intentRes.data;

      // 2. In Development / Mock mode, complete server-side verification using secure mock token
      if (depositProvider === 'mock') {
        const verifyRes = await walletService.verifyDeposit({
          depositReference: intentData.depositReference,
          orderId: intentData.orderId,
          signature: intentData.mockSignature,
        });

        if (verifyRes.success) {
          setFeedback({
            type: 'success',
            message: `Deposit of ${formatINR(amountNum)} credited successfully! Reference: ${intentData.depositReference}`,
          });
          await refreshWallet();
          await loadWalletDetails();
          setActiveTab('overview');
        } else {
          throw new Error(verifyRes.message || 'Deposit verification failed');
        }
      } else {
        // Razorpay test mode checkout flow
        const keyId = intentData.keyId;
        if (!keyId || keyId.includes('placeholder')) {
          throw new Error(
            'Razorpay test mode gateway is not configured on the server. Please configure RAZORPAY_KEY_ID or use Dev Simulation mode.'
          );
        }

        const isScriptLoaded = await paymentService.loadRazorpayScript();
        if (!isScriptLoaded || typeof window.Razorpay === 'undefined') {
          throw new Error('Unable to load payment gateway checkout script. Please check your network connection.');
        }

        const options = {
          key: keyId,
          amount: Math.round(amountNum * 100),
          currency: 'INR',
          name: 'Minetrades',
          description: `Wallet Deposit (Test Mode) - Ref: ${intentData.depositReference}`,
          order_id: intentData.orderId,
          prefill: {
            name: user?.name || '',
            email: user?.email || '',
          },
          theme: {
            color: '#7A56D6',
          },
          handler: async (response) => {
            setDepositSubmitting(true);
            try {
              const verifyRes = await walletService.verifyDeposit({
                depositReference: intentData.depositReference,
                orderId: response.razorpay_order_id,
                paymentId: response.razorpay_payment_id,
                signature: response.razorpay_signature,
              });

              if (verifyRes.success) {
                setFeedback({
                  type: 'success',
                  message: `Deposit of ${formatINR(amountNum)} credited successfully! Reference: ${intentData.depositReference}`,
                });
                await refreshWallet();
                await loadWalletDetails();
                setActiveTab('overview');
              } else {
                throw new Error(verifyRes.message || 'Deposit verification failed');
              }
            } catch (verifyErr) {
              setFeedback({
                type: 'error',
                message: verifyErr.response?.data?.message || verifyErr.message || 'Deposit verification failed',
              });
            } finally {
              setDepositSubmitting(false);
            }
          },
          modal: {
            ondismiss: () => {
              setDepositSubmitting(false);
              setFeedback({
                type: 'error',
                message: 'Deposit checkout was cancelled.',
              });
            },
          },
        };

        const rzpInstance = new window.Razorpay(options);
        rzpInstance.on('payment.failed', (resp) => {
          setDepositSubmitting(false);
          const reason = resp.error?.description || resp.error?.reason || 'Payment was declined by payment gateway';
          setFeedback({
            type: 'error',
            message: `Deposit failed: ${reason}`,
          });
        });
        rzpInstance.open();
        return;
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err.response?.data?.message || err.message || 'Deposit failed. Please try again.',
      });
    } finally {
      setDepositSubmitting(false);
    }
  };

  // Handle Withdrawal Request Submission
  const handleWithdrawalSubmit = async () => {
    setFeedback(null);
    const amountNum = Number(withdrawAmount);
    const currentBalance = Number(walletData?.balance || 0);

    if (!amountNum || amountNum < 100) {
      setFeedback({
        type: 'error',
        message: 'Minimum withdrawal amount is ₹100',
      });
      return;
    }

    if (amountNum > currentBalance) {
      setFeedback({
        type: 'error',
        message: `Insufficient withdrawable balance. Available: ${formatINR(currentBalance)}`,
      });
      return;
    }

    if (!payoutIdentifier.trim()) {
      setFeedback({
        type: 'error',
        message: payoutMethod === 'upi' ? 'Please provide a valid UPI ID' : 'Please provide bank account number',
      });
      return;
    }

    setWithdrawSubmitting(true);
    setConfirmWithdrawModal(false);

    try {
      const idempotencyKey = `wth_req_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

      const res = await walletService.createWithdrawal({
        amount: amountNum,
        idempotencyKey,
        payoutMethod,
        payoutDetails: {
          identifier: payoutIdentifier.trim(),
          accountHolderName: accountHolderName.trim() || user?.name || '',
        },
      });

      if (res.success) {
        setFeedback({
          type: 'success',
          message: `Withdrawal request for ${formatINR(amountNum)} submitted successfully! Funds reserved. Reference: ${res.withdrawal.withdrawalReference}`,
        });
        setWithdrawAmount('');
        setPayoutIdentifier('');
        await refreshWallet();
        await loadWalletDetails();
        setActiveTab('history');
        setHistorySubTab('withdrawals');
      } else {
        throw new Error(res.message || 'Failed to submit withdrawal request');
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err.response?.data?.message || err.message || 'Withdrawal failed. Please try again.',
      });
    } finally {
      setWithdrawSubmitting(false);
    }
  };

  // Handle User Cancellation of Pending Withdrawal
  const handleCancelWithdrawal = async (withdrawalId) => {
    if (!window.confirm('Are you sure you want to cancel this pending withdrawal request? The reserved balance will be refunded immediately.')) {
      return;
    }

    setCancellingId(withdrawalId);
    setFeedback(null);
    try {
      const res = await walletService.cancelWithdrawal(withdrawalId);
      if (res.success) {
        setFeedback({
          type: 'success',
          message: 'Withdrawal request cancelled. Reserved funds have been restored to your available balance.',
        });
        await refreshWallet();
        await loadWalletDetails();
      } else {
        throw new Error(res.message || 'Cancellation failed');
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err.response?.data?.message || err.message || 'Failed to cancel withdrawal',
      });
    } finally {
      setCancellingId(null);
    }
  };


  const balance = Number(walletData?.balance || 0);
  const pendingAmount = Number(walletData?.pendingWithdrawalAmount || 0);
  const totalWithdrawn = Number(walletData?.totalWithdrawn || 0);

  return (
    <div className="min-h-screen bg-[#07050d] text-white pt-24 pb-20">
      <Container>
        {/* Page Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
            <SectionHeader
              title="Secure Wallet Hub"
              subtitle="Manage deposits, balance reservations, and withdrawal requests with complete ledger transparency."
              align="left"
              className="mb-0"
            />
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              size="sm"
              onClick={async () => {
                await refreshWallet();
                await loadWalletDetails();
              }}
              disabled={loading}
              className="text-xs"
            >
              <svg className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Refresh Balance
            </Button>
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
            <div className="flex items-center gap-3">
              <span className="text-xl">
                {feedback.type === 'success' ? '✓' : '⚠'}
              </span>
              <p className="text-sm font-medium">{feedback.message}</p>
            </div>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              className="text-gray-400 hover:text-white text-lg font-bold px-2"
            >
              ×
            </button>
          </div>
        )}

        {/* Balance Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {/* Available / Withdrawable Balance */}
          <Card className="p-6 relative overflow-hidden bg-gradient-to-br from-purple-950/30 to-black/60 border-purple-800/30">
            <div className="flex items-center justify-between text-xs text-purple-300 font-medium mb-2 uppercase tracking-wider">
              <span>Available Balance</span>
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            </div>
            <div className="text-2xl sm:text-3xl font-extrabold text-emerald-400 tracking-tight">
              {formatINR(balance)}
            </div>
            <p className="text-[11px] text-gray-400 mt-2">
              Unreserved funds available for plans or withdrawals
            </p>
          </Card>

          {/* Pending Reserved Withdrawals */}
          <Card className="p-6 relative overflow-hidden bg-white/[0.02] border-white/10">
            <div className="flex items-center justify-between text-xs text-amber-300 font-medium mb-2 uppercase tracking-wider">
              <span>Pending Withdrawals</span>
              <span className="w-2 h-2 rounded-full bg-amber-400" />
            </div>
            <div className="text-2xl sm:text-3xl font-bold text-amber-300 tracking-tight">
              {formatINR(pendingAmount)}
            </div>
            <p className="text-[11px] text-gray-400 mt-2">
              Reserved funds awaiting admin review / processing
            </p>
          </Card>

          {/* Total Lifetime Withdrawn */}
          <Card className="p-6 relative overflow-hidden bg-white/[0.02] border-white/10">
            <div className="flex items-center justify-between text-xs text-gray-400 font-medium mb-2 uppercase tracking-wider">
              <span>Total Withdrawn</span>
              <svg className="w-4 h-4 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div className="text-2xl sm:text-3xl font-bold text-gray-200 tracking-tight">
              {formatINR(totalWithdrawn)}
            </div>
            <p className="text-[11px] text-gray-400 mt-2">
              Total completed historical payouts
            </p>
          </Card>

          {/* Plan & Referral Earnings */}
          <Card className="p-6 relative overflow-hidden bg-white/[0.02] border-white/10">
            <div className="flex items-center justify-between text-xs text-gray-400 font-medium mb-2 uppercase tracking-wider">
              <span>Verified Ledger Income</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-900/50 text-purple-200 border border-purple-700/50">
                Ledger
              </span>
            </div>
            <div className="text-2xl sm:text-3xl font-bold text-purple-300 tracking-tight">
              {formatINR(Number(walletData?.planIncome || 0) + Number(walletData?.referralIncome || 0))}
            </div>
            <p className="text-[11px] text-gray-400 mt-2">
              Derived strictly from verified completed yield ledger entries
            </p>
          </Card>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 border-b border-white/10 mb-8 pb-3 overflow-x-auto">
          {[
            { id: 'overview', label: 'Wallet Overview' },
            { id: 'deposit', label: 'Deposit Funds' },
            { id: 'withdraw', label: 'Request Withdrawal' },
            { id: 'history', label: 'Audit History' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all whitespace-nowrap ${
                activeTab === tab.id
                  ? 'bg-[#7A56D6] text-white shadow-md shadow-[#7A56D6]/40'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* TAB 1: OVERVIEW */}
        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-6">
              {/* Quick Actions Card */}
              <Card className="p-6">
                <h3 className="text-lg font-bold text-white mb-2">Wallet Action Center</h3>
                <p className="text-sm text-gray-400 mb-6">
                  Add testing funds to your balance or reserve available funds for withdrawal.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div
                    onClick={() => setActiveTab('deposit')}
                    className="p-5 rounded-xl bg-purple-950/20 border border-purple-800/40 hover:border-[#7A56D6] cursor-pointer transition-all group"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <span className="p-2.5 rounded-lg bg-[#7A56D6]/20 text-[#7A56D6] group-hover:scale-110 transition-transform">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                      </span>
                      <span className="text-xs text-purple-400 font-semibold group-hover:translate-x-1 transition-transform">
                        Deposit →
                      </span>
                    </div>
                    <h4 className="font-bold text-white text-base">Deposit Funds</h4>
                    <p className="text-xs text-gray-400 mt-1">
                      Add simulated development funds or initiate a gateway checkout order.
                    </p>
                  </div>

                  <div
                    onClick={() => setActiveTab('withdraw')}
                    className="p-5 rounded-xl bg-purple-950/20 border border-purple-800/40 hover:border-[#7A56D6] cursor-pointer transition-all group"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <span className="p-2.5 rounded-lg bg-emerald-500/20 text-emerald-400 group-hover:scale-110 transition-transform">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                      </span>
                      <span className="text-xs text-emerald-400 font-semibold group-hover:translate-x-1 transition-transform">
                        Withdraw →
                      </span>
                    </div>
                    <h4 className="font-bold text-white text-base">Request Withdrawal</h4>
                    <p className="text-xs text-gray-400 mt-1">
                      Reserve available funds for admin review and payout tracking.
                    </p>
                  </div>
                </div>
              </Card>

              {/* Recent Ledger Entries */}
              <Card className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-base font-bold text-white">Recent Ledger Transactions</h3>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('history');
                      setHistorySubTab('transactions');
                    }}
                    className="text-xs text-[#7A56D6] hover:text-purple-300 font-semibold"
                  >
                    View All →
                  </button>
                </div>

                {transactions.length === 0 ? (
                  <div className="text-center py-8 text-gray-500 text-sm">
                    No transactions recorded yet.
                  </div>
                ) : (
                  <div className="divide-y divide-white/5">
                    {transactions.slice(0, 5).map((tx) => (
                      <div key={tx._id} className="py-3 flex items-center justify-between">
                        <div>
                          <div className="text-sm font-semibold text-white">
                            {tx.description || tx.type}
                          </div>
                          <div className="text-[11px] text-gray-400">
                            {formatDate(tx.createdAt)} • Ref: {tx.reference || 'N/A'}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className={`text-sm font-bold ${tx.type === 'credit' ? 'text-emerald-400' : 'text-gray-300'}`}>
                            {tx.type === 'credit' ? '+' : '-'} {formatINR(tx.amount)}
                          </div>
                          <div className="text-[10px] text-gray-500">
                            Bal: {formatINR(tx.balanceAfter)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>

            {/* Right Safety & Policy Sidebar */}
            <div className="space-y-6">
              <Card className="p-6 bg-gradient-to-b from-purple-950/20 to-black/60 border-purple-900/40">
                <div className="flex items-center gap-2 text-amber-400 text-xs font-bold uppercase tracking-wider mb-3">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <span>Development Milestone</span>
                </div>
                <p className="text-xs text-gray-300 leading-relaxed mb-4">
                  This environment is configured exclusively for <strong>development and integration testing</strong>.
                </p>
                <ul className="text-xs text-gray-400 space-y-2">
                  <li className="flex items-start gap-2">
                    <span className="text-emerald-400">✓</span>
                    <span>Multi-document balance reservation and race-condition prevention enabled.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-emerald-400">✓</span>
                    <span>Live money collection & automated profit payments permanently disabled.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-emerald-400">✓</span>
                    <span>All test credits and withdrawals clearly labelled in audit ledger.</span>
                  </li>
                </ul>
              </Card>
            </div>
          </div>
        )}

        {/* TAB 2: DEPOSIT FUNDS */}
        {activeTab === 'deposit' && (
          <div className="max-w-2xl mx-auto">
            <Card className="p-6 sm:p-8">
              <h3 className="text-xl font-bold text-white mb-2">Deposit to Wallet</h3>
              <p className="text-xs text-gray-400 mb-6">
                Funds are added securely and credited immediately to your authoritative balance upon server verification.
              </p>

              {/* Dev Simulation Banner */}
              <div className="p-3.5 rounded-xl bg-purple-950/50 border border-purple-700/60 text-purple-200 text-xs mb-6 flex items-center gap-3">
                <span className="text-lg">⚡</span>
                <div>
                  <span className="font-bold text-white">Mock Test Deposit Mode Active: </span>
                  Simulates a verified payment callback with a cryptographic server signature. No real bank charge.
                </div>
              </div>

              <form onSubmit={handleDepositSubmit} className="space-y-6">
                {/* Quick Amount Chips */}
                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-2 uppercase tracking-wider">
                    Select Quick Amount
                  </label>
                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                    {['500', '1000', '2500', '5000', '10000'].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setDepositAmount(preset)}
                        className={`py-2 px-3 rounded-xl text-xs font-bold transition-all border ${
                          depositAmount === preset
                            ? 'bg-[#7A56D6] text-white border-[#7A56D6] shadow-sm shadow-[#7A56D6]/40'
                            : 'bg-white/5 hover:bg-white/10 text-gray-300 border-white/10'
                        }`}
                      >
                        ₹{Number(preset).toLocaleString('en-IN')}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Amount Input */}
                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-2 uppercase tracking-wider">
                    Custom Amount (INR)
                  </label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-lg">
                      ₹
                    </span>
                    <input
                      type="number"
                      min="100"
                      max="500000"
                      value={depositAmount}
                      onChange={(e) => setDepositAmount(e.target.value)}
                      placeholder="e.g. 5000"
                      required
                      className="w-full pl-9 pr-4 py-3 rounded-xl bg-black/60 border border-white/10 text-white font-bold text-lg focus:outline-none focus:border-[#7A56D6] transition-colors"
                    />
                  </div>
                  <p className="text-[11px] text-gray-400 mt-1.5">
                    Minimum deposit: ₹100 • Maximum: ₹500,000 per transaction
                  </p>
                </div>

                {/* Provider Selection */}
                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-2 uppercase tracking-wider">
                    Provider
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label
                      className={`p-3.5 rounded-xl border cursor-pointer transition-all flex items-center justify-between ${
                        depositProvider === 'mock'
                          ? 'bg-[#7A56D6]/20 border-[#7A56D6] text-white shadow-sm shadow-[#7A56D6]/20'
                          : 'bg-white/5 border-white/10 text-gray-400 hover:text-white'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="depositProvider"
                          value="mock"
                          checked={depositProvider === 'mock'}
                          onChange={() => setDepositProvider('mock')}
                          className="accent-[#7A56D6]"
                        />
                        <span className="text-xs font-bold">Dev Simulation</span>
                      </div>
                      <span className="text-[10px] bg-purple-900/60 text-purple-300 px-2 py-0.5 rounded-full">
                        Recommended
                      </span>
                    </label>

                    <label
                      className={`p-3.5 rounded-xl border cursor-pointer transition-all flex items-center justify-between ${
                        depositProvider === 'razorpay'
                          ? 'bg-[#7A56D6]/20 border-[#7A56D6] text-white'
                          : 'bg-white/5 border-white/10 text-gray-400 hover:text-white'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="depositProvider"
                          value="razorpay"
                          checked={depositProvider === 'razorpay'}
                          onChange={() => setDepositProvider('razorpay')}
                          className="accent-[#7A56D6]"
                        />
                        <span className="text-xs font-bold">Razorpay Gateway</span>
                      </div>
                      <span className="text-[10px] bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded-full">
                        Protected
                      </span>
                    </label>
                  </div>
                </div>

                {/* Submit Action */}
                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  disabled={depositSubmitting}
                  className="w-full text-base font-bold shadow-lg shadow-[#7A56D6]/30"
                >
                  {depositSubmitting ? (
                    <span className="flex items-center gap-2">
                      <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                      </svg>
                      Verifying & Crediting...
                    </span>
                  ) : (
                    `Complete Deposit of ₹${Number(depositAmount || 0).toLocaleString('en-IN')}`
                  )}
                </Button>
              </form>
            </Card>
          </div>
        )}

        {/* TAB 3: REQUEST WITHDRAWAL */}
        {activeTab === 'withdraw' && (
          <div className="max-w-2xl mx-auto">
            <Card className="p-6 sm:p-8">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xl font-bold text-white">Withdrawal Request</h3>
                <span className="text-xs text-emerald-400 font-semibold bg-emerald-950/60 border border-emerald-800/40 px-3 py-1 rounded-full">
                  Available: {formatINR(balance)}
                </span>
              </div>
              <p className="text-xs text-gray-400 mb-6">
                Funds are reserved from your available balance immediately upon request acceptance.
              </p>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setConfirmWithdrawModal(true);
                }}
                className="space-y-6"
              >
                {/* Amount Input */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
                      Amount to Withdraw
                    </label>
                    <button
                      type="button"
                      onClick={() => setWithdrawAmount(String(balance))}
                      className="text-xs text-[#7A56D6] hover:text-purple-300 font-bold"
                    >
                      Use Max ({formatINR(balance)})
                    </button>
                  </div>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-lg">
                      ₹
                    </span>
                    <input
                      type="number"
                      min="100"
                      max={balance}
                      value={withdrawAmount}
                      onChange={(e) => setWithdrawAmount(e.target.value)}
                      placeholder="e.g. 500"
                      required
                      className="w-full pl-9 pr-4 py-3 rounded-xl bg-black/60 border border-white/10 text-white font-bold text-lg focus:outline-none focus:border-[#7A56D6] transition-colors"
                    />
                  </div>
                  <p className="text-[11px] text-gray-400 mt-1.5">
                    Minimum: ₹100 • Reserved balance is refunded automatically if rejected or cancelled.
                  </p>
                </div>

                {/* Payout Method */}
                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-2 uppercase tracking-wider">
                    Payout Method
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setPayoutMethod('upi')}
                      className={`p-3.5 rounded-xl border text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                        payoutMethod === 'upi'
                          ? 'bg-[#7A56D6] text-white border-[#7A56D6] shadow-sm shadow-[#7A56D6]/40'
                          : 'bg-white/5 border-white/10 text-gray-300 hover:text-white'
                      }`}
                    >
                      <span>⚡ UPI ID / VPA</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setPayoutMethod('bank_transfer')}
                      className={`p-3.5 rounded-xl border text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                        payoutMethod === 'bank_transfer'
                          ? 'bg-[#7A56D6] text-white border-[#7A56D6] shadow-sm shadow-[#7A56D6]/40'
                          : 'bg-white/5 border-white/10 text-gray-300 hover:text-white'
                      }`}
                    >
                      <span>🏦 Bank Account</span>
                    </button>
                  </div>
                </div>

                {/* Payout Identifier Input */}
                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-2 uppercase tracking-wider">
                    {payoutMethod === 'upi' ? 'UPI Virtual Address (VPA)' : 'Bank Account Number / Details'}
                  </label>
                  <input
                    type="text"
                    value={payoutIdentifier}
                    onChange={(e) => setPayoutIdentifier(e.target.value)}
                    placeholder={payoutMethod === 'upi' ? 'user@upi' : 'Account number or IFSC'}
                    required
                    className="w-full px-4 py-3 rounded-xl bg-black/60 border border-white/10 text-white text-sm focus:outline-none focus:border-[#7A56D6] transition-colors"
                  />
                  <p className="text-[11px] text-gray-400 mt-1.5">
                    Only masked identifiers are stored in the database for privacy.
                  </p>
                </div>

                {/* Optional Account Holder Name */}
                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-2 uppercase tracking-wider">
                    Account Holder Name (Optional)
                  </label>
                  <input
                    type="text"
                    value={accountHolderName}
                    onChange={(e) => setAccountHolderName(e.target.value)}
                    placeholder={user?.name || 'Full Name'}
                    className="w-full px-4 py-3 rounded-xl bg-black/60 border border-white/10 text-white text-sm focus:outline-none focus:border-[#7A56D6] transition-colors"
                  />
                </div>

                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  disabled={withdrawSubmitting || balance < 100 || Number(withdrawAmount) > balance}
                  className="w-full text-base font-bold shadow-lg shadow-[#7A56D6]/30"
                >
                  Review & Submit Withdrawal
                </Button>
              </form>
            </Card>

            {/* Confirmation Modal */}
            {confirmWithdrawModal && (
              <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
                <Card className="max-w-md w-full p-6 border-purple-800/80 bg-[#0d091a]">
                  <h4 className="text-lg font-bold text-white mb-2">Confirm Withdrawal Request</h4>
                  <p className="text-xs text-gray-400 mb-4 leading-relaxed">
                    Please review your withdrawal request details. Upon confirmation, <strong className="text-white">{formatINR(withdrawAmount)}</strong> will be reserved from your available balance immediately.
                  </p>

                  <div className="p-3.5 rounded-xl bg-white/5 border border-white/10 text-xs space-y-2 mb-6">
                    <div className="flex justify-between">
                      <span className="text-gray-400">Withdrawal Amount:</span>
                      <span className="font-bold text-emerald-400">{formatINR(withdrawAmount)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Remaining Balance:</span>
                      <span className="font-bold text-white">{formatINR(balance - Number(withdrawAmount))}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Method:</span>
                      <span className="font-bold text-purple-300 uppercase">{payoutMethod}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Recipient Identifier:</span>
                      <span className="font-mono text-gray-200">{payoutIdentifier}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <Button
                      variant="ghost"
                      size="md"
                      onClick={() => setConfirmWithdrawModal(false)}
                      className="flex-1 text-xs"
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="primary"
                      size="md"
                      onClick={handleWithdrawalSubmit}
                      disabled={withdrawSubmitting}
                      className="flex-1 text-xs font-bold"
                    >
                      {withdrawSubmitting ? 'Reserving...' : 'Confirm & Reserve Funds'}
                    </Button>
                  </div>
                </Card>
              </div>
            )}
          </div>
        )}

        {/* TAB 4: AUDIT HISTORY */}
        {activeTab === 'history' && (
          <div className="space-y-6">
            {/* Sub-tab pills */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setHistorySubTab('withdrawals')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  historySubTab === 'withdrawals'
                    ? 'bg-purple-600 text-white'
                    : 'bg-white/5 text-gray-400 hover:text-white'
                }`}
              >
                Withdrawal Requests ({withdrawals.length})
              </button>

              <button
                type="button"
                onClick={() => setHistorySubTab('deposits')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  historySubTab === 'deposits'
                    ? 'bg-purple-600 text-white'
                    : 'bg-white/5 text-gray-400 hover:text-white'
                }`}
              >
                Deposit History ({deposits.length})
              </button>

              <button
                type="button"
                onClick={() => setHistorySubTab('transactions')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  historySubTab === 'transactions'
                    ? 'bg-purple-600 text-white'
                    : 'bg-white/5 text-gray-400 hover:text-white'
                }`}
              >
                Full Transaction Ledger ({transactions.length})
              </button>
            </div>

            {/* WITHDRAWALS TABLE */}
            {historySubTab === 'withdrawals' && (
              <Card className="p-0 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-white/[0.04] text-gray-400 uppercase font-semibold border-b border-white/5">
                      <tr>
                        <th className="px-6 py-3.5">Reference</th>
                        <th className="px-6 py-3.5">Date</th>
                        <th className="px-6 py-3.5">Amount</th>
                        <th className="px-6 py-3.5">Method</th>
                        <th className="px-6 py-3.5">Status</th>
                        <th className="px-6 py-3.5 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {withdrawals.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-6 py-8 text-center text-gray-500">
                            No withdrawal requests recorded yet.
                          </td>
                        </tr>
                      ) : (
                        withdrawals.map((w) => (
                          <tr key={w._id} className="hover:bg-white/[0.02] transition-colors">
                            <td className="px-6 py-4 font-mono font-bold text-purple-300">
                              {w.withdrawalReference}
                            </td>
                            <td className="px-6 py-4 text-gray-400">
                              {formatDate(w.createdAt)}
                            </td>
                            <td className="px-6 py-4 font-bold text-white">
                              {formatINR(w.amount)}
                            </td>
                            <td className="px-6 py-4 text-gray-300 capitalize">
                              {w.payoutMethod || 'UPI'}{' '}
                              {w.payoutDetails?.maskedIdentifier && (
                                <span className="text-gray-500 font-mono text-[11px]">
                                  ({w.payoutDetails.maskedIdentifier})
                                </span>
                              )}
                            </td>
                            <td className="px-6 py-4">
                              <StatusBadge status={w.status} />
                              {w.rejectionReason && (
                                <div className="text-[10px] text-rose-400 mt-1">
                                  Reason: {w.rejectionReason}
                                </div>
                              )}
                            </td>
                            <td className="px-6 py-4 text-right">
                              {w.status === 'PENDING' && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={cancellingId === w._id}
                                  onClick={() => handleCancelWithdrawal(w._id)}
                                  className="text-xs text-rose-300 hover:text-white border-rose-800/60 hover:bg-rose-950/60"
                                >
                                  {cancellingId === w._id ? 'Cancelling...' : 'Cancel Request'}
                                </Button>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            {/* DEPOSITS TABLE */}
            {historySubTab === 'deposits' && (
              <Card className="p-0 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-white/[0.04] text-gray-400 uppercase font-semibold border-b border-white/5">
                      <tr>
                        <th className="px-6 py-3.5">Deposit Reference</th>
                        <th className="px-6 py-3.5">Date</th>
                        <th className="px-6 py-3.5">Amount</th>
                        <th className="px-6 py-3.5">Provider</th>
                        <th className="px-6 py-3.5">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {deposits.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                            No deposits recorded yet.
                          </td>
                        </tr>
                      ) : (
                        deposits.map((d) => (
                          <tr key={d._id} className="hover:bg-white/[0.02] transition-colors">
                            <td className="px-6 py-4 font-mono font-bold text-purple-300">
                              {d.depositReference}
                            </td>
                            <td className="px-6 py-4 text-gray-400">
                              {formatDate(d.createdAt)}
                            </td>
                            <td className="px-6 py-4 font-bold text-emerald-400">
                              +{formatINR(d.amount)}
                            </td>
                            <td className="px-6 py-4 text-gray-300 uppercase font-semibold text-[11px]">
                              {d.provider}{' '}
                              {d.isTest && (
                                <span className="ml-1 text-[10px] text-purple-400 font-normal">
                                  (Test Simulation)
                                </span>
                              )}
                            </td>
                            <td className="px-6 py-4">
                              <StatusBadge status={d.status} />
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            {/* TRANSACTION LEDGER TABLE */}
            {historySubTab === 'transactions' && (
              <Card className="p-0 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-white/[0.04] text-gray-400 uppercase font-semibold border-b border-white/5">
                      <tr>
                        <th className="px-6 py-3.5">Reference</th>
                        <th className="px-6 py-3.5">Description</th>
                        <th className="px-6 py-3.5">Date</th>
                        <th className="px-6 py-3.5">Amount</th>
                        <th className="px-6 py-3.5">Balance After</th>
                        <th className="px-6 py-3.5">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {transactions.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-6 py-8 text-center text-gray-500">
                            No transactions recorded yet.
                          </td>
                        </tr>
                      ) : (
                        transactions.map((tx) => (
                          <tr key={tx._id} className="hover:bg-white/[0.02] transition-colors">
                            <td className="px-6 py-4 font-mono font-bold text-purple-300">
                              {tx.reference || 'N/A'}
                            </td>
                            <td className="px-6 py-4 text-white font-medium">
                              {tx.description}
                            </td>
                            <td className="px-6 py-4 text-gray-400">
                              {formatDate(tx.createdAt)}
                            </td>
                            <td className={`px-6 py-4 font-bold ${tx.type === 'credit' ? 'text-emerald-400' : 'text-gray-300'}`}>
                              {tx.type === 'credit' ? '+' : '-'} {formatINR(tx.amount)}
                            </td>
                            <td className="px-6 py-4 font-mono text-gray-300">
                              {formatINR(tx.balanceAfter)}
                            </td>
                            <td className="px-6 py-4">
                              <StatusBadge status={tx.status} />
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </div>
        )}
      </Container>
    </div>
  );
}

export default WalletPage;
