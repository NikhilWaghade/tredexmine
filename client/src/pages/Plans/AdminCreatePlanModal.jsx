import { useState } from 'react';
import { planService } from '../../services';
import { Button } from '../../components/common';

export function AdminCreatePlanModal({ isOpen, onClose, onSuccess }) {
  const [formData, setFormData] = useState({
    name: '',
    tag: '',
    description: '',
    price: '',
    durationDays: '',
    dailyRoiRate: '',
    hashRate: '',
    featuresText: '',
    sortOrder: 0,
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);

  if (!isOpen) return null;

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (error) setError(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    const features = formData.featuresText
      .split('\n')
      .map((f) => f.trim())
      .filter(Boolean);

    const payload = {
      name: formData.name.trim(),
      tag: formData.tag.trim(),
      description: formData.description.trim(),
      price: Number(formData.price),
      durationDays: Number(formData.durationDays),
      dailyRoiRate: formData.dailyRoiRate ? Number(formData.dailyRoiRate) : 0,
      hashRate: formData.hashRate.trim(),
      features,
      sortOrder: Number(formData.sortOrder) || 0,
    };

    try {
      const res = await planService.createPlan(payload);
      if (res.success) {
        if (onSuccess) {
          await onSuccess(res.plan);
        }
        onClose();
      } else {
        setError(res.message || 'Failed to create plan');
      }
    } catch (err) {
      setError(
        err.response?.data?.message ||
          (err.response?.data?.errors
            ? err.response.data.errors.join(', ')
            : 'Plan creation rejected by server')
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
      {/* Backdrop */}
      <div className="fixed inset-0" onClick={onClose} aria-hidden="true" />

      {/* Modal Dialog Card */}
      <div className="relative w-full max-w-lg rounded-2xl bg-[#0e081e] border border-purple-900/60 p-6 sm:p-8 shadow-2xl shadow-purple-950/80 z-10 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-white/10 mb-5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-purple-950/80 border border-purple-800/50 flex items-center justify-center text-purple-300 font-bold">
              +
            </div>
            <div>
              <h3 className="text-xl font-bold text-white tracking-tight">
                Create Mining Plan (Administrator)
              </h3>
              <p className="text-xs text-gray-400">
                Authorized endpoint: POST /api/v1/plans
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white p-2 rounded-lg hover:bg-white/5 transition-colors focus:outline-none"
            aria-label="Close admin modal"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-rose-950/60 border border-rose-800/60 text-rose-200 text-xs">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5 text-xs">
          <div>
            <label className="block font-semibold uppercase text-gray-300 mb-1">
              Plan Name *
            </label>
            <input
              type="text"
              name="name"
              required
              value={formData.name}
              onChange={handleChange}
              placeholder="Enterprise Node Pro"
              className="w-full px-3.5 py-2 rounded-xl bg-white/[0.04] border border-purple-900/40 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#7A56D6]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold uppercase text-gray-300 mb-1">
                Tag (e.g. Popular)
              </label>
              <input
                type="text"
                name="tag"
                value={formData.tag}
                onChange={handleChange}
                placeholder="High Yield"
                className="w-full px-3.5 py-2 rounded-xl bg-white/[0.04] border border-purple-900/40 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#7A56D6]"
              />
            </div>
            <div>
              <label className="block font-semibold uppercase text-gray-300 mb-1">
                Hash Rate
              </label>
              <input
                type="text"
                name="hashRate"
                value={formData.hashRate}
                onChange={handleChange}
                placeholder="100 TH/s"
                className="w-full px-3.5 py-2 rounded-xl bg-white/[0.04] border border-purple-900/40 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#7A56D6]"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block font-semibold uppercase text-gray-300 mb-1">
                Price (₹) *
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                name="price"
                required
                value={formData.price}
                onChange={handleChange}
                placeholder="150.00"
                className="w-full px-3.5 py-2 rounded-xl bg-white/[0.04] border border-purple-900/40 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#7A56D6]"
              />
            </div>
            <div>
              <label className="block font-semibold uppercase text-gray-300 mb-1">
                Duration (Days) *
              </label>
              <input
                type="number"
                step="1"
                min="1"
                name="durationDays"
                required
                value={formData.durationDays}
                onChange={handleChange}
                placeholder="30"
                className="w-full px-3.5 py-2 rounded-xl bg-white/[0.04] border border-purple-900/40 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#7A56D6]"
              />
            </div>
            <div>
              <label className="block font-semibold uppercase text-gray-300 mb-1">
                Daily ROI (Rate)
              </label>
              <input
                type="number"
                step="0.001"
                min="0"
                name="dailyRoiRate"
                value={formData.dailyRoiRate}
                onChange={handleChange}
                placeholder="0.015"
                className="w-full px-3.5 py-2 rounded-xl bg-white/[0.04] border border-purple-900/40 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#7A56D6]"
              />
            </div>
          </div>

          <div>
            <label className="block font-semibold uppercase text-gray-300 mb-1">
              Description
            </label>
            <textarea
              name="description"
              rows={2}
              value={formData.description}
              onChange={handleChange}
              placeholder="Enterprise tier hardware allocation..."
              className="w-full px-3.5 py-2 rounded-xl bg-white/[0.04] border border-purple-900/40 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#7A56D6]"
            />
          </div>

          <div>
            <label className="block font-semibold uppercase text-gray-300 mb-1">
              Features (one per line)
            </label>
            <textarea
              name="featuresText"
              rows={3}
              value={formData.featuresText}
              onChange={handleChange}
              placeholder="Tier-4 Facility Allocation&#10;24/7 Monitoring&#10;Daily Automated Yields"
              className="w-full px-3.5 py-2 rounded-xl bg-white/[0.04] border border-purple-900/40 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#7A56D6]"
            />
          </div>

          <div className="pt-3 border-t border-white/10 flex items-center justify-end gap-2.5">
            <Button onClick={onClose} variant="ghost" size="sm" type="button">
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm" disabled={isSubmitting}>
              {isSubmitting ? 'Creating Plan...' : 'Create Plan'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default AdminCreatePlanModal;
