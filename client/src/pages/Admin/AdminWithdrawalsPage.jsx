import { useState, useEffect, useCallback } from 'react';
import { walletService } from '../../services';
import { Container, Button, Card, SectionHeader } from '../../components/common';
import { useAuth } from '../../context';

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
function StatusBadge({ status, isQuarantined }) {
  if (isQuarantined) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold border bg-amber-950/80 text-amber-300 border-amber-600/70 shadow-sm shadow-amber-900/40">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
        QUARANTINED
      </span>
    );
  }

  const s = String(status || '').toUpperCase();
  let colorClasses = 'bg-gray-800 text-gray-300 border-gray-700';

  if (s === 'COMPLETED') {
    colorClasses = 'bg-emerald-950/70 text-emerald-300 border-emerald-800/60';
  } else if (s === 'PENDING') {
    colorClasses = 'bg-amber-950/70 text-amber-300 border-amber-800/60 animate-pulse';
  } else if (s === 'APPROVED') {
    colorClasses = 'bg-blue-950/70 text-blue-300 border-blue-800/60';
  } else if (s === 'PROCESSING') {
    colorClasses = 'bg-purple-950/70 text-purple-300 border-purple-800/60';
  } else if (s === 'REJECTED' || s === 'FAILED') {
    colorClasses = 'bg-rose-950/70 text-rose-300 border-rose-800/60';
  } else if (s === 'CANCELLED') {
    colorClasses = 'bg-zinc-900 text-zinc-400 border-zinc-800';
  }

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${colorClasses}`}>
      {s}
    </span>
  );
}

export function AdminWithdrawalsPage() {
  const { user } = useAuth();

  const [withdrawals, setWithdrawals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [feedback, setFeedback] = useState(null);

  // Rejection modal state
  const [rejectingItem, setRejectingItem] = useState(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  // Quarantine Resolution modal state
  const [resolvingItem, setResolvingItem] = useState(null);
  const [resolutionDecision, setResolutionDecision] = useState('');
  const [resolutionReason, setResolutionReason] = useState('');
  const [secondReviewerId, setSecondReviewerId] = useState('');
  const [resolutionConfirmed, setResolutionConfirmed] = useState(false);

  // Details modal state
  const [inspectItem, setInspectItem] = useState(null);
  const [inspectLoading, setInspectLoading] = useState(false);
  const [inspectDetails, setInspectDetails] = useState(null);

  const fetchWithdrawals = useCallback(async () => {
    setLoading(true);
    try {
      if (statusFilter === 'QUARANTINED') {
        const res = await walletService.getQuarantinedWithdrawalsAdmin({
          page,
          limit: 30,
        });

        if (res.success) {
          setWithdrawals(res.withdrawals || []);
          setTotal(res.total || 0);
          setPages(res.pages || 1);
        }
      } else {
        const res = await walletService.getAllWithdrawalsAdmin({
          status: statusFilter === 'ALL' ? undefined : statusFilter,
          page,
          limit: 30,
        });

        if (res.success) {
          setWithdrawals(res.withdrawals || []);
          setTotal(res.total || 0);
          setPages(res.pages || 1);
        }
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err.response?.data?.message || err.message || 'Failed to load withdrawal requests',
      });
    } finally {
      setLoading(false);
    }
  }, [statusFilter, page]);

  useEffect(() => {
    let isMounted = true;
    Promise.resolve().then(() => {
      if (isMounted) {
        fetchWithdrawals();
      }
    });
    return () => {
      isMounted = false;
    };
  }, [fetchWithdrawals]);

  // Handle Approve
  const handleApprove = async (id) => {
    if (!window.confirm('Approve this withdrawal request? (Development workflow only - real payout disabled)')) {
      return;
    }

    setActionLoading(true);
    setFeedback(null);
    try {
      const res = await walletService.approveWithdrawalAdmin(id);
      if (res.success) {
        setFeedback({
          type: 'success',
          message: 'Withdrawal approved successfully.',
        });
        await fetchWithdrawals();
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err.response?.data?.message || err.message || 'Failed to approve withdrawal',
      });
    } finally {
      setActionLoading(false);
    }
  };

  // Handle Reject Submit
  const handleRejectSubmit = async (e) => {
    e.preventDefault();
    if (!rejectingItem || !rejectionReason.trim()) return;

    setActionLoading(true);
    setFeedback(null);
    try {
      const res = await walletService.rejectWithdrawalAdmin(rejectingItem._id, rejectionReason.trim());
      if (res.success) {
        setFeedback({
          type: 'success',
          message: 'Withdrawal rejected. Reserved balance has been refunded to the user wallet.',
        });
        setRejectingItem(null);
        setRejectionReason('');
        await fetchWithdrawals();
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err.response?.data?.message || err.message || 'Failed to reject withdrawal',
      });
    } finally {
      setActionLoading(false);
    }
  };

  // Handle Status Advance (Processing, Completed, Failed)
  const handleUpdateStatus = async (id, targetStatus) => {
    const confirmMsg =
      targetStatus === 'FAILED'
        ? 'Mark withdrawal as FAILED? This will refund the reserved balance to the user.'
        : `Update withdrawal status to ${targetStatus}?`;

    if (!window.confirm(confirmMsg)) return;

    setActionLoading(true);
    setFeedback(null);
    try {
      const res = await walletService.updateWithdrawalStatusAdmin(id, {
        status: targetStatus,
        adminNotes: `Status advanced to ${targetStatus} via Admin Console (Dev Test)`,
      });
      if (res.success) {
        setFeedback({
          type: 'success',
          message: `Status updated to ${targetStatus}.`,
        });
        await fetchWithdrawals();
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err.response?.data?.message || err.message || 'Failed to update status',
      });
    } finally {
      setActionLoading(false);
    }
  };

  // Inspect details & transactions
  const handleInspect = async (id) => {
    setInspectItem(id);
    setInspectLoading(true);
    try {
      const res = await walletService.getWithdrawalByIdAdmin(id);
      if (res.success) {
        setInspectDetails(res.data);
      }
    } catch {
      setFeedback({
        type: 'error',
        message: 'Failed to inspect withdrawal details',
      });
      setInspectItem(null);
    } finally {
      setInspectLoading(false);
    }
  };

  // Open Quarantine Resolution Modal
  const handleOpenResolveModal = (item) => {
    setResolvingItem(item);
    setResolutionDecision('');
    setResolutionReason('');
    setSecondReviewerId('');
    setResolutionConfirmed(false);
  };

  // Close Quarantine Resolution Modal
  const handleCloseResolveModal = () => {
    if (actionLoading) return;
    setResolvingItem(null);
    setResolutionDecision('');
    setResolutionReason('');
    setSecondReviewerId('');
    setResolutionConfirmed(false);
  };

  // Handle Quarantine Resolution Submit
  const handleResolveSubmit = async (e) => {
    e.preventDefault();
    if (!resolvingItem || !resolutionDecision) return;

    const trimmedReason = resolutionReason.trim();
    if (trimmedReason.length < 10) {
      setFeedback({
        type: 'error',
        message: 'A justification reason of at least 10 characters is required for financial audit compliance.',
      });
      return;
    }

    const DUAL_REVIEW_THRESHOLD = 10000;
    if (resolvingItem.amount >= DUAL_REVIEW_THRESHOLD) {
      if (!secondReviewerId.trim()) {
        setFeedback({
          type: 'error',
          message: `Dual authorization required: Please provide a second administrator ID for amounts >= ${formatINR(DUAL_REVIEW_THRESHOLD)}.`,
        });
        return;
      }
      if (user?._id && String(secondReviewerId.trim()) === String(user._id)) {
        setFeedback({
          type: 'error',
          message: 'Dual authorization violation: Second reviewer must be a different administrator from the current logged-in admin.',
        });
        return;
      }
    }

    if (!resolutionConfirmed) {
      setFeedback({
        type: 'error',
        message: 'Please acknowledge and check the confirmation box before submitting.',
      });
      return;
    }

    setActionLoading(true);
    setFeedback(null);

    try {
      const payload = {
        decision: resolutionDecision,
        reason: trimmedReason,
      };

      if (resolvingItem.amount >= DUAL_REVIEW_THRESHOLD && secondReviewerId.trim()) {
        payload.secondReviewerId = secondReviewerId.trim();
      }

      const res = await walletService.resolveQuarantinedWithdrawalAdmin(resolvingItem._id, payload);

      if (res.success) {
        setFeedback({
          type: 'success',
          message: res.message || `Quarantined withdrawal resolved successfully via ${resolutionDecision}.`,
        });
        handleCloseResolveModal();
        await fetchWithdrawals();
      }
    } catch (err) {
      // SAFE OUTCOME HANDLING:
      // On timeout, network failure, or unknown response:
      // Never optimistically alter wallet balances in the frontend.
      // Do not automatically retry a financially consequential resolution.
      // Always fetch current authoritative server state before allowing another action.
      const errMsg = err.response?.data?.message || err.message || 'Quarantine resolution request failed or timed out.';
      setFeedback({
        type: 'error',
        message: `${errMsg} Fetching authoritative server state to verify current record status...`,
      });

      // Always re-sync with authoritative server state
      await fetchWithdrawals();
    } finally {
      setActionLoading(false);
    }
  };

  const isDualReviewRequired = resolvingItem && resolvingItem.amount >= 10000;

  return (
    <div className="min-h-screen bg-[#07050d] text-white pt-24 pb-20">
      <Container>
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <SectionHeader
              title="Admin Withdrawal Review & Quarantine"
              subtitle={`Review user withdrawal requests, inspect ledger reservations, and resolve quarantined operations (${total} total records).`}
              align="left"
              className="mb-0"
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-bold flex items-center gap-1.5">
              <span>⚠</span>
              <span>Dev Review Only — Real Payouts Disabled</span>
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

        {/* Status Filters & Quarantined Tab */}
        <div className="flex items-center gap-2 border-b border-white/10 pb-4 mb-6 overflow-x-auto">
          {['ALL', 'QUARANTINED', 'PENDING', 'APPROVED', 'PROCESSING', 'COMPLETED', 'REJECTED', 'CANCELLED', 'FAILED'].map((st) => {
            const isQuarantinedTab = st === 'QUARANTINED';
            const isActive = statusFilter === st;

            let buttonClass = 'bg-white/5 text-gray-400 hover:text-white hover:bg-white/10';

            if (isActive) {
              if (isQuarantinedTab) {
                buttonClass = 'bg-amber-600 text-white shadow-sm shadow-amber-600/40 border-amber-500 font-bold';
              } else {
                buttonClass = 'bg-[#7A56D6] text-white shadow-sm shadow-[#7A56D6]/40 font-bold';
              }
            } else if (isQuarantinedTab) {
              buttonClass = 'bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 border border-amber-500/30 font-semibold';
            }

            return (
              <button
                key={st}
                type="button"
                id={`filter-tab-${st.toLowerCase()}`}
                onClick={() => {
                  setStatusFilter(st);
                  setPage(1);
                }}
                className={`px-3.5 py-1.5 rounded-xl text-xs transition-all whitespace-nowrap flex items-center gap-1.5 ${buttonClass}`}
              >
                {isQuarantinedTab && (
                  <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-white' : 'bg-amber-400'} animate-pulse`} />
                )}
                {st}
              </button>
            );
          })}
        </div>

        {/* Requests Table */}
        <Card className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-white/[0.04] text-gray-400 uppercase font-semibold border-b border-white/5">
                <tr>
                  <th className="px-6 py-4">Reference</th>
                  <th className="px-6 py-4">User</th>
                  <th className="px-6 py-4">Amount</th>
                  <th className="px-6 py-4">Payout Destination</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4">
                    {statusFilter === 'QUARANTINED' ? 'Quarantined At' : 'Requested At'}
                  </th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-gray-400">
                      Loading withdrawal requests...
                    </td>
                  </tr>
                ) : withdrawals.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
                      {statusFilter === 'QUARANTINED'
                        ? 'No quarantined withdrawal requests found. Financial ledger integrity is intact.'
                        : `No withdrawal requests found matching filter "${statusFilter}".`}
                    </td>
                  </tr>
                ) : (
                  withdrawals.map((w) => {
                    const isQuarantinedRow =
                      statusFilter === 'QUARANTINED' ||
                      w.metadata?.reconciliationRequiresManualReview === true ||
                      Boolean(w.reconciliationReason);

                    const reasonText = w.reconciliationReason || w.metadata?.reconciliationReason;

                    return (
                      <tr key={w._id} className="hover:bg-white/[0.02] transition-colors">
                        <td className="px-6 py-4 font-mono font-bold text-purple-300">
                          {w.withdrawalReference}
                        </td>
                        <td className="px-6 py-4">
                          <div className="font-semibold text-white">
                            {w.user?.name || 'User'}
                          </div>
                          <div className="text-[11px] text-gray-400">
                            {w.user?.email || 'N/A'}
                          </div>
                        </td>
                        <td className="px-6 py-4 font-bold text-emerald-400 text-sm">
                          {formatINR(w.amount)}
                        </td>
                        <td className="px-6 py-4">
                          <div className="uppercase font-semibold text-gray-300">
                            {w.payoutMethod || 'UPI'}
                          </div>
                          {/* Masked destination: never exposes raw account or secrets */}
                          <div className="font-mono text-[11px] text-gray-400">
                            {w.maskedIdentifier || w.payoutDetails?.maskedIdentifier || '******'}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <StatusBadge status={w.status} isQuarantined={isQuarantinedRow} />
                          {isQuarantinedRow && reasonText && (
                            <div
                              className="mt-1.5 p-2 rounded-lg bg-amber-950/60 border border-amber-800/60 text-[10px] text-amber-200 max-w-xs break-words"
                              title={reasonText}
                            >
                              <span className="font-semibold text-amber-400 block mb-0.5">
                                ⚠ Diagnostic Reason:
                              </span>
                              {reasonText}
                            </div>
                          )}
                          {!isQuarantinedRow && w.rejectionReason && (
                            <div className="text-[10px] text-rose-400 mt-1 max-w-xs truncate" title={w.rejectionReason}>
                              Reason: {w.rejectionReason}
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4 text-gray-400">
                          {formatDate(w.quarantinedAt || w.createdAt)}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => handleInspect(w._id)}
                              className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 text-[11px] font-semibold"
                            >
                              Audit
                            </button>

                            {/* QUARANTINED ACTION */}
                            {isQuarantinedRow ? (
                              <button
                                type="button"
                                disabled={actionLoading}
                                onClick={() => handleOpenResolveModal(w)}
                                className="px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-bold shadow-sm shadow-amber-900/40 flex items-center gap-1"
                              >
                                <span>⚙</span>
                                <span>Resolve Quarantine</span>
                              </button>
                            ) : (
                              <>
                                {/* PENDING ACTIONS */}
                                {w.status === 'PENDING' && (
                                  <>
                                    <button
                                      type="button"
                                      disabled={actionLoading}
                                      onClick={() => handleApprove(w._id)}
                                      className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold"
                                    >
                                      Approve
                                    </button>
                                    <button
                                      type="button"
                                      disabled={actionLoading}
                                      onClick={() => {
                                        setRejectingItem(w);
                                        setRejectionReason('');
                                      }}
                                      className="px-2.5 py-1 rounded-lg bg-rose-600/80 hover:bg-rose-600 text-white text-[11px] font-bold"
                                    >
                                      Reject
                                    </button>
                                  </>
                                )}

                                {/* APPROVED ACTIONS */}
                                {w.status === 'APPROVED' && (
                                  <>
                                    <button
                                      type="button"
                                      disabled={actionLoading}
                                      onClick={() => handleUpdateStatus(w._id, 'PROCESSING')}
                                      className="px-2.5 py-1 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-[11px] font-bold"
                                    >
                                      Process
                                    </button>
                                    <button
                                      type="button"
                                      disabled={actionLoading}
                                      onClick={() => {
                                        setRejectingItem(w);
                                        setRejectionReason('');
                                      }}
                                      className="px-2.5 py-1 rounded-lg bg-rose-600/80 hover:bg-rose-600 text-white text-[11px] font-bold"
                                    >
                                      Reject
                                    </button>
                                  </>
                                )}

                                {/* PROCESSING ACTIONS */}
                                {w.status === 'PROCESSING' && (
                                  <>
                                    <button
                                      type="button"
                                      disabled={actionLoading}
                                      onClick={() => handleUpdateStatus(w._id, 'COMPLETED')}
                                      className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold"
                                    >
                                      Mark Paid (Test)
                                    </button>
                                    <button
                                      type="button"
                                      disabled={actionLoading}
                                      onClick={() => handleUpdateStatus(w._id, 'FAILED')}
                                      className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-bold"
                                    >
                                      Mark Fail & Refund
                                    </button>
                                  </>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          {pages > 1 && (
            <div className="px-6 py-4 border-t border-white/5 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-gray-400">
              <div>
                Showing page <span className="font-bold text-white">{page}</span> of{' '}
                <span className="font-bold text-white">{pages}</span> ({total} total requests)
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold transition-colors"
                >
                  Previous
                </button>
                <span className="px-2 font-mono text-purple-300">
                  {page} / {pages}
                </span>
                <button
                  type="button"
                  disabled={page >= pages || loading}
                  onClick={() => setPage((p) => Math.min(pages, p + 1))}
                  className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </Card>

        {/* CONTROLLED QUARANTINE RESOLUTION MODAL */}
        {resolvingItem && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <Card className="max-w-2xl w-full p-6 border-amber-600/70 bg-[#0d091a] max-h-[90vh] overflow-y-auto shadow-2xl shadow-amber-950/60">
              <div className="flex items-center justify-between pb-4 border-b border-white/10">
                <div className="flex items-center gap-2">
                  <span className="p-2 rounded-xl bg-amber-500/20 text-amber-400 text-lg">⚙</span>
                  <div>
                    <h4 className="text-lg font-bold text-white">Manual Financial Quarantine Resolution</h4>
                    <p className="text-xs text-amber-300/80">Authorized administrative reconciliation dialog</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleCloseResolveModal}
                  disabled={actionLoading}
                  className="text-gray-400 hover:text-white text-2xl font-bold px-2 disabled:opacity-40"
                >
                  ×
                </button>
              </div>

              {/* Financial Operation Context Summary */}
              <div className="mt-4 p-4 rounded-xl bg-white/[0.03] border border-white/10 grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                <div>
                  <div className="text-gray-400">Reference</div>
                  <div className="font-mono font-bold text-purple-300 truncate">
                    {resolvingItem.withdrawalReference}
                  </div>
                </div>
                <div>
                  <div className="text-gray-400">Refund Amount</div>
                  <div className="font-bold text-emerald-400 text-sm">
                    {formatINR(resolvingItem.amount)}
                  </div>
                </div>
                <div>
                  <div className="text-gray-400">User</div>
                  <div className="font-semibold text-white truncate">
                    {resolvingItem.user?.name || 'User'}
                  </div>
                  <div className="text-[10px] text-gray-400 truncate">
                    {resolvingItem.user?.email || 'N/A'}
                  </div>
                </div>
                <div>
                  <div className="text-gray-400">Quarantined At</div>
                  <div className="text-gray-300">
                    {formatDate(resolvingItem.quarantinedAt || resolvingItem.createdAt)}
                  </div>
                </div>
              </div>

              {/* Warning Notice */}
              <div className="mt-4 p-3.5 rounded-xl bg-amber-950/40 border border-amber-600/50 text-xs text-amber-200 leading-relaxed">
                <div className="font-bold flex items-center gap-1.5 text-amber-300 mb-1">
                  <span>⚠</span>
                  <span>Manual Financial Review In Progress</span>
                </div>
                <p>
                  This operation was quarantined due to ledger balance indeterminacy or crash recovery.
                  Resolutions directly alter or seal the immutable financial ledger and create a permanent, tamper-evident AuditLog record.
                </p>
                {resolvingItem.reconciliationReason && (
                  <div className="mt-2 p-2 rounded-lg bg-black/50 border border-amber-700/40 font-mono text-[11px] text-amber-300 break-words">
                    <strong>Diagnostic Trigger:</strong> {resolvingItem.reconciliationReason}
                  </div>
                )}
              </div>

              {/* Resolution Form */}
              <form onSubmit={handleResolveSubmit} className="mt-5 space-y-5">
                {/* Decision Options */}
                <div>
                  <label className="block text-xs font-bold text-gray-300 uppercase tracking-wider mb-2.5">
                    Select Backend Resolution Decision <span className="text-rose-400">*</span>
                  </label>
                  <div className="space-y-2.5">
                    {/* Option 1: CONFIRM_CREDIT_AND_SEAL */}
                    <label
                      className={`block p-3.5 rounded-xl border cursor-pointer transition-all ${
                        resolutionDecision === 'CONFIRM_CREDIT_AND_SEAL'
                          ? 'bg-purple-950/50 border-purple-500 shadow-sm shadow-purple-900/30'
                          : 'bg-white/[0.02] border-white/10 hover:bg-white/[0.04]'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <input
                          type="radio"
                          name="resolutionDecision"
                          value="CONFIRM_CREDIT_AND_SEAL"
                          checked={resolutionDecision === 'CONFIRM_CREDIT_AND_SEAL'}
                          onChange={(e) => setResolutionDecision(e.target.value)}
                          className="mt-1 text-purple-600 focus:ring-purple-500"
                        />
                        <div>
                          <div className="font-bold text-xs text-white flex items-center gap-2">
                            <span>CONFIRM_CREDIT_AND_SEAL</span>
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 font-normal">
                              Credit Already Applied
                            </span>
                          </div>
                          <p className="text-[11px] text-gray-400 mt-1 leading-normal">
                            Verifies that the user wallet was already credited for this refund, reconstructs the missing transaction ledger record, and seals the quarantine without duplicate crediting.
                          </p>
                        </div>
                      </div>
                    </label>

                    {/* Option 2: APPLY_MISSING_CREDIT */}
                    <label
                      className={`block p-3.5 rounded-xl border cursor-pointer transition-all ${
                        resolutionDecision === 'APPLY_MISSING_CREDIT'
                          ? 'bg-emerald-950/50 border-emerald-500 shadow-sm shadow-emerald-900/30'
                          : 'bg-white/[0.02] border-white/10 hover:bg-white/[0.04]'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <input
                          type="radio"
                          name="resolutionDecision"
                          value="APPLY_MISSING_CREDIT"
                          checked={resolutionDecision === 'APPLY_MISSING_CREDIT'}
                          onChange={(e) => setResolutionDecision(e.target.value)}
                          className="mt-1 text-emerald-600 focus:ring-emerald-500"
                        />
                        <div>
                          <div className="font-bold text-xs text-white flex items-center gap-2">
                            <span>APPLY_MISSING_CREDIT</span>
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-normal">
                              Increment Balance & Log
                            </span>
                          </div>
                          <p className="text-[11px] text-gray-400 mt-1 leading-normal">
                            Atomically credits {formatINR(resolvingItem.amount)} to the user wallet with idempotency tracking, creates the corresponding transaction ledger entry, and seals quarantine.
                          </p>
                        </div>
                      </div>
                    </label>

                    {/* Option 3: REJECT_REFUND */}
                    <label
                      className={`block p-3.5 rounded-xl border cursor-pointer transition-all ${
                        resolutionDecision === 'REJECT_REFUND'
                          ? 'bg-rose-950/50 border-rose-500 shadow-sm shadow-rose-900/30'
                          : 'bg-white/[0.02] border-white/10 hover:bg-white/[0.04]'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <input
                          type="radio"
                          name="resolutionDecision"
                          value="REJECT_REFUND"
                          checked={resolutionDecision === 'REJECT_REFUND'}
                          onChange={(e) => setResolutionDecision(e.target.value)}
                          className="mt-1 text-rose-600 focus:ring-rose-500"
                        />
                        <div>
                          <div className="font-bold text-xs text-white flex items-center gap-2">
                            <span>REJECT_REFUND</span>
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 font-normal">
                              No Credit Applied
                            </span>
                          </div>
                          <p className="text-[11px] text-gray-400 mt-1 leading-normal">
                            Permanently rejects the refund request without crediting the wallet. Sets status to REJECTED, removes quarantine flags, and records justification in audit logs.
                          </p>
                        </div>
                      </div>
                    </label>
                  </div>
                </div>

                {/* Justification Reason */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-bold text-gray-300 uppercase tracking-wider">
                      Audit Justification Reason <span className="text-rose-400">*</span>
                    </label>
                    <span
                      className={`text-[11px] ${
                        resolutionReason.trim().length >= 10 ? 'text-emerald-400' : 'text-amber-400'
                      }`}
                    >
                      {resolutionReason.trim().length} / 10 min characters
                    </span>
                  </div>
                  <textarea
                    rows={3}
                    value={resolutionReason}
                    onChange={(e) => setResolutionReason(e.target.value)}
                    placeholder="Describe findings from ledger audit and reason for this resolution decision (min 10 characters)..."
                    required
                    className="w-full px-3.5 py-2.5 rounded-xl bg-black/60 border border-white/10 text-white text-xs focus:outline-none focus:border-amber-500 leading-relaxed placeholder:text-gray-600"
                  />
                </div>

                {/* Dual Reviewer ID (Mandatory for amounts >= 10,000 INR) */}
                {isDualReviewRequired && (
                  <div className="p-3.5 rounded-xl bg-purple-950/40 border border-purple-600/50 space-y-2">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-purple-300">
                      <span>👥</span>
                      <span>Dual Reviewer Authorization Required (≥ ₹10,000)</span>
                    </div>
                    <p className="text-[11px] text-gray-400 leading-normal">
                      Financial safety policy mandates independent secondary approval for consequential amounts.
                      Provide the user ID of a distinct secondary administrator.
                    </p>
                    <div>
                      <input
                        type="text"
                        value={secondReviewerId}
                        onChange={(e) => setSecondReviewerId(e.target.value)}
                        placeholder="Second Reviewer Admin ID (MongoDB ObjectId)"
                        required
                        className="w-full px-3.5 py-2 rounded-lg bg-black/60 border border-white/10 text-white text-xs focus:outline-none focus:border-purple-500"
                      />
                      {user?._id && secondReviewerId.trim() === String(user._id) && (
                        <p className="text-[10px] text-rose-400 mt-1">
                          ⚠ Second reviewer cannot be identical to the current logged-in administrator ({user._id}).
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* Confirmation Checkbox */}
                <div className="p-3 rounded-xl bg-black/40 border border-white/10">
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      id="resolutionConfirmation"
                      checked={resolutionConfirmed}
                      onChange={(e) => setResolutionConfirmed(e.target.checked)}
                      className="mt-0.5 rounded text-amber-600 focus:ring-amber-500"
                    />
                    <span className="text-xs text-gray-300 leading-relaxed select-none">
                      I confirm that I have reviewed the ledger state and authorize this resolution for{' '}
                      <strong className="text-emerald-400">{formatINR(resolvingItem.amount)}</strong> under reference{' '}
                      <span className="font-mono text-purple-300">{resolvingItem.withdrawalReference}</span>.
                      I understand this action is final and permanently logged.
                    </span>
                  </label>
                </div>

                {/* Modal Actions */}
                <div className="flex items-center gap-3 pt-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    onClick={handleCloseResolveModal}
                    disabled={actionLoading}
                    className="flex-1 text-xs"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    disabled={
                      actionLoading ||
                      !resolutionDecision ||
                      resolutionReason.trim().length < 10 ||
                      (isDualReviewRequired && !secondReviewerId.trim()) ||
                      (isDualReviewRequired && user?._id && secondReviewerId.trim() === String(user._id)) ||
                      !resolutionConfirmed
                    }
                    className="flex-1 text-xs font-bold bg-amber-600 hover:bg-amber-500 border-amber-600 text-white shadow-lg shadow-amber-950/60"
                  >
                    {actionLoading ? 'Executing Resolution...' : 'Authorize & Resolve'}
                  </Button>
                </div>
              </form>
            </Card>
          </div>
        )}

        {/* REJECTION REASON MODAL */}
        {rejectingItem && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <Card className="max-w-md w-full p-6 border-rose-800/80 bg-[#0d091a]">
              <h4 className="text-lg font-bold text-white mb-2">Reject Withdrawal Request</h4>
              <p className="text-xs text-gray-400 mb-4 leading-relaxed">
                Rejecting this request will <strong>immediately restore {formatINR(rejectingItem.amount)}</strong> to the user's available wallet balance and record a compensating credit transaction in the ledger.
              </p>

              <form onSubmit={handleRejectSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-300 uppercase mb-1.5">
                    Rejection Reason
                  </label>
                  <textarea
                    rows={3}
                    value={rejectionReason}
                    onChange={(e) => setRejectionReason(e.target.value)}
                    placeholder="e.g. Invalid bank details or user requested cancellation"
                    required
                    className="w-full px-3.5 py-2.5 rounded-xl bg-black/60 border border-white/10 text-white text-xs focus:outline-none focus:border-rose-500"
                  />
                </div>

                <div className="flex items-center gap-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setRejectingItem(null)}
                    className="flex-1 text-xs"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    disabled={actionLoading || !rejectionReason.trim()}
                    className="flex-1 text-xs font-bold bg-rose-600 hover:bg-rose-500 border-rose-600"
                  >
                    {actionLoading ? 'Processing Refund...' : 'Confirm Rejection & Refund'}
                  </Button>
                </div>
              </form>
            </Card>
          </div>
        )}

        {/* AUDIT INSPECT MODAL */}
        {inspectItem && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <Card className="max-w-2xl w-full p-6 border-purple-800/80 bg-[#0d091a] max-h-[85vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-lg font-bold text-white">Withdrawal Audit Record</h4>
                <button
                  type="button"
                  onClick={() => {
                    setInspectItem(null);
                    setInspectDetails(null);
                  }}
                  className="text-gray-400 hover:text-white text-xl font-bold"
                >
                  ×
                </button>
              </div>

              {inspectLoading || !inspectDetails ? (
                <div className="py-12 text-center text-gray-400 text-xs">
                  Loading audit logs...
                </div>
              ) : (
                <div className="space-y-6 text-xs">
                  {/* Summary */}
                  <div className="p-4 rounded-xl bg-white/5 border border-white/10 grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <div>
                      <div className="text-gray-400">Reference</div>
                      <div className="font-mono font-bold text-purple-300">
                        {inspectDetails.withdrawal.withdrawalReference}
                      </div>
                    </div>
                    <div>
                      <div className="text-gray-400">Amount</div>
                      <div className="font-bold text-emerald-400">
                        {formatINR(inspectDetails.withdrawal.amount)}
                      </div>
                    </div>
                    <div>
                      <div className="text-gray-400">Status</div>
                      <div>
                        <StatusBadge
                          status={inspectDetails.withdrawal.status}
                          isQuarantined={inspectDetails.withdrawal.metadata?.reconciliationRequiresManualReview === true}
                        />
                      </div>
                    </div>
                    <div>
                      <div className="text-gray-400">Refund Issued</div>
                      <div className="font-bold text-white">
                        {inspectDetails.withdrawal.refundIssued ? 'Yes (Restored)' : 'No'}
                      </div>
                    </div>
                  </div>

                  {/* Related Ledger Transactions */}
                  <div>
                    <h5 className="font-bold text-white mb-2 uppercase text-[11px] tracking-wider text-purple-300">
                      Associated Ledger Transactions
                    </h5>
                    {inspectDetails.transactions.length === 0 ? (
                      <div className="text-gray-500 py-3">No ledger records located.</div>
                    ) : (
                      <div className="divide-y divide-white/5 rounded-xl border border-white/10 overflow-hidden bg-black/40">
                        {inspectDetails.transactions.map((tx) => (
                          <div key={tx._id} className="p-3 flex items-center justify-between">
                            <div>
                              <div className="font-semibold text-white">{tx.description}</div>
                              <div className="text-[10px] text-gray-400">
                                Ref: {tx.reference} • {formatDate(tx.createdAt)}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className={`font-bold ${tx.type === 'credit' ? 'text-emerald-400' : 'text-gray-200'}`}>
                                {tx.type === 'credit' ? '+' : '-'} {formatINR(tx.amount)}
                              </div>
                              <div className="text-[10px] text-gray-400">
                                Before: {formatINR(tx.balanceBefore)} → After: {formatINR(tx.balanceAfter)}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex justify-end pt-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setInspectItem(null);
                        setInspectDetails(null);
                      }}
                      className="text-xs"
                    >
                      Close Audit Window
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          </div>
        )}
      </Container>
    </div>
  );
}

export default AdminWithdrawalsPage;
