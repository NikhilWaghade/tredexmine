import { useState } from 'react';
import { Card } from '../../components/common';

export function ActivePlansSection({ userPlans = [], isLoading = false, onRefresh }) {
  const [referenceTime] = useState(() => Date.now());
  if (isLoading) {
    return (
      <div className="py-8">
        <div className="flex items-center justify-between mb-6">
          <div className="h-6 w-48 bg-white/5 rounded animate-pulse" />
          <div className="h-8 w-24 bg-white/5 rounded animate-pulse" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2].map((i) => (
            <div key={i} className="h-56 rounded-2xl bg-white/[0.03] border border-white/5 animate-pulse p-6" />
          ))}
        </div>
      </div>
    );
  }

  if (!userPlans || userPlans.length === 0) {
    return (
      <div className="py-8 text-center rounded-2xl bg-white/[0.02] border border-purple-900/30 p-8">
        <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-purple-950/50 border border-purple-800/40 flex items-center justify-center text-purple-400">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
        </div>
        <h4 className="text-base font-semibold text-white mb-1">No Active Mining Subscriptions</h4>
        <p className="text-xs text-gray-400 max-w-sm mx-auto">
          You currently have no running compute nodes. Select an active plan from the catalog below to deploy hash power.
        </p>
      </div>
    );
  }

  return (
    <div className="py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
              My Active Subscriptions
            </h3>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-[#7A56D6]/30 text-purple-200 border border-[#7A56D6]/40">
              {userPlans.length} Running
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-1">
            Real-time active cloud mining nodes linked to your wallet
          </p>
        </div>

        {onRefresh && (
          <button
            onClick={onRefresh}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-gray-300 hover:text-white transition-colors"
            title="Refresh active subscriptions"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span>Sync Telemetry</span>
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {userPlans.map((up) => {
          const endDate = new Date(up.endDate);
          const startDate = new Date(up.startDate);
          const msRemaining = Math.max(0, endDate.getTime() - referenceTime);
          const daysRemaining = Math.ceil(msRemaining / (1000 * 60 * 60 * 24));

          return (
            <Card
              key={up._id}
              className="bg-white/[0.03] border-emerald-900/30 hover:border-emerald-500/40 transition-all p-6 relative flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between gap-2 mb-3">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold text-emerald-300 bg-emerald-950/60 border border-emerald-800/40">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                    Active Node
                  </span>

                  {up.hashRate && (
                    <span className="px-2.5 py-1 rounded-lg bg-purple-950/60 border border-purple-800/40 text-[#7A56D6] text-xs font-bold">
                      {up.hashRate}
                    </span>
                  )}
                </div>

                <h4 className="text-lg font-bold text-white tracking-tight mb-1">
                  {up.planName}
                </h4>

                <div className="flex items-baseline gap-2 mb-4">
                  <span className="text-2xl font-extrabold text-white">
                    ₹{Number(up.price).toLocaleString('en-IN')}
                  </span>
                  <span className="text-xs text-gray-400">
                    ({up.durationDays} Days Duration)
                  </span>
                </div>

                {/* Status Telemetry */}
                <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5 space-y-2 text-xs text-gray-300 mb-4">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Started:</span>
                    <span>{startDate.toLocaleDateString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Expires:</span>
                    <span>{endDate.toLocaleDateString()}</span>
                  </div>
                  <div className="flex justify-between pt-1 border-t border-white/5">
                    <span className="text-gray-400">Remaining:</span>
                    <span className="text-emerald-400 font-semibold">{daysRemaining} Days</span>
                  </div>
                  {up.dailyRoiRate > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-400">Daily ROI:</span>
                      <span className="text-purple-300 font-semibold">
                        +{(up.dailyRoiRate * 100).toFixed(2)}% / day
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div className="pt-3 border-t border-white/10 flex items-center justify-between text-[11px] text-gray-400">
                <span>Cluster Node ID</span>
                <span className="font-mono text-gray-400 text-[10px]">
                  {up._id?.slice(-8).toUpperCase()}
                </span>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

export default ActivePlansSection;
