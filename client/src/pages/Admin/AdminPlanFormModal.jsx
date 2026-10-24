import { useState } from 'react';
import { planService } from '../../services';
import { Button } from '../../components/common';

function getInitialFormData(plan) {
  if (plan) {
    return {
      name: plan.name || '',
      tag: plan.tag || '',
      description: plan.description || '',
      price: plan.price != null ? String(plan.price) : '',
      durationDays: plan.durationDays != null ? String(plan.durationDays) : '',
      dailyRoiRate: plan.dailyRoiRate != null ? String(plan.dailyRoiRate) : '',
      hashRate: plan.hashRate || '',
      featuresText: Array.isArray(plan.features) ? plan.features.join('\n') : '',
      isActive: plan.isActive !== undefined ? Boolean(plan.isActive) : true,
      sortOrder: plan.sortOrder != null ? Number(plan.sortOrder) : 0,
    };
  }
  return {
    name: '',
    tag: '',
    description: '',
    price: '',
    durationDays: '30',
    dailyRoiRate: '0.015',
    hashRate: '',
    featuresText: 'Dedicated Tier-4 Compute Slot\nDaily Automated Yield Settlement\n24/7 Cluster Monitoring',
    isActive: true,
    sortOrder: 0,
  };
}

export function AdminPlanFormModal({ isOpen, plan, onClose, onSuccess }) {
  const isEditMode = Boolean(plan?._id);

  const [formData, setFormData] = useState(() => getInitialFormData(plan));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);

  if (!isOpen) return null;

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
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

    const priceNum = Number(formData.price);
    const durationNum = Number(formData.durationDays);
    const roiNum = formData.dailyRoiRate !== '' ? Number(formData.dailyRoiRate) : 0;
    const sortOrderNum = formData.sortOrder !== '' ? Number(formData.sortOrder) : 0;

    // Client-side pre-validation
    if (!formData.name.trim() || formData.name.trim().length < 2) {
      setError('Plan name must be at least 2 characters.');
      setIsSubmitting(false);
      return;
    }

    if (isNaN(priceNum) || priceNum <= 0) {
      setError('Price must be a positive number greater than 0.');
      setIsSubmitting(false);
      return;
    }

    if (isNaN(durationNum) || !Number.isInteger(durationNum) || durationNum < 1) {
      setError('Duration must be an integer of at least 1 day.');
      setIsSubmitting(false);
      return;
    }

    if (isNaN(roiNum) || roiNum < 0) {
      setError('Daily ROI rate cannot be negative.');
      setIsSubmitting(false);
      return;
    }

    const payload = {
      name: formData.name.trim(),
      tag: formData.tag.trim(),
      description: formData.description.trim(),
      price: priceNum,
      durationDays: durationNum,
      dailyRoiRate: roiNum,
      hashRate: formData.hashRate.trim(),
      features,
      isActive: Boolean(formData.isActive),
      sortOrder: sortOrderNum,
    };

    try {
      let res;
      if (isEditMode) {
        res = await planService.updatePlan(plan._id, payload);
      } else {
        res = await planService.createPlan(payload);
      }

      if (res.success) {
        if (onSuccess) {
          await onSuccess(res.plan || res.data?.plan);
        }
        onClose();
      } else {
        setError(res.message || 'Operation failed');
      }
    } catch (err) {
      const apiMsg =
        err.response?.data?.errors?.join(', ') ||
        err.response?.data?.message ||
        err.message ||
        'Server rejected plan modification';
      setError(apiMsg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
      {/* Backdrop */}
      <div className="fixed inset-0" onClick={!isSubmitting ? onClose : undefined} aria-hidden="true" />

      {/* Modal Dialog Card */}
      <div className="relative w-full max-w-xl rounded-2xl bg-[#0e081e] border border-purple-900/60 p-6 sm:p-8 shadow-2xl shadow-purple-950/80 z-10 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-white/10 mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-950/80 border border-purple-800/50 flex items-center justify-center text-[#7A56D6] font-bold">
              {isEditMode ? '✎' : '+'}
            </div>
            <div>
              <h3 className="text-xl font-bold text-white tracking-tight">
                {isEditMode ? `Edit Plan: ${plan.name}` : 'Create Mining Plan'}
              </h3>
              <p className="text-xs text-gray-400">
                Administrator Control • {isEditMode ? `ID: ${plan._id}` : 'MongoDB Catalog Creation'}
              </p>
            </div>
          </div>

          {!isSubmitting && (
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white p-2 rounded-lg hover:bg-white/5 transition-colors focus:outline-none"
              aria-label="Close modal"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Error Alert */}
        {error && (
          <div className="mb-4 p-3.5 rounded-xl bg-rose-950/60 border border-rose-800/60 text-rose-200 text-xs flex items-start gap-2.5">
            <svg className="w-4 h-4 flex-shrink-0 text-rose-400 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <span className="font-semibold block mb-0.5">Validation Error</span>
              <span>{error}</span>
            </div>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                placeholder="e.g. Enterprise ASIC"
                className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-purple-900/40 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#7A56D6]"
              />
            </div>

            <div>
              <label className="block font-semibold uppercase text-gray-300 mb-1">
                Badge / Tag
              </label>
              <input
                type="text"
                name="tag"
                value={formData.tag}
                onChange={handleChange}
                placeholder="e.g. Most Popular"
                className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-purple-900/40 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#7A56D6]"
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
              placeholder="Enterprise compute cluster provisioned across Tier-4 climate-controlled facilities."
              className="w-full px-3.5 py-2 rounded-xl bg-white/[0.04] border border-purple-900/40 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#7A56D6]"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block font-semibold uppercase text-gray-300 mb-1">
                Price (₹ INR) *
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                name="price"
                required
                value={formData.price}
                onChange={handleChange}
                placeholder="1000.00"
                className="w-full px-3.5 py-2 rounded-xl bg-white/[0.04] border border-purple-900/40 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#7A56D6]"
              />
            </div>

            <div>
              <label className="block font-semibold uppercase text-gray-300 mb-1">
                Duration (Days) *
              </label>
              <input
                type="number"
                min="1"
                step="1"
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
                Daily Rate (Decimal)
              </label>
              <input
                type="number"
                step="0.001"
                min="0"
                name="dailyRoiRate"
                value={formData.dailyRoiRate}
                onChange={handleChange}
                placeholder="0.015 (1.5%/day)"
                className="w-full px-3.5 py-2 rounded-xl bg-white/[0.04] border border-purple-900/40 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#7A56D6]"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold uppercase text-gray-300 mb-1">
                Hash Rate
              </label>
              <input
                type="text"
                name="hashRate"
                value={formData.hashRate}
                onChange={handleChange}
                placeholder="e.g. 70 MH/s or 50 TH/s"
                className="w-full px-3.5 py-2 rounded-xl bg-white/[0.04] border border-purple-900/40 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#7A56D6]"
              />
            </div>

            <div>
              <label className="block font-semibold uppercase text-gray-300 mb-1">
                Catalog Sort Order
              </label>
              <input
                type="number"
                name="sortOrder"
                value={formData.sortOrder}
                onChange={handleChange}
                placeholder="0"
                className="w-full px-3.5 py-2 rounded-xl bg-white/[0.04] border border-purple-900/40 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#7A56D6]"
              />
            </div>
          </div>

          <div>
            <label className="block font-semibold uppercase text-gray-300 mb-1">
              Features (One per line)
            </label>
            <textarea
              name="featuresText"
              rows={3}
              value={formData.featuresText}
              onChange={handleChange}
              placeholder="Dedicated Tier-4 Compute Slot&#10;Daily Automated Yield Settlement&#10;24/7 Node Uptime Guarantee"
              className="w-full px-3.5 py-2 rounded-xl bg-white/[0.04] border border-purple-900/40 text-white font-mono text-[11px] placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#7A56D6]"
            />
          </div>

          {/* Active Status Checkbox */}
          <div className="pt-2">
            <label className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/10 cursor-pointer hover:bg-white/[0.04] transition-colors">
              <input
                type="checkbox"
                name="isActive"
                checked={formData.isActive}
                onChange={handleChange}
                className="w-4 h-4 rounded text-[#7A56D6] focus:ring-[#7A56D6] bg-black/40 border-purple-800"
              />
              <div>
                <span className="font-semibold text-white block">
                  {formData.isActive ? 'Active Plan (Visible in Public Catalog)' : 'Deactivated Plan (Hidden from Public Catalog)'}
                </span>
                <span className="text-[11px] text-gray-400">
                  {formData.isActive
                    ? 'Available for user purchase through UPI and internal wallet.'
                    : 'Deactivated plans cannot be purchased. Existing subscriptions remain untouched.'}
                </span>
              </div>
            </label>
          </div>

          {/* Footer Actions */}
          <div className="pt-4 border-t border-white/10 flex items-center justify-end gap-3">
            <Button
              type="button"
              onClick={onClose}
              variant="ghost"
              size="md"
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Saving...
                </span>
              ) : isEditMode ? (
                'Save Plan Changes'
              ) : (
                'Create Plan'
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default AdminPlanFormModal;
