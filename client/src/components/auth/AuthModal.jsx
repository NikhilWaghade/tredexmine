import { useState } from 'react';
import { useAuth } from '../../context';
import { Button } from '../common';

export function AuthModal() {
  const { isAuthModalOpen, closeAuthModal, login, register, authError, setAuthError } = useAuth();
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    referredBy: '',
  });

  if (!isAuthModalOpen) return null;

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (authError) setAuthError(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      if (mode === 'login') {
        await login(formData.email, formData.password);
      } else {
        await register({
          name: formData.name,
          email: formData.email,
          password: formData.password,
          referredBy: formData.referredBy || undefined,
        });
      }
    } catch {
      // Error is stored in authError
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
      {/* Modal Backdrop */}
      <div
        className="fixed inset-0"
        onClick={closeAuthModal}
        aria-hidden="true"
      />

      {/* Modal Dialog Card */}
      <div className="relative w-full max-w-md rounded-2xl bg-[#0f0920] border border-purple-900/50 p-6 sm:p-8 shadow-2xl shadow-purple-950/80 z-10">
        {/* Close Button */}
        <button
          onClick={closeAuthModal}
          className="absolute top-4 right-4 text-gray-400 hover:text-white p-2 rounded-lg hover:bg-white/5 transition-colors focus:outline-none"
          aria-label="Close authentication modal"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Modal Header */}
        <div className="text-center mb-6">
          <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-gradient-to-tr from-[#7A56D6] to-purple-400 p-0.5 shadow-md shadow-[#7A56D6]/30">
            <div className="w-full h-full bg-black/90 rounded-[10px] flex items-center justify-center">
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-200 to-white font-extrabold text-xl">
                TX
              </span>
            </div>
          </div>
          <h3 className="text-2xl font-bold text-white tracking-tight">
            {mode === 'login' ? 'Sign In to TreadExMine' : 'Create an Account'}
          </h3>
          <p className="text-sm text-gray-400 mt-1">
            {mode === 'login'
              ? 'Access your mining plans, wallet, and compute rigs'
              : 'Deploy cloud mining power and manage your assets'}
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="grid grid-cols-2 p-1 bg-white/[0.04] border border-white/10 rounded-xl mb-6">
          <button
            type="button"
            onClick={() => {
              setMode('login');
              setAuthError(null);
            }}
            className={`py-2 text-sm font-medium rounded-lg transition-all ${
              mode === 'login'
                ? 'bg-[#7A56D6] text-white shadow-sm shadow-[#7A56D6]/40'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('register');
              setAuthError(null);
            }}
            className={`py-2 text-sm font-medium rounded-lg transition-all ${
              mode === 'register'
                ? 'bg-[#7A56D6] text-white shadow-sm shadow-[#7A56D6]/40'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Register
          </button>
        </div>

        {/* Error Alert */}
        {authError && (
          <div className="mb-4 p-3 rounded-xl bg-rose-950/60 border border-rose-800/60 text-rose-200 text-sm flex items-center gap-2">
            <svg className="w-5 h-5 flex-shrink-0 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{authError}</span>
          </div>
        )}

        {/* Auth Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {mode === 'register' && (
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-300 mb-1.5">
                Full Name
              </label>
              <input
                type="text"
                name="name"
                required
                value={formData.name}
                onChange={handleChange}
                placeholder="Jane Doe"
                className="w-full px-4 py-2.5 rounded-xl bg-white/[0.04] border border-purple-900/40 text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-[#7A56D6] focus:border-transparent transition-all"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-300 mb-1.5">
              Email Address
            </label>
            <input
              type="email"
              name="email"
              required
              value={formData.email}
              onChange={handleChange}
              placeholder="user@example.com"
              className="w-full px-4 py-2.5 rounded-xl bg-white/[0.04] border border-purple-900/40 text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-[#7A56D6] focus:border-transparent transition-all"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-300 mb-1.5">
              Password
            </label>
            <input
              type="password"
              name="password"
              required
              value={formData.password}
              onChange={handleChange}
              placeholder="••••••••"
              className="w-full px-4 py-2.5 rounded-xl bg-white/[0.04] border border-purple-900/40 text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-[#7A56D6] focus:border-transparent transition-all"
            />
          </div>

          {mode === 'register' && (
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-300 mb-1.5">
                Referral Code (Optional)
              </label>
              <input
                type="text"
                name="referredBy"
                value={formData.referredBy}
                onChange={handleChange}
                placeholder="TXM-..."
                className="w-full px-4 py-2.5 rounded-xl bg-white/[0.04] border border-purple-900/40 text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-[#7A56D6] focus:border-transparent transition-all"
              />
            </div>
          )}

          <Button
            type="submit"
            variant="primary"
            size="lg"
            disabled={isSubmitting}
            className="w-full mt-2"
          >
            {isSubmitting ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Processing...
              </span>
            ) : mode === 'login' ? (
              'Sign In'
            ) : (
              'Create Account'
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}

export default AuthModal;
