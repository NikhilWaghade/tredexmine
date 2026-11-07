/**
 * Financial Alert Service
 *
 * Provides structured logging and webhook alert dispatch for financial operations
 * that are quarantined due to ledger indeterminacy or integrity risks.
 *
 * Security & Reliability Controls:
 * 1. Data Minimization: Strips out all unmasked bank account numbers, UPI IDs, and auth tokens.
 * 2. Alert Storm Prevention: Relies on metadata.quarantineAlertDispatched to ensure only
 *    one alert is sent per quarantined operation, regardless of reconciliation retry frequency.
 * 3. Graceful Fallback: When no external webhook URL is configured, emits a structured JSON
 *    log for ingestion by log aggregation systems (Datadog, CloudWatch, ELK, etc.).
 */

/**
 * Dispatches an alert when a financial operation is quarantined for manual review
 * @param {Object} docOrParams - Withdrawal document or parameter object
 * @param {string} [reasonArg] - Diagnostic explanation for quarantine
 * @param {Object} [optionsArg={}]
 * @returns {Promise<{ dispatched: boolean, channel: string, reason?: string }>}
 */
export const dispatchQuarantineAlert = async (docOrParams, reasonArg, optionsArg = {}) => {
  if (!docOrParams) {
    return { dispatched: false, channel: 'none' };
  }

  let withdrawal = docOrParams;
  let reason = reasonArg;
  let options = optionsArg;

  if (docOrParams.withdrawal) {
    withdrawal = docOrParams.withdrawal;
    reason = docOrParams.reason || reasonArg;
    options = docOrParams.options || optionsArg;
  }

  // Deduplication guard: Never dispatch duplicate alerts for the same withdrawal
  if (withdrawal.metadata?.quarantineAlertDispatched === true) {
    return { dispatched: false, channel: 'suppressed_duplicate', reason: 'ALREADY_DISPATCHED' };
  }

  // Mark document metadata to prevent future alert storms
  if (!withdrawal.metadata) {
    withdrawal.metadata = {};
  }
  withdrawal.metadata.quarantineAlertDispatched = true;
  withdrawal.metadata.quarantineAlertDispatchedAt = new Date();

  // Construct sanitized alert payload
  const alertPayload = {
    event: 'FINANCIAL_OPERATION_QUARANTINED',
    severity: 'HIGH',
    timestamp: new Date().toISOString(),
    withdrawalId: String(withdrawal._id),
    withdrawalReference: withdrawal.withdrawalReference,
    amount: withdrawal.amount,
    currency: withdrawal.currency || 'INR',
    status: withdrawal.status,
    userId: String(withdrawal.user?._id || withdrawal.user),
    diagnosticReason: String(reason || withdrawal.metadata?.reconciliationReason || 'Uncertain ledger outcome'),
    payoutMethod: withdrawal.payoutMethod,
    maskedIdentifier: withdrawal.payoutDetails?.maskedIdentifier || '******',
  };

  const webhookUrl = process.env.FINANCIAL_ALERT_WEBHOOK_URL;

  if (!options.logOnly && webhookUrl && typeof webhookUrl === 'string' && webhookUrl.startsWith('http')) {
    try {
      // Fire-and-forget timeout-bounded fetch to avoid blocking critical path
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(alertPayload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        return { dispatched: true, channel: 'webhook' };
      }
      console.warn(`[FinancialAlert] Webhook returned status ${response.status}. Falling back to structured log.`);
    } catch (err) {
      console.warn(`[FinancialAlert] Webhook dispatch failed (${err.message}). Falling back to structured log.`);
    }
  }

  // Fallback: Structured stdout logging for log shippers
  console.warn(`[FINANCIAL_ALERT] ${JSON.stringify(alertPayload)}`);
  return { dispatched: true, channel: 'structured_log' };
};

export default {
  dispatchQuarantineAlert,
};
