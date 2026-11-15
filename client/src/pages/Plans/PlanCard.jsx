import { Button, Card } from '../../components/common';
import { calculatePlanMetrics, PLAN_RISK_DISCLOSURE } from '../../utils/planCalculations';

export function PlanCard({
  plan,
  isAuthenticated,
  onPurchase,
  onViewDetails,
}) {
  const metrics = calculatePlanMetrics(plan.price, plan.durationDays || 30);
  const priceFormatted = Number(plan.price).toLocaleString('en-IN');
  const dailyAmountFormatted = Number(metrics.dailyAmount).toLocaleString('en-IN');
  const totalReturnFormatted = Number(metrics.illustrativeTotal).toLocaleString('en-IN');

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
          {plan.description || 'Enterprise cloud compute cluster for essential hashrate and transparent daily yields.'}
        </p>

        {/* Price & Duration */}
        <div className="mt-6 pt-5 border-t border-white/10 flex items-baseline justify-between">
          <div>
            <span className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
              ₹{priceFormatted}
            </span>
            <span className="text-xs text-gray-400 ml-2 font-medium">
              INR / {metrics.durationDays} Days
            </span>
          </div>

          <div className="text-right">
            <span className="text-xs font-bold text-emerald-400 block">
              +{metrics.dailyPercentage}% / day
            </span>
            <span className="text-[11px] font-semibold text-purple-300">
              ₹{dailyAmountFormatted} / day
            </span>
          </div>
        </div>

        {/* Illustrative Return Summary Box */}
        <div className="mt-4 p-3 rounded-xl bg-purple-950/30 border border-purple-800/30 flex items-center justify-between text-xs">
          <span className="text-gray-400">Illustrative 30-Day Return:</span>
          <span className="font-bold text-emerald-400">₹{totalReturnFormatted}</span>
        </div>

        {/* Feature List */}
        <div className="mt-6 space-y-2.5 pb-4">
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

      {/* Card Actions & Legal Risk Disclosure */}
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

        <p className="text-[10px] text-gray-500 text-center leading-tight px-1 pt-1">
          {PLAN_RISK_DISCLOSURE}
        </p>
      </div>
    </Card>
  );
}

export default PlanCard;
