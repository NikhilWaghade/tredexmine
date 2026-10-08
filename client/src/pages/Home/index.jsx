import { Link } from 'react-router-dom';
import { ROUTES } from '../../constants';
import { Container, Button, Card, SectionHeader } from '../../components/common';

export function HomePage() {
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

  return (
    <div className="flex flex-col gap-24 sm:gap-32 py-12 sm:py-20">
      {/* Hero Section */}
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
              TreadExMine provides institutional-grade computing infrastructure designed for
              continuous performance, hardware resilience, and transparent node orchestration.
            </p>

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row items-center gap-4 w-full sm:w-auto">
              <Button to={ROUTES.ABOUT} variant="primary" size="lg" className="w-full sm:w-auto">
                Explore Platform
              </Button>
              <Button to={ROUTES.CONTACT} variant="outline" size="lg" className="w-full sm:w-auto">
                Contact Technical Team
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

      {/* Core Architectural Pillars */}
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

      {/* Operational Workflow Section */}
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

      {/* Call to Action Banner */}
      <section>
        <Container>
          <div className="relative rounded-3xl overflow-hidden p-8 sm:p-14 border border-purple-800/40 bg-gradient-to-r from-purple-950/40 via-black to-purple-950/40 text-center flex flex-col items-center">
            <h2 className="text-2xl sm:text-4xl font-extrabold text-white mb-4">
              Ready to Discover TreadExMine?
            </h2>
            <p className="text-gray-300 text-base sm:text-lg max-w-2xl mb-8 leading-relaxed">
              Explore our architecture or contact our engineering specialists for detailed technical
              specifications and deployment schedules.
            </p>
            <div className="flex flex-col sm:flex-row items-center gap-4">
              <Button to={ROUTES.ABOUT} variant="primary" size="md">
                Learn More About Us
              </Button>
              <Button to={ROUTES.CONTACT} variant="outline" size="md">
                Get In Touch
              </Button>
            </div>
          </div>
        </Container>
      </section>
    </div>
  );
}

export default HomePage;
