import { useState, useEffect, useCallback } from 'react';
import { referralService } from '../../services';
import { Container, Button, Card, SectionHeader } from '../../components/common';

// Helper to format currency
const formatINR = (val) => {
  const num = Number(val || 0);
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(num);
};

// Helper to format date
const formatDate = (dateStr) => {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    return d.toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return String(dateStr);
  }
};

export function ReferralsPage() {
  const [summary, setSummary] = useState(null);
  const [history, setHistory] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Copy feedback states
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  // Fetch summary and history data
  const fetchData = useCallback(async (page = 1) => {
    setLoading(true);
    setError(null);
    try {
      const [sumRes, histRes] = await Promise.all([
        referralService.getMyReferrals(),
        referralService.getReferralHistory({ page, limit: 10 }),
      ]);

      if (sumRes.success && sumRes.data) {
        setSummary(sumRes.data);
      }
      if (histRes.success && histRes.data) {
        setHistory(histRes.data.referrals || []);
        if (histRes.data.pagination) {
          setPagination(histRes.data.pagination);
        }
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to load referral details');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    Promise.resolve().then(() => {
      if (isMounted) {
        fetchData(1);
      }
    });
    return () => {
      isMounted = false;
    };
  }, [fetchData]);

  const handleCopyCode = async () => {
    if (!summary?.referralCode) return;
    try {
      await navigator.clipboard.writeText(summary.referralCode);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2500);
    } catch (err) {
      void err;
    }
  };

  const handleCopyLink = async () => {
    const link = summary?.referralLink || `${window.location.origin}/register?ref=${summary?.referralCode || ''}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    } catch (err) {
      void err;
    }
  };

  const handleNativeShare = async () => {
    const link = summary?.referralLink || `${window.location.origin}/register?ref=${summary?.referralCode || ''}`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Join Minetrades Cloud Computing',
          text: `Use my referral code ${summary?.referralCode} to sign up and start mining with high-performance hash power!`,
          url: link,
        });
      } catch (err) {
        void err;
      }
    } else {
      handleCopyLink();
    }
  };

  const handlePageChange = (newPage) => {
    if (newPage >= 1 && newPage <= pagination.totalPages) {
      fetchData(newPage);
    }
  };

  return (
    <div className="min-h-screen py-10 bg-[#070312] text-white">
      <Container>
        {/* Header Section */}
        <div className="mb-8">
          <SectionHeader
            title="Refer & Earn Rewards"
            subtitle="Invite partners and colleagues to Minetrades. When they purchase their first cloud mining plan, you receive ₹300 instantly credited to your wallet balance."
          />
        </div>

        {/* Error Alert */}
        {error && (
          <div className="mb-6 p-4 rounded-2xl bg-rose-950/60 border border-rose-800/60 text-rose-200 text-sm flex items-center justify-between">
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5 text-rose-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{error}</span>
            </div>
            <Button variant="outline" size="sm" onClick={() => fetchData(pagination.page)}>
              Retry
            </Button>
          </div>
        )}

        {/* Hero Banner: How it Works */}
        <div className="mb-8 p-6 sm:p-8 rounded-3xl bg-gradient-to-r from-purple-950/40 via-[#130b2c]/60 to-purple-900/30 border border-purple-800/40 shadow-xl shadow-purple-950/30">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-center md:text-left">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-2xl bg-[#7A56D6]/20 border border-[#7A56D6]/40 flex items-center justify-center text-[#7A56D6] font-bold text-lg flex-shrink-0">
                1
              </div>
              <div>
                <h4 className="font-semibold text-white text-sm sm:text-base">Share Your Code</h4>
                <p className="text-xs text-gray-400 mt-1">
                  Send your personalized link or referral code to your network or community.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-2xl bg-[#7A56D6]/20 border border-[#7A56D6]/40 flex items-center justify-center text-[#7A56D6] font-bold text-lg flex-shrink-0">
                2
              </div>
              <div>
                <h4 className="font-semibold text-white text-sm sm:text-base">Friend Joins & Purchases</h4>
                <p className="text-xs text-gray-400 mt-1">
                  Your referral registers and activates any eligible cloud mining plan.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 font-bold text-lg flex-shrink-0">
                3
              </div>
              <div>
                <h4 className="font-semibold text-white text-sm sm:text-base">Instant ₹300 Reward</h4>
                <p className="text-xs text-gray-400 mt-1">
                  ₹300 is automatically credited to your wallet balance with a verifiable ledger entry.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Referral Code & Share Link Card */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          {/* Code Box */}
          <Card className="p-6 bg-[#0f0920] border-purple-900/40 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                  Your Referral Code
                </span>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#7A56D6]/20 text-purple-300 border border-[#7A56D6]/30">
                  Permanent
                </span>
              </div>
              <div className="p-3.5 rounded-2xl bg-black/40 border border-purple-800/40 flex items-center justify-between mb-4">
                <span className="text-2xl font-black text-white tracking-widest font-mono">
                  {loading ? '••••••••' : summary?.referralCode || 'NOT_ASSIGNED'}
                </span>
                <button
                  onClick={handleCopyCode}
                  className="px-3 py-1.5 rounded-xl bg-[#7A56D6]/30 hover:bg-[#7A56D6]/50 text-xs font-semibold text-purple-200 border border-[#7A56D6]/50 transition-all flex items-center gap-1.5"
                  title="Copy Code"
                >
                  {copiedCode ? (
                    <>
                      <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <span>Copied!</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>
            </div>
            <p className="text-xs text-gray-400">
              Share this code with new users during account registration.
            </p>
          </Card>

          {/* Share Link Box */}
          <Card className="lg:col-span-2 p-6 bg-[#0f0920] border-purple-900/40 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                  Direct Referral Link
                </span>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  Auto-Applied
                </span>
              </div>
              <div className="flex flex-col sm:flex-row items-stretch gap-2 mb-4">
                <input
                  type="text"
                  readOnly
                  value={
                    loading
                      ? 'Generating secure referral link...'
                      : summary?.referralLink || `${window.location.origin}/register?ref=${summary?.referralCode || ''}`
                  }
                  className="flex-1 px-4 py-2.5 rounded-xl bg-black/40 border border-purple-800/40 text-gray-300 text-xs sm:text-sm font-mono truncate focus:outline-none"
                />
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCopyLink}
                    className="flex-1 sm:flex-initial px-4 py-2.5 rounded-xl bg-[#7A56D6] hover:bg-[#6844c2] text-white text-xs font-semibold shadow-sm shadow-[#7A56D6]/40 transition-all flex items-center justify-center gap-1.5"
                  >
                    {copiedLink ? (
                      <>
                        <svg className="w-4 h-4 text-emerald-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        <span>Copied Link</span>
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                        <span>Copy Link</span>
                      </>
                    )}
                  </button>
                  <button
                    onClick={handleNativeShare}
                    className="px-3.5 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 hover:text-white transition-all text-xs font-semibold flex items-center justify-center"
                    title="Share with Apps"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
            <p className="text-xs text-gray-400">
              Users opening this link have your referral code pre-filled automatically on the registration form.
            </p>
          </Card>
        </div>

        {/* 4-Stat Metric Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-8">
          <Card className="p-5 bg-[#0f0920] border-purple-900/30 flex flex-col justify-between">
            <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Total Referrals</span>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl sm:text-3xl font-extrabold text-white">
                {loading ? '—' : summary?.totalReferrals ?? 0}
              </span>
              <span className="text-xs text-purple-300">Registered</span>
            </div>
          </Card>

          <Card className="p-5 bg-[#0f0920] border-purple-900/30 flex flex-col justify-between">
            <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Eligible Referrals</span>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl sm:text-3xl font-extrabold text-emerald-400">
                {loading ? '—' : summary?.eligibleReferrals ?? 0}
              </span>
              <span className="text-xs text-emerald-300/80">Plan Purchased</span>
            </div>
          </Card>

          <Card className="p-5 bg-[#0f0920] border-purple-900/30 flex flex-col justify-between">
            <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Pending Rewards</span>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl sm:text-3xl font-extrabold text-amber-400">
                {loading ? '—' : summary?.pendingRewards ?? 0}
              </span>
              <span className="text-xs text-amber-300/80">Awaiting Plan</span>
            </div>
          </Card>

          <Card className="p-5 bg-[#0f0920] border-emerald-900/30 flex flex-col justify-between shadow-lg shadow-emerald-950/20">
            <span className="text-xs font-medium text-emerald-300/80 uppercase tracking-wider">Total Rewards Earned</span>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl sm:text-3xl font-black text-emerald-400">
                {loading ? '—' : formatINR(summary?.totalRewardsEarned ?? 0)}
              </span>
              <span className="text-xs text-emerald-200/80">Credited</span>
            </div>
          </Card>
        </div>

        {/* Referral History Section */}
        <div className="rounded-2xl bg-[#0f0920] border border-purple-900/40 p-6 sm:p-8">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <div>
              <h3 className="text-lg font-bold text-white tracking-tight">Referral History</h3>
              <p className="text-xs text-gray-400 mt-0.5">
                Privacy-masked overview of members who registered using your referral code.
              </p>
            </div>
            <div className="text-xs text-gray-400">
              Showing {history.length} of {pagination.total} referrals
            </div>
          </div>

          {loading ? (
            <div className="py-16 text-center text-gray-400 flex flex-col items-center justify-center gap-3">
              <svg className="animate-spin w-8 h-8 text-[#7A56D6]" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              <span className="text-sm">Loading referral records...</span>
            </div>
          ) : history.length === 0 ? (
            <div className="py-16 text-center rounded-2xl bg-white/[0.02] border border-white/5 flex flex-col items-center justify-center p-6">
              <div className="w-14 h-14 rounded-2xl bg-[#7A56D6]/10 border border-[#7A56D6]/30 flex items-center justify-center text-[#7A56D6] mb-4">
                <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <h4 className="text-base font-bold text-white mb-1">No Referrals Yet</h4>
              <p className="text-xs text-gray-400 max-w-sm mb-4">
                Share your referral code or link with other traders and cloud miners. When they purchase their first plan, you earn ₹300!
              </p>
              <Button variant="primary" size="sm" onClick={handleCopyLink}>
                {copiedLink ? 'Link Copied!' : 'Copy Referral Link'}
              </Button>
            </div>
          ) : (
            <>
              {/* Desktop Table View */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left text-sm text-gray-300">
                  <thead className="text-xs uppercase bg-white/[0.03] text-gray-400 border-b border-purple-900/30">
                    <tr>
                      <th className="py-3 px-4 font-semibold">User</th>
                      <th className="py-3 px-4 font-semibold">Registered Date</th>
                      <th className="py-3 px-4 font-semibold">Activity Status</th>
                      <th className="py-3 px-4 font-semibold">Reward Status</th>
                      <th className="py-3 px-4 font-semibold">Reward</th>
                      <th className="py-3 px-4 font-semibold">Credited Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04]">
                    {history.map((item) => (
                      <tr key={item.id} className="hover:bg-white/[0.02] transition-colors">
                        <td className="py-3.5 px-4 font-medium text-white flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-purple-900/40 text-purple-200 text-xs flex items-center justify-center font-bold">
                            {item.displayName[0] || 'U'}
                          </div>
                          <span>{item.displayName}</span>
                        </td>
                        <td className="py-3.5 px-4 text-gray-400 text-xs">
                          {formatDate(item.registeredAt)}
                        </td>
                        <td className="py-3.5 px-4">
                          <span
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${
                              item.rewardStatus === 'CREDITED'
                                ? 'bg-emerald-950/70 text-emerald-300 border-emerald-800/60'
                                : 'bg-amber-950/70 text-amber-300 border-amber-800/60'
                            }`}
                          >
                            {item.status}
                          </span>
                        </td>
                        <td className="py-3.5 px-4">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold ${
                              item.rewardStatus === 'CREDITED'
                                ? 'bg-emerald-500/20 text-emerald-300'
                                : 'bg-white/10 text-gray-400'
                            }`}
                          >
                            {item.rewardStatus}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 font-semibold">
                          {item.rewardStatus === 'CREDITED' ? (
                            <span className="text-emerald-400 font-bold">+₹{item.rewardAmount}</span>
                          ) : (
                            <span className="text-gray-500">₹0</span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-gray-400 text-xs">
                          {formatDate(item.creditedAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile Card View */}
              <div className="grid grid-cols-1 gap-3 md:hidden">
                {history.map((item) => (
                  <div
                    key={item.id}
                    className="p-4 rounded-xl bg-white/[0.03] border border-purple-900/30 flex flex-col gap-2.5"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-purple-900/40 text-purple-200 text-xs flex items-center justify-center font-bold">
                          {item.displayName[0] || 'U'}
                        </div>
                        <span className="font-semibold text-white text-sm">{item.displayName}</span>
                      </div>
                      <span
                        className={`text-xs font-bold px-2 py-0.5 rounded ${
                          item.rewardStatus === 'CREDITED'
                            ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/60'
                            : 'bg-amber-950/80 text-amber-300 border border-amber-800/60'
                        }`}
                      >
                        {item.rewardStatus === 'CREDITED' ? '+₹300' : 'PENDING'}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 text-xs gap-2 pt-2 border-t border-white/5 text-gray-400">
                      <div>
                        <span>Registered: </span>
                        <span className="text-gray-200">{formatDate(item.registeredAt)}</span>
                      </div>
                      <div>
                        <span>Credited: </span>
                        <span className="text-gray-200">{formatDate(item.creditedAt)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Pagination Controls */}
              {pagination.totalPages > 1 && (
                <div className="flex items-center justify-between pt-6 border-t border-white/5 mt-4 text-xs text-gray-400">
                  <span>
                    Page {pagination.page} of {pagination.totalPages}
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={pagination.page <= 1}
                      onClick={() => handlePageChange(pagination.page - 1)}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={pagination.page >= pagination.totalPages}
                      onClick={() => handlePageChange(pagination.page + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </Container>
    </div>
  );
}

export default ReferralsPage;
