import { useState } from 'react';
import { Container, Button, Card, SectionHeader } from '../../components/common';

export function ContactPage() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    subject: '',
    message: '',
  });

  const [submitted, setSubmitted] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (formData.name && formData.email && formData.message) {
      setSubmitted(true);
    }
  };

  const resetForm = () => {
    setFormData({ name: '', email: '', subject: '', message: '' });
    setSubmitted(false);
  };

  const channels = [
    {
      title: 'Technical Support',
      description: 'Questions regarding infrastructure specifications and node health status.',
      contact: 'support@treadexmine.io',
      icon: (
        <svg className="w-5 h-5 text-[#7A56D6]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
      ),
    },
    {
      title: 'Institutional Inquiries',
      description: 'Custom cluster provisioning, dedicated computing capacity, and partnerships.',
      contact: 'enterprise@treadexmine.io',
      icon: (
        <svg className="w-5 h-5 text-[#7A56D6]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
        </svg>
      ),
    },
    {
      title: 'Operational Availability',
      description: 'Core infrastructure telemetry monitoring and automated dispatch.',
      contact: '24/7/365 Dedicated Oversight',
      icon: (
        <svg className="w-5 h-5 text-[#7A56D6]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-16 sm:gap-24 py-12 sm:py-20">
      {/* Header */}
      <section>
        <Container>
          <div className="max-w-3xl mx-auto text-center flex flex-col items-center">
            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider text-purple-300 bg-[#7A56D6]/20 border border-[#7A56D6]/40 mb-4 backdrop-blur-sm">
              Direct Communication
            </span>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-white tracking-tight mb-6">
              Contact <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#7A56D6] to-purple-300">Support & Team</span>
            </h1>
            <p className="text-lg sm:text-xl text-gray-300 leading-relaxed">
              Have inquiries about TreadExMine platform architecture, institutional compute,
              or integration roadmap? Connect with our team.
            </p>
          </div>
        </Container>
      </section>

      {/* Main Content: Channels & Form */}
      <section>
        <Container>
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
            {/* Information Column */}
            <div className="lg:col-span-5 flex flex-col gap-6">
              <h2 className="text-2xl font-bold text-white mb-2">Communication Channels</h2>
              <div className="flex flex-col gap-4">
                {channels.map((ch, idx) => (
                  <Card key={idx} className="flex items-start gap-4 p-5">
                    <div className="p-2.5 rounded-lg bg-[#7A56D6]/10 border border-[#7A56D6]/30 shrink-0">
                      {ch.icon}
                    </div>
                    <div className="flex flex-col">
                      <h3 className="text-base font-semibold text-white">{ch.title}</h3>
                      <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">
                        {ch.description}
                      </p>
                      <span className="text-xs font-medium text-purple-300 mt-2 font-mono">
                        {ch.contact}
                      </span>
                    </div>
                  </Card>
                ))}
              </div>
            </div>

            {/* Form Column */}
            <div className="lg:col-span-7">
              <Card className="p-8 sm:p-10 border-purple-800/40">
                <h2 className="text-2xl font-bold text-white mb-2">Send an Inquiry</h2>
                <p className="text-gray-400 text-sm mb-8">
                  Fill in your details below and our team will get back to you shortly.
                </p>

                {submitted ? (
                  <div className="p-6 rounded-2xl bg-purple-950/40 border border-[#7A56D6]/50 flex flex-col items-center text-center gap-4 animate-fadeIn">
                    <div className="w-12 h-12 rounded-full bg-[#7A56D6]/20 border border-[#7A56D6] flex items-center justify-center text-purple-300">
                      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <h3 className="text-lg font-bold text-white">Inquiry Received</h3>
                    <p className="text-sm text-gray-300 max-w-md">
                      Thank you for contacting TreadExMine. Your message has been recorded.
                    </p>
                    <Button variant="outline" size="sm" onClick={resetForm} className="mt-2">
                      Send Another Message
                    </Button>
                  </div>
                ) : (
                  <form onSubmit={handleSubmit} className="flex flex-col gap-5">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                      <div className="flex flex-col gap-1.5">
                        <label htmlFor="name" className="text-xs font-medium text-gray-300">
                          Full Name *
                        </label>
                        <input
                          id="name"
                          name="name"
                          type="text"
                          required
                          value={formData.name}
                          onChange={handleChange}
                          placeholder="Your Name"
                          className="w-full px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/10 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-[#7A56D6] focus:ring-1 focus:ring-[#7A56D6] transition-all"
                        />
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <label htmlFor="email" className="text-xs font-medium text-gray-300">
                          Email Address *
                        </label>
                        <input
                          id="email"
                          name="email"
                          type="email"
                          required
                          value={formData.email}
                          onChange={handleChange}
                          placeholder="name@company.com"
                          className="w-full px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/10 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-[#7A56D6] focus:ring-1 focus:ring-[#7A56D6] transition-all"
                        />
                      </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="subject" className="text-xs font-medium text-gray-300">
                        Subject
                      </label>
                      <input
                        id="subject"
                        name="subject"
                        type="text"
                        value={formData.subject}
                        onChange={handleChange}
                        placeholder="Inquiry Topic"
                        className="w-full px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/10 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-[#7A56D6] focus:ring-1 focus:ring-[#7A56D6] transition-all"
                      />
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="message" className="text-xs font-medium text-gray-300">
                        Message *
                      </label>
                      <textarea
                        id="message"
                        name="message"
                        rows={5}
                        required
                        value={formData.message}
                        onChange={handleChange}
                        placeholder="Describe your inquiry..."
                        className="w-full px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/10 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-[#7A56D6] focus:ring-1 focus:ring-[#7A56D6] transition-all resize-y"
                      />
                    </div>

                    <Button type="submit" variant="primary" size="lg" className="w-full mt-2">
                      Submit Inquiry
                    </Button>
                  </form>
                )}
              </Card>
            </div>
          </div>
        </Container>
      </section>
    </div>
  );
}

export default ContactPage;
