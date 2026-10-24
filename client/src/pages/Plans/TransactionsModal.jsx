import { useState, useEffect, useCallback } from 'react';
import { walletService } from '../../services';
import { Button } from '../../components/common';

export function TransactionsModal({ isOpen, onClose }) {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const reloadTransactions = useCallback(() => {
    setLoading(true);
    setError(null);
    walletService
      .getTransactions()
      .then((data) => {
        setTransactions(data.success && Array.isArray(data.transactions) ? data.transactions : []);
      })
      .catch((err) => {
        setError(
          err.response?.data?.message ||
            'Failed to load transaction history. Please verify your connection.'
        );
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    let isMounted = true;
    if (!isOpen) return;

    walletService
      .getTransactions()
      .then((data) => {
        if (isMounted) {
          setTransactions(data.success && Array.isArray(data.transactions) ? data.transactions : []);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (isMounted) {
          setError(
            err.response?.data?.message ||
              'Failed to load transaction history. Please verify your connection.'
          );
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen]);


  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
      {/* Backdrop */}
      <div className="fixed inset-0" onClick={onClose} aria-hidden="true" />

      {/* Modal Card */}
      <div className="relative w-full max-w-2xl rounded-2xl bg-[#0e081e] border border-purple-900/60 p-6 sm:p-8 shadow-2xl shadow-purple-950/80 z-10 max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-white/10 mb-5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-purple-950/80 border border-purple-800/50 flex items-center justify-center text-[#7A56D6]">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
              </svg>
            </div>
            <div>
              <h3 className="text-xl font-bold text-white tracking-tight">
                Wallet Transaction Ledger
              </h3>
              <p className="text-xs text-gray-400">
                Authoritative record of all debits, credits, and plan purchases
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white p-2 rounded-lg hover:bg-white/5 transition-colors focus:outline-none"
            aria-label="Close transaction ledger modal"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content Body */}
        <div className="overflow-y-auto flex-1 pr-1 space-y-3">
          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-3 text-gray-400">
              <svg className="animate-spin w-7 h-7 text-[#7A56D6]" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              <span className="text-xs">Fetching verified transaction history...</span>
            </div>
          ) : error ? (
            <div className="p-4 rounded-xl bg-rose-950/60 border border-rose-800/60 text-rose-200 text-xs text-center">
              <p className="mb-3">{error}</p>
              <Button onClick={reloadTransactions} variant="outline" size="sm">
                Retry
              </Button>
            </div>
          ) : transactions.length === 0 ? (
            <div className="py-12 text-center text-gray-400">
              <p className="text-sm font-medium text-white mb-1">No Transactions Recorded</p>
              <p className="text-xs">
                Your wallet has not initiated any debits or credits yet.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {transactions.map((tx) => {
                const isDebit = tx.type === 'debit';
                const createdDate = new Date(tx.createdAt);

                return (
                  <div
                    key={tx._id}
                    className="p-3.5 rounded-xl bg-white/[0.02] border border-white/5 hover:border-purple-900/40 transition-colors flex items-center justify-between gap-4 text-xs"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs ${
                          isDebit
                            ? 'bg-rose-950/60 text-rose-300 border border-rose-800/40'
                            : 'bg-emerald-950/60 text-emerald-300 border border-emerald-800/40'
                        }`}
                      >
                        {isDebit ? '↓' : '↑'}
                      </div>
                      <div>
                        <span className="font-semibold text-white block">
                          {tx.description || (isDebit ? 'Plan Purchase' : 'Deposit')}
                        </span>
                        <div className="flex items-center gap-2 text-[11px] text-gray-400">
                          <span>{createdDate.toLocaleString()}</span>
                          {tx.reference && (
                            <span
                              className="text-gray-500 font-mono text-[10px]"
                              title={`Reference: ${tx.reference}`}
                            >
                              Ref: {tx.reference.length > 12 ? `${tx.reference.substring(0, 10)}...` : tx.reference}
                            </span>
                          )}
                          {tx.balanceAfter != null && (
                            <span
                              className="text-gray-500 font-mono text-[10px]"
                              title={`Balance after transaction: ₹${tx.balanceAfter}`}
                            >
                              Bal: ₹{Number(tx.balanceAfter).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="text-right">
                      <span
                        className={`font-mono font-bold block ${
                          isDebit ? 'text-rose-400' : 'text-emerald-400'
                        }`}
                      >
                        {isDebit ? '-' : '+'}₹{Number(tx.amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                      <span className="text-[10px] uppercase font-semibold text-gray-500">
                        {tx.status}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="pt-4 border-t border-white/10 flex items-center justify-between mt-4">
          <Button onClick={reloadTransactions} variant="ghost" size="sm" className="text-xs">
            Refresh Ledger
          </Button>

          <Button onClick={onClose} variant="primary" size="sm">
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

export default TransactionsModal;
