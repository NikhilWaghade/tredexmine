import { useState, useEffect } from 'react';
import { ROUTES } from '../../constants';
import { Container, Button, Card, SectionHeader } from '../../components/common';
import { planService } from '../../services';
import { useAuth } from '../../context';
import { PlanCard } from '../Plans/PlanCard';
import { PlanDetailsModal } from '../Plans/PlanDetailsModal';
import { PurchaseConfirmationModal } from '../Plans/PurchaseConfirmationModal';

export function HomePage() {
  const { isAuthenticated, openAuthModal, wallet, refreshWallet } = useAuth();

  // Plans state
  const [plans, setPlans] = useState([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [plansError, setPlansError] = useState(null);

  // Modal interaction states
  const [selectedPlanForDetails, setSelectedPlanForDetails] = useState(null);
  const [selectedPlanForPurchase, setSelectedPlanForPurchase] = useState(null);

  // FAQ accordion state
  const [openFaq, setOpenFaq] = useState(null);

  useEffect(() => {
    let isMounted = true;
    const fetchActivePlans = async () => {
      try {
        setPlansLoading(true);
        setPlansError(null);
        const res = await planService.getPlans();
        if (isMounted) {
          if (res.success && Array.isArray(res.plans)) {
            setPlans(res.plans);
          } else {
            setPlans([]);
          }
        }
      } catch (err) {
        if (isMounted) {
          console.error('[HomePage] Failed to fetch active plans:', err);
          setPlansError('Unable to load investment plans. Please try again shortly.');
        }
      } finally {
        if (isMounted) {
          setPlansLoading(false);
        }
      }
    };

    fetchActivePlans();
    return () => {
      isMounted = false;
    };
  }, []);

  const handlePurchaseClick = (plan) => {
    if (!isAuthenticated) {
      openAuthModal();
      return;
    }
    setSelectedPlanForPurchase(plan);
  };

  const pillars = [
    {
      title: 'Distributed Compute Clusters',
      description:
        'Clustered high-throughput nodes engineered for resilience, continuous resource balancing, and ultra-low latency compute cycles.',
      icon: (
        <svg className="w-6 h-6 text-[#7A56D6]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
      ),
    },
    {
      title: 'Institutional-Grade Security',
      description:
        'Zero-trust security architecture featuring multi-layered hardware isolation, encrypted telemetry, and automated intrusion prevention.',
      icon: (
        <svg className="w-6 h-6 text-[#7A56D6]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
      ),
    },
    {
      title: 'Dynamic Resource Orchestration',
      description:
        'Automated routing engines continually evaluate hardware health and allocate workloads for optimal power efficiency and uninterrupted uptime.',
      icon: (
        <svg className="w-6 h-6 text-[#7A56D6]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      ),
    },
    {
      title: 'Transparent Infrastructure Metrics',
      description:
        'Auditable cluster telemetry and real-time operational logs ensure clear visibility into computational health and node status.',
      icon: (
        <svg className="w-6 h-6 text-[#7A56D6]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      ),
    },
  ];

  const workflowSteps = [
    {
      step: '01',
      title: 'Infrastructure Deployment',
      description: 'State-of-the-art ASIC & GPU mining hardware provisioned across climate-controlled Tier-4 facilities.',
    },
    {
      step: '02',
      title: 'Algorithmic Optimization',
      description: 'Proprietary orchestrator continuously balances workloads based on computational difficulty and network demands.',
    },
    {
      step: '03',
      title: 'Enterprise Management',
      description: 'Centralized control interfaces with continuous telemetry feedback, alerts, and operational monitoring.',
    },
  ];

  const whyChooseItems = [
    {
      title: 'Zero Hardware Hassle',
      desc: 'No expensive ASIC rigs to purchase, configure, noise-isolate, or maintain. Start mining with one click.',
      icon: '⚙️',
    },
    {
      title: 'Tier-4 Data Centers',
      desc: 'High-density computational clusters hosted in climate-controlled facilities powered by green renewable energy.',
      icon: '🏢',
    },
    {
      title: 'Daily Automated Settlement',
      desc: 'Transparent daily yield settlements credited directly to your authoritative wallet ledger every 24 hours.',
      icon: '⏱️',
    },
    {
      title: 'Bank-Grade AES-256 Security',
      desc: 'Multi-layered isolation, encrypted session tokens, and cryptographic payout protection safeguarding your assets.',
      icon: '🛡️',
    },
    {
      title: 'Instant UPI & Gateway Deposits',
      desc: 'Frictionless deposit and checkout experience with UPI QR codes, Google Pay, PhonePe, and NetBanking.',
      icon: '⚡',
    },
    {
      title: '24/7 Node Telemetry',
      desc: 'Real-time hashrate monitoring, node health metrics, and round-the-clock technical support engineers.',
      icon: '📊',
    },
  ];

  const faqs = [
    {
      q: 'How does Minetrades cloud mining work?',
      a: 'Minetrades operates industrial-scale computational clusters in Tier-4 facilities. When you subscribe to an investment plan, dedicated computational hashrate is reserved for your account, and mining yields are settled on a daily schedule.',
    },
    {
      q: 'What is the contract duration for investment plans?',
      a: 'All standard mining contracts are active for 30 consecutive days. During this period, your node delivers uninterrupted computing power with daily automated settlement.',
    },
    {
      q: 'How is the illustrative daily yield calculated?',
      a: 'Plans reflect a simple, non-compounding illustrative return model of ~3.33% daily over 30 days (100% total over 30 days). For example, a ₹300 Starter plan yields an illustrative ₹10 per day. Note: Actual mining outputs fluctuate with global network difficulty.',
    },
    {
      q: 'How can I withdraw my earnings?',
      a: 'You can submit a withdrawal request anytime from your Wallet dashboard. We support direct transfers to your registered UPI ID (Google Pay, PhonePe, Paytm) or verified Bank Account (IMPS/NEFT) with zero hidden fees.',
    },
    {
      q: 'Is there a minimum withdrawal or deposit limit?',
      a: 'The minimum deposit is ₹100, and the minimum withdrawal is also ₹100. Funds are processed securely with strict balance reservation and cryptographic audit logs.',
    },
    {
      q: 'How does the Refer & Earn program work?',
      a: 'Share your unique referral code with friends. When a referred user signs up and activates their first eligible mining plan, you automatically receive a flat ₹300 referral reward credited directly to your wallet.',
    },
  ];

  return (
    <div className="flex flex-col gap-24 sm:gap-32 py-12 sm:py-20">
      {/* 1. Navigation Bar (Provided by MainLayout) */}

      {/* 2. Hero Section */}
      <section className="relative">
        <Container>
          <div className="flex flex-col items-center text-center max-w-4xl mx-auto">
            {/* Status Pill */}
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-purple-950/60 border border-[#7A56D6]/40 mb-8 backdrop-blur-md">
              <span className="w-2 h-2 rounded-full bg-[#7A56D6] animate-ping" />
              <span className="text-xs sm:text-sm font-medium text-purple-200">
                Next-Generation Cloud Mining Architecture
              </span>
            </div>

            {/* Main Headline */}
            <h1 className="text-4xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight text-white mb-6 leading-[1.1]">
              Scalable Cloud Mining &{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#7A56D6] via-purple-300 to-white">
                Distributed Compute
              </span>
            </h1>

            {/* Subheading */}
            <p className="text-lg sm:text-xl text-gray-300 max-w-2xl mb-10 leading-relaxed font-normal">
              Minetrades provides institutional-grade computing infrastructure designed for
              continuous performance, hardware resilience, and transparent node orchestration.
            </p>

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row items-center gap-4 w-full sm:w-auto">
              <Button to={ROUTES.PLANS} variant="primary" size="lg" className="w-full sm:w-auto shadow-lg shadow-[#7A56D6]/30">
                Explore Investment Plans
              </Button>
              <Button to={ROUTES.ABOUT} variant="outline" size="lg" className="w-full sm:w-auto">
                About Minetrades
              </Button>
            </div>

            {/* Key Platform Specifications */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6 w-full mt-16 pt-12 border-t border-purple-900/30">
              <div className="flex flex-col items-center p-4 rounded-xl bg-white/[0.02] border border-white/5">
                <span className="text-2xl sm:text-3xl font-bold text-white">99.9%</span>
                <span className="text-xs text-gray-400 mt-1 uppercase tracking-wider">Uptime Target</span>
              </div>
              <div className="flex flex-col items-center p-4 rounded-xl bg-white/[0.02] border border-white/5">
                <span className="text-2xl sm:text-3xl font-bold text-purple-300">Tier-4</span>
                <span className="text-xs text-gray-400 mt-1 uppercase tracking-wider">Facility Standards</span>
              </div>
              <div className="flex flex-col items-center p-4 rounded-xl bg-white/[0.02] border border-white/5">
                <span className="text-2xl sm:text-3xl font-bold text-white">256-Bit</span>
                <span className="text-xs text-gray-400 mt-1 uppercase tracking-wider">Telemetry Security</span>
              </div>
              <div className="flex flex-col items-center p-4 rounded-xl bg-white/[0.02] border border-white/5">
                <span className="text-2xl sm:text-3xl font-bold text-purple-300">24/7</span>
                <span className="text-xs text-gray-400 mt-1 uppercase tracking-wider">Active Monitoring</span>
              </div>
            </div>
          </div>
        </Container>
      </section>

      {/* 3. Investment Plans Section (Directly after Hero) */}
      <section id="investment-plans" className="relative scroll-mt-24">
        <Container>
          <div className="text-center max-w-3xl mx-auto mb-12">
            <span className="px-3.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-[#7A56D6]/20 text-purple-300 border border-[#7A56D6]/40 mb-3 inline-block">
              Available Hashrate Tiers
            </span>
            <h2 className="text-3xl sm:text-5xl font-extrabold text-white tracking-tight mb-4">
              Explore Investment Plans
            </h2>
            <p className="text-gray-300 text-sm sm:text-base leading-relaxed">
              Select an optimized computing plan with dedicated hashrate allocation, 30-day contract duration,
              and daily automated settlements.
            </p>
          </div>

          {plansLoading ? (
            <div className="py-16 flex flex-col items-center justify-center gap-4 text-gray-400">
              <svg className="animate-spin w-8 h-8 text-[#7A56D6]" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              <p className="text-sm">Retrieving active plan catalogue...</p>
            </div>
          ) : plansError ? (
            <div className="p-6 rounded-2xl bg-rose-950/40 border border-rose-800/60 text-center max-w-md mx-auto">
              <p className="text-sm text-rose-300 mb-4">{plansError}</p>
              <Button to={ROUTES.PLANS} variant="outline" size="sm">
                View Plans Page
              </Button>
            </div>
          ) : plans.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              No active plans currently configured.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8">
              {plans.map((plan) => (
                <PlanCard
                  key={plan._id}
                  plan={plan}
                  isAuthenticated={isAuthenticated}
                  onPurchase={handlePurchaseClick}
                  onViewDetails={setSelectedPlanForDetails}
                />
              ))}
            </div>
          )}
        </Container>
      </section>

      {/* 4. Platform Features */}
      <section>
        <Container>
          <SectionHeader
            badge="Architecture"
            title="Engineered for Scalability & Integrity"
            description="Built from the ground up to solve computational bottlenecks through modular infrastructure and resilient hardware clustering."
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-8">
            {pillars.map((pillar, idx) => (
              <Card key={idx} className="flex flex-col gap-4 group">
                <div className="w-12 h-12 rounded-xl bg-[#7A56D6]/10 border border-[#7A56D6]/30 flex items-center justify-center group-hover:scale-105 transition-transform duration-200">
                  {pillar.icon}
                </div>
                <h3 className="text-xl font-bold text-white group-hover:text-purple-300 transition-colors">
                  {pillar.title}
                </h3>
                <p className="text-gray-300 text-sm leading-relaxed">
                  {pillar.description}
                </p>
              </Card>
            ))}
          </div>
        </Container>
      </section>

      {/* 5. How It Works */}
      <section>
        <Container>
          <SectionHeader
            badge="Workflow"
            title="How the Infrastructure Operates"
            description="Our three-stage operational cycle delivers dependable cloud computing power with zero single point of failure."
          />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {workflowSteps.map((stepItem, idx) => (
              <div
                key={idx}
                className="relative flex flex-col p-8 rounded-2xl bg-white/[0.02] border border-purple-900/30 hover:border-[#7A56D6]/40 transition-colors"
              >
                <span className="text-3xl font-extrabold text-[#7A56D6]/40 mb-4">
                  {stepItem.step}
                </span>
                <h3 className="text-xl font-bold text-white mb-2">{stepItem.title}</h3>
                <p className="text-gray-400 text-sm leading-relaxed">
                  {stepItem.description}
                </p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      {/* 6. Why Choose Minetrades */}
      <section>
        <Container>
          <SectionHeader
            badge="Advantages"
            title="Why Choose Minetrades"
            description="Experience institutional-grade cloud computing with dedicated support, transparent ledger telemetry, and maximum uptime."
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {whyChooseItems.map((item, idx) => (
              <div
                key={idx}
                className="p-6 rounded-2xl bg-white/[0.02] border border-purple-900/30 hover:border-[#7A56D6]/50 transition-all flex flex-col gap-3 group"
              >
                <div className="text-3xl mb-1">{item.icon}</div>
                <h3 className="text-lg font-bold text-white group-hover:text-purple-300 transition-colors">
                  {item.title}
                </h3>
                <p className="text-gray-400 text-xs sm:text-sm leading-relaxed">
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      {/* 7. About / Company Introduction */}
      <section>
        <Container>
          <div className="relative rounded-3xl overflow-hidden p-8 sm:p-12 border border-purple-900/40 bg-gradient-to-br from-purple-950/30 via-[#0a0614] to-black">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
              <div>
                <span className="px-3.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-purple-500/20 text-purple-300 border border-purple-500/40 mb-4 inline-block">
                  Company Introduction
                </span>
                <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight mb-4">
                  Pioneering Next-Gen Computing Infrastructure
                </h2>
                <p className="text-gray-300 text-sm leading-relaxed mb-6">
                  Founded to democratize access to high-density computational clusters, Minetrades operates
                  secure mining facilities with 24/7 telemetry monitoring, automated yield distributions, and
                  institutional-grade risk controls.
                </p>
                <div className="flex flex-wrap items-center gap-4">
                  <Button to={ROUTES.ABOUT} variant="primary" size="md">
                    Learn More About Us →
                  </Button>
                  <Button to={ROUTES.CONTACT} variant="outline" size="md">
                    Contact Engineering
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/10 text-center">
                  <div className="text-3xl font-extrabold text-purple-300">50,000+</div>
                  <div className="text-xs text-gray-400 mt-1 uppercase font-semibold">MH/s Total Capacity</div>
                </div>
                <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/10 text-center">
                  <div className="text-3xl font-extrabold text-white">99.98%</div>
                  <div className="text-xs text-gray-400 mt-1 uppercase font-semibold">Node SLA Uptime</div>
                </div>
                <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/10 text-center">
                  <div className="text-3xl font-extrabold text-white">₹300</div>
                  <div className="text-xs text-gray-400 mt-1 uppercase font-semibold">Fixed Referral Bonus</div>
                </div>
                <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/10 text-center">
                  <div className="text-3xl font-extrabold text-purple-300">24/7</div>
                  <div className="text-xs text-gray-400 mt-1 uppercase font-semibold">Active Monitoring</div>
                </div>
              </div>
            </div>
          </div>
        </Container>
      </section>

      {/* 8. FAQ Section */}
      <section className="scroll-mt-24">
        <Container>
          <SectionHeader
            badge="Questions"
            title="Frequently Asked Questions"
            description="Find direct answers to common questions about cloud compute clusters, daily settlements, deposits, and account security."
          />

          <div className="max-w-3xl mx-auto space-y-3">
            {faqs.map((faq, idx) => {
              const isOpen = openFaq === idx;
              return (
                <div
                  key={idx}
                  className="rounded-2xl border border-white/10 bg-white/[0.02] overflow-hidden transition-colors"
                >
                  <button
                    type="button"
                    onClick={() => setOpenFaq(isOpen ? null : idx)}
                    className="w-full p-5 text-left flex items-center justify-between gap-4 hover:bg-white/[0.02] transition-colors"
                  >
                    <span className="font-semibold text-white text-sm sm:text-base">
                      {faq.q}
                    </span>
                    <span className={`text-[#7A56D6] font-bold text-lg transition-transform duration-200 ${isOpen ? 'rotate-45' : ''}`}>
                      +
                    </span>
                  </button>

                  {isOpen && (
                    <div className="px-5 pb-5 pt-1 text-xs sm:text-sm text-gray-400 leading-relaxed border-t border-white/5 animate-fadeIn">
                      {faq.a}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Container>
      </section>

      {/* 9. Footer (Rendered by MainLayout) */}

      {/* Modals */}
      {selectedPlanForDetails && (
        <PlanDetailsModal
          planId={selectedPlanForDetails._id}
          initialPlan={selectedPlanForDetails}
          isAuthenticated={isAuthenticated}
          onClose={() => setSelectedPlanForDetails(null)}
          onProceedToPurchase={(plan) => {
            setSelectedPlanForDetails(null);
            handlePurchaseClick(plan);
          }}
        />
      )}

      {selectedPlanForPurchase && (
        <PurchaseConfirmationModal
          plan={selectedPlanForPurchase}
          wallet={wallet}
          onClose={() => setSelectedPlanForPurchase(null)}
          onSuccess={async () => {
            if (refreshWallet) await refreshWallet();
          }}
        />
      )}
    </div>
  );
}

export default HomePage;
