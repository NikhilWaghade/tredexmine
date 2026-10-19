import { Button, Card } from '../../components/common';

export function PlanCard({
  plan,
  isAuthenticated,
  onPurchase,
  onViewDetails,
}) {
  const priceFormatted = Number(plan.price).toLocaleString('en-IN');
  const dailyRoiPercent = plan.dailyRoiRate ? (plan.dailyRoiRate * 100).toFixed(2) : null;

  return (
    <Card
      className="flex flex-col justify-between h-full bg-white/[0.03] border-purple-900/30 hover:border-[#7A56D6]/60 transition-all duration-300 group relative"
      hoverEffect={true}
    >
      {/* Top Header: Tag & Name */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-3">
          {plan.tag ? (
            <span className="px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider text-purple-300 bg-[#7A56D6]/20 border border-[#7A56D6]/40">
              {plan.tag}
            </span>
          ) : (
            <span className="px-3 py-1 rounded-full text-[11px] font-semibold uppercase tracking-wider text-gray-400 bg-white/5 border border-white/10">
              Cloud Hash
            </span>
          )}

          {plan.hashRate && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-purple-950/50 border border-purple-800/40 text-purple-300 text-xs font-semibold">
              <svg className="w-3.5 h-3.5 text-[#7A56D6]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <span>{plan.hashRate}</span>
            </div>
          )}
        </div>

        <h3 className="text-xl sm:text-2xl font-bold text-white tracking-tight group-hover:text-purple-200 transition-colors">
          {plan.name}
        </h3>

        <p className="text-sm text-gray-400 mt-2 line-clamp-2 min-h-[40px] leading-relaxed">
          {plan.description || 'Enterprise cloud mining cluster with dedicated hash capacity and automatic yields.'}
        </p>

        {/* Price & Duration */}
        <div className="mt-6 pt-5 border-t border-white/10 flex items-baseline justify-between">
          <div>
            <span className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
              ₹{priceFormatted}
            </span>
            <span className="text-xs text-gray-400 ml-2 font-medium">
              INR / {plan.durationDays} Days
            </span>
          </div>

          {dailyRoiPercent && (
            <div className="text-right">
              <span className="text-xs font-semibold text-emerald-400 block">
                +{dailyRoiPercent}% / day
              </span>
              <span className="text-[10px] text-gray-400">Est. Daily Yield</span>
            </div>
          )}
        </div>

        {/* Feature List */}
        <div className="mt-6 space-y-2.5 pb-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">
            Plan Capabilities
          </p>
          {plan.features && plan.features.length > 0 ? (
            plan.features.map((feature, idx) => (
              <div key={idx} className="flex items-start gap-2.5 text-xs text-gray-300">
                <svg
                  className="w-4 h-4 text-[#7A56D6] flex-shrink-0 mt-0.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
                <span>{feature}</span>
              </div>
            ))
          ) : (
            <>
              <div className="flex items-start gap-2.5 text-xs text-gray-300">
                <svg className="w-4 h-4 text-[#7A56D6] flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
                <span>Tier-4 Isolated Compute Cluster</span>
              </div>
              <div className="flex items-start gap-2.5 text-xs text-gray-300">
                <svg className="w-4 h-4 text-[#7A56D6] flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
                <span>Automated Performance Telemetry</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Card Actions */}
      <div className="pt-4 border-t border-white/10 flex flex-col gap-2.5 mt-auto">
        {isAuthenticated ? (
          <Button
            onClick={() => onPurchase(plan)}
            variant="primary"
            size="md"
            className="w-full"
          >
            <span className="flex items-center justify-center gap-2">
              <svg className="w-4 h-4 text-purple-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Pay with UPI & Activate
            </span>
          </Button>
        ) : (
          <Button
            onClick={() => onPurchase(plan)}
            variant="primary"
            size="md"
            className="w-full"
          >
            Sign In to Purchase
          </Button>
        )}

        <Button
          onClick={() => onViewDetails(plan)}
          variant="ghost"
          size="sm"
          className="w-full text-xs text-gray-400 hover:text-purple-300"
        >
          View Full Specifications →
        </Button>
      </div>
    </Card>
  );
}

export default PlanCard;
