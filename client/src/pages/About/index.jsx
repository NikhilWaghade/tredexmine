import { useState } from 'react';
import { ROUTES } from '../../constants';
import { Container, Button, Card, SectionHeader } from '../../components/common';

export function AboutPage() {
  const [activeImageModal, setActiveImageModal] = useState(null);

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

  const techFeatures = [
    {
      title: 'Tier-4 Modular Facilities',
      desc: 'Climate-controlled high-density server halls operating at a certified 99.98% hardware uptime SLA.',
      tag: 'Hardware',
    },
    {
      title: 'Liquid Immersion Cooling',
      desc: 'Advanced dielectric fluid cooling lowers operating temperatures by up to 35% compared to conventional air cooling.',
      tag: 'Thermodynamics',
    },
    {
      title: 'Sub-Millisecond Stratum Routing',
      desc: 'Optimized network backbones connecting nodes directly to leading mining pools with minimal latency and zero stale shares.',
      tag: 'Networking',
    },
    {
      title: 'Algorithmic Dynamic Dispatch',
      desc: 'Intelligent scheduler continuously steers hash distribution toward peak computational efficiency.',
      tag: 'Algorithms',
    },
  ];

  const galleryImages = [
    {
      id: 1,
      title: 'High-Density ASIC Server Rack',
      category: 'Data Center Architecture',
      description: 'Dedicated Tier-4 computational cluster with redundant power delivery units.',
      src: 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?auto=format&fit=crop&w=800&q=80',
      alt: 'Minetrades high-density server racks in data center',
    },
    {
      id: 2,
      title: 'Cryogenic & Liquid Cooling Hub',
      category: 'Thermodynamic Engineering',
      description: 'Dielectric immersion tanks maintaining optimal ASIC chip operating temperatures.',
      src: 'https://images.unsplash.com/photo-1544197150-b99a580bb7a8?auto=format&fit=crop&w=800&q=80',
      alt: 'Server cooling system and network infrastructure',
    },
    {
      id: 3,
      title: 'Real-Time Telemetry Control Center',
      category: 'Network Operations (NOC)',
      description: '24/7 active surveillance monitoring node health, hashrate variance, and power draw.',
      src: 'https://images.unsplash.com/photo-1504384308090-c894fdcc538d?auto=format&fit=crop&w=800&q=80',
      alt: 'Network operations center monitoring screens',
    },
    {
      id: 4,
      title: 'Industrial Power Substations',
      category: 'Green Energy Infrastructure',
      description: 'Dedicated high-voltage grid connections utilizing hydro and geothermal energy sources.',
      src: 'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=800&q=80',
      alt: 'Microprocessor circuit board and hardware chip',
    },
    {
      id: 5,
      title: 'Isolated Network Switch Architecture',
      category: 'Cybersecurity & Isolation',
      description: 'Zero-trust perimeter security safeguarding mining telemetry and balance distribution.',
      src: 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?auto=format&fit=crop&w=800&q=80',
      alt: 'Network fiber switches and encrypted data lines',
    },
    {
      id: 6,
      title: 'Hardware Cluster Maintenance Bay',
      category: 'Preventative Operations',
      description: 'Precision diagnostic equipment and on-site hardware engineering staff.',
      src: 'https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?auto=format&fit=crop&w=800&q=80',
      alt: 'Hardware diagnostics and engineering laboratory',
    },
  ];

  const teamRoster = [
    {
      name: 'Executive Leadership',
      role: 'Chief Technology Officer',
      specialty: 'Distributed Systems & ASIC Optimization',
      avatarLabel: 'CTO',
      bio: 'Leading hardware architecture and multi-tier data center deployment strategies across global facilities.',
    },
    {
      name: 'Engineering Directorate',
      role: 'Head of Infrastructure',
      specialty: 'Power Engineering & Thermal Dynamics',
      avatarLabel: 'INF',
      bio: 'Oversees 24/7 electrical load balancing, liquid immersion cooling facilities, and uptime SLA adherence.',
    },
    {
      name: 'Security Governance',
      role: 'Lead Cryptographic Architect',
      specialty: 'Zero-Trust Perimeters & Financial Auditing',
      avatarLabel: 'SEC',
      bio: 'Designs append-only ledger security, AES-256 vault encryption, and withdrawal verification protocols.',
    },
    {
      name: 'Operations Directorate',
      role: 'Director of Global Node Operations',
      specialty: 'Stratum Protocols & Telemetry Monitoring',
      avatarLabel: 'OPS',
      bio: 'Directs the 24/7 Network Operations Center (NOC) and automated daily yield distribution engines.',
    },
  ];

  const whyChooseUsPoints = [
    {
      num: '01',
      title: 'Auditable Blockchain Telemetry',
      desc: 'Every block contribution and hash allocation is verified in real-time, eliminating guesswork or fabricated returns.',
    },
    {
      num: '02',
      title: 'Tier-4 Redundant Infrastructure',
      desc: 'Dual-grid power feeds, backup generators, and automatic failovers guarantee continuous node computation.',
    },
    {
      num: '03',
      title: 'Automated Daily Settlement',
      desc: 'Mining contracts execute for 30 days with automated daily distributions credited directly to your authoritative wallet ledger.',
    },
    {
      num: '04',
      title: 'Zero Physical Hardware Burden',
      desc: 'No equipment depreciation, electricity bills, noise dampening, or cooling maintenance. Start computing in seconds.',
    },
  ];

  return (
    <div className="flex flex-col gap-24 sm:gap-32 py-12 sm:py-20">
      {/* 1. About Minetrades (Header Section) */}
      <section>
        <Container>
          <div className="max-w-3xl mx-auto text-center flex flex-col items-center">
            <span className="inline-flex items-center px-3.5 py-1 rounded-full text-xs font-semibold uppercase tracking-wider text-purple-300 bg-[#7A56D6]/20 border border-[#7A56D6]/40 mb-4 backdrop-blur-sm">
              Our Identity & Infrastructure
            </span>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-white tracking-tight mb-6 leading-tight">
              About <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#7A56D6] to-purple-300">Minetrades</span>
            </h1>
            <p className="text-lg sm:text-xl text-gray-300 leading-relaxed font-normal">
              Pioneering high-density distributed computing architectures to provide accessible,
              resilient, and enterprise-grade mining infrastructure worldwide.
            </p>
          </div>
        </Container>
      </section>

      {/* 2 & 3. Mission & Vision Section */}
      <section>
        <Container>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <Card className="flex flex-col gap-4 bg-white/[0.02] border-purple-900/40 p-8">
              <div className="w-12 h-12 rounded-xl bg-[#7A56D6]/20 border border-[#7A56D6]/40 flex items-center justify-center text-[#7A56D6]">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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

            <Card className="flex flex-col gap-4 bg-white/[0.02] border-purple-900/40 p-8">
              <div className="w-12 h-12 rounded-xl bg-[#7A56D6]/20 border border-[#7A56D6]/40 flex items-center justify-center text-[#7A56D6]">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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

      {/* 4. Our Platform / Technology */}
      <section>
        <Container>
          <SectionHeader
            badge="Technology Stack"
            title="Industrial Cloud Infrastructure"
            description="Explore the technological pillars powering our continuous computing output and high-density node allocation."
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {techFeatures.map((tech, i) => (
              <div
                key={i}
                className="p-6 rounded-2xl bg-white/[0.02] border border-purple-900/30 hover:border-[#7A56D6]/50 transition-all flex flex-col justify-between"
              >
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-purple-300 bg-[#7A56D6]/10 px-2 py-0.5 rounded border border-[#7A56D6]/30 mb-3 inline-block">
                    {tech.tag}
                  </span>
                  <h3 className="text-lg font-bold text-white mb-2">{tech.title}</h3>
                  <p className="text-gray-400 text-xs sm:text-sm leading-relaxed">
                    {tech.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </Container>
      </section>

      {/* 5. Team & Company Leadership Photos / Structure */}
      <section>
        <Container>
          <SectionHeader
            badge="Leadership"
            title="Engineering & Operational Governance"
            description="Our multidisciplinary team combines deep experience in distributed systems, electrical engineering, and financial security."
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {teamRoster.map((member, idx) => (
              <div
                key={idx}
                className="p-6 rounded-2xl bg-white/[0.02] border border-purple-900/30 hover:border-[#7A56D6]/40 transition-colors flex flex-col text-center items-center"
              >
                {/* Identified Professional Avatar Placeholder */}
                <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-purple-800 to-[#7A56D6] flex items-center justify-center text-white font-extrabold text-xl shadow-lg shadow-purple-950/60 mb-4 border border-purple-400/30">
                  {member.avatarLabel}
                </div>

                <span className="text-[10px] font-bold uppercase tracking-wider text-purple-300 bg-purple-950/60 px-2.5 py-0.5 rounded-full border border-purple-800/40 mb-2">
                  {member.role}
                </span>

                <h3 className="text-base font-bold text-white mb-1">
                  {member.name}
                </h3>

                <p className="text-xs text-purple-200/80 font-medium mb-3">
                  {member.specialty}
                </p>

                <p className="text-gray-400 text-xs leading-relaxed">
                  {member.bio}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-8 p-3.5 rounded-xl bg-purple-950/20 border border-purple-800/30 text-center text-xs text-gray-400 max-w-xl mx-auto">
            <span className="font-semibold text-purple-300">Transparency Note: </span>
            Minetrades leadership structure displayed above. Verified executive identification maintained in compliance with governance standards.
          </div>
        </Container>
      </section>

      {/* 6. Image Gallery */}
      <section>
        <Container>
          <SectionHeader
            badge="Facilities Gallery"
            title="Inside Our Computational Facilities"
            description="Visual inspection of our Tier-4 server halls, immersion cooling systems, and real-time operations centers."
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {galleryImages.map((img) => (
              <div
                key={img.id}
                onClick={() => setActiveImageModal(img)}
                className="group relative rounded-2xl overflow-hidden bg-purple-950/30 border border-purple-900/40 hover:border-[#7A56D6] transition-all duration-300 cursor-pointer shadow-lg hover:shadow-[#7A56D6]/20"
              >
                {/* Responsive Image Aspect Ratio */}
                <div className="relative aspect-[16/10] overflow-hidden bg-black/60">
                  <img
                    src={img.src}
                    alt={img.alt}
                    loading="lazy"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 ease-out"
                    onError={(e) => {
                      // Graceful fallback to stylish gradient if network restricts external images
                      e.target.style.display = 'none';
                      e.target.parentElement.classList.add(
                        'bg-gradient-to-br',
                        'from-purple-950',
                        'to-[#0e081e]'
                      );
                    }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent opacity-80 group-hover:opacity-60 transition-opacity" />

                  {/* Zoom Badge */}
                  <div className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/60 backdrop-blur-md border border-white/20 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v6m3-3H7" />
                    </svg>
                  </div>

                  <span className="absolute top-3 left-3 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-purple-950/80 text-purple-200 border border-purple-700/50 backdrop-blur-md">
                    {img.category}
                  </span>
                </div>

                <div className="p-4 sm:p-5">
                  <h3 className="text-base font-bold text-white group-hover:text-purple-300 transition-colors mb-1">
                    {img.title}
                  </h3>
                  <p className="text-xs text-gray-400 line-clamp-2 leading-relaxed">
                    {img.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </Container>
      </section>

      {/* 7. Why Choose Us */}
      <section>
        <Container>
          <SectionHeader
            badge="Value Proposition"
            title="Why Choose Minetrades"
            description="Architected for maximum reliability, institutional transparency, and zero user hardware liability."
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {whyChooseUsPoints.map((point, index) => (
              <div
                key={index}
                className="p-6 rounded-2xl bg-white/[0.02] border border-purple-900/30 flex flex-col gap-3 group hover:border-[#7A56D6]/40 transition-colors"
              >
                <div className="text-2xl font-extrabold text-[#7A56D6]/60 group-hover:text-[#7A56D6] transition-colors">
                  {point.num}
                </div>
                <h3 className="text-base font-bold text-white">{point.title}</h3>
                <p className="text-gray-400 text-xs sm:text-sm leading-relaxed">
                  {point.desc}
                </p>
              </div>
            ))}
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

      {/* Gallery Lightbox Modal */}
      {activeImageModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-md animate-fadeIn"
          onClick={() => setActiveImageModal(null)}
        >
          <div
            className="relative max-w-3xl w-full bg-[#0e081e] border border-purple-800/60 rounded-2xl overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setActiveImageModal(null)}
              className="absolute top-4 right-4 z-10 w-9 h-9 rounded-full bg-black/70 text-gray-300 hover:text-white flex items-center justify-center border border-white/20"
              aria-label="Close image modal"
            >
              ✕
            </button>
            <div className="aspect-[16/10] w-full bg-black">
              <img
                src={activeImageModal.src}
                alt={activeImageModal.alt}
                className="w-full h-full object-cover"
              />
            </div>
            <div className="p-6">
              <span className="text-xs font-bold uppercase tracking-wider text-purple-300">
                {activeImageModal.category}
              </span>
              <h3 className="text-xl font-bold text-white mt-1 mb-2">
                {activeImageModal.title}
              </h3>
              <p className="text-sm text-gray-300 leading-relaxed">
                {activeImageModal.description}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AboutPage;
