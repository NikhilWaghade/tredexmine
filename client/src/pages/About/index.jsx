import { Link } from 'react-router-dom';
import { ROUTES } from '../../constants';
import { Container, Button, Card, SectionHeader } from '../../components/common';

export function AboutPage() {
  const principles = [
    {
      title: 'Reliability First',
      description:
        'Continuous uptime is the foundation of our compute infrastructure. We design each subsystem with automated failover and redundancy.',
    },
    {
      title: 'Architectural Transparency',
      description:
        'We believe in absolute operational clarity. From node allocations to maintenance windows, every layer operates with integrity.',
    },
    {
      title: 'Resource Optimization',
      description:
        'Maximizing hash output per watt consumed through algorithmic hardware scheduling and energy-efficient data center partnerships.',
    },
    {
      title: 'Proactive Defense',
      description:
        'Multi-tiered defense strategies, isolated cluster perimeters, and constant cryptographic health audits safeguard all compute pipelines.',
    },
  ];

  return (
    <div className="flex flex-col gap-20 sm:gap-28 py-12 sm:py-20">
      {/* Header Section */}
      <section>
        <Container>
          <div className="max-w-3xl mx-auto text-center flex flex-col items-center">
            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider text-purple-300 bg-[#7A56D6]/20 border border-[#7A56D6]/40 mb-4 backdrop-blur-sm">
              Our Identity & Mission
            </span>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-white tracking-tight mb-6 leading-tight">
              About <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#7A56D6] to-purple-300">TreadExMine</span>
            </h1>
            <p className="text-lg sm:text-xl text-gray-300 leading-relaxed font-normal">
              Pioneering high-density distributed computing architectures to provide accessible,
              resilient, and enterprise-grade mining infrastructure worldwide.
            </p>
          </div>
        </Container>
      </section>

      {/* Mission & Vision Section */}
      <section>
        <Container>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <Card className="flex flex-col gap-4">
              <div className="w-10 h-10 rounded-lg bg-[#7A56D6]/20 flex items-center justify-center text-[#7A56D6]">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-white">Our Mission</h2>
              <p className="text-gray-300 text-sm leading-relaxed">
                To simplify and elevate cloud-based computational mining by delivering an institutional-grade,
                secure platform where participants benefit from industrial-scale hardware efficiencies without
                the operational burden of physical infrastructure management.
              </p>
            </Card>

            <Card className="flex flex-col gap-4">
              <div className="w-10 h-10 rounded-lg bg-[#7A56D6]/20 flex items-center justify-center text-[#7A56D6]">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-white">Our Vision</h2>
              <p className="text-gray-300 text-sm leading-relaxed">
                To set the benchmark for transparent, energy-responsible, and automated decentralized
                compute solutions, bridging modern web technologies with robust hardware networks.
              </p>
            </Card>
          </div>
        </Container>
      </section>

      {/* Core Principles */}
      <section>
        <Container>
          <SectionHeader
            badge="Values"
            title="Core Engineering Pillars"
            description="Our architecture is anchored upon principles that prioritize system longevity, user trust, and technological rigour."
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {principles.map((principle, index) => (
              <div
                key={index}
                className="p-6 rounded-2xl bg-white/[0.02] border border-purple-900/30 flex flex-col gap-3"
              >
                <div className="text-sm font-semibold text-[#7A56D6] tracking-wider uppercase">
                  Pillar {index + 1}
                </div>
                <h3 className="text-lg font-bold text-white">{principle.title}</h3>
                <p className="text-gray-400 text-sm leading-relaxed">
                  {principle.description}
                </p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      {/* Technical Overview Banner */}
      <section>
        <Container>
          <div className="rounded-3xl p-8 sm:p-12 bg-white/[0.02] border border-purple-900/40 flex flex-col md:flex-row items-center justify-between gap-8">
            <div className="flex flex-col gap-2 max-w-xl">
              <h3 className="text-2xl font-bold text-white">
                Interested in Technical Inquiries?
              </h3>
              <p className="text-gray-300 text-sm">
                Have questions about our compute facilities, security protocols, or future milestone releases?
                Connect with our team today.
              </p>
            </div>
            <Button to={ROUTES.CONTACT} variant="primary" size="md" className="shrink-0">
              Contact Engineering
            </Button>
          </div>
        </Container>
      </section>
    </div>
  );
}

export default AboutPage;
