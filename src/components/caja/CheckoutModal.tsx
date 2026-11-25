import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Banknote,
  CheckCircle2,
  CreditCard,
  Plus,
  Smartphone,
  Trash2,
  X,
} from 'lucide-react';
import {
  bsToUsd,
  calculateOrderBreakdown,
  calculatePaymentSummary,
  createPaymentEntry,
  getMethodCurrency,
  usdToBs,
} from '../../domain/currency';
import { usePos } from '../../store/PosProvider';
import type { Order, PaymentEntry, PaymentMethod } from '../../types/pos';

interface CheckoutModalProps {
  order: Order;
  onClose: () => void;
  onSettled?: (closedOrder: Order) => void;
}

const METHOD_META: ReadonlyArray<{
  method: PaymentMethod;
  label: string;
  currencyLabel: 'USD' | 'Bs';
  needsReference: boolean;
}> = [
  { method: 'zelle', label: 'Zelle', currencyLabel: 'USD', needsReference: true },
  {
    method: 'efectivo_usd',
    label: 'Dólares en efectivo',
    currencyLabel: 'USD',
    needsReference: false,
  },
  {
    method: 'debito_punto',
    label: 'Tarjeta de débito / Punto de venta',
    currencyLabel: 'Bs',
    needsReference: true,
  },
  {
    method: 'efectivo_bs',
    label: 'Bolívares en efectivo',
    currencyLabel: 'Bs',
    needsReference: false,
  },
];

const METHOD_LABEL_MAP: Record<PaymentMethod, string> = {
  zelle: 'Zelle',
  efectivo_usd: 'Dólares en efectivo',
  debito_punto: 'Tarjeta de débito / Punto de venta',
  efectivo_bs: 'Bolívares en efectivo',
};

function renderMethodIcon(method: PaymentMethod) {
  switch (method) {
    case 'zelle':
      return <Smartphone className="h-4 w-4 shrink-0" aria-hidden="true" />;
    case 'debito_punto':
      return <CreditCard className="h-4 w-4 shrink-0" aria-hidden="true" />;
    case 'efectivo_usd':
    case 'efectivo_bs':
      return <Banknote className="h-4 w-4 shrink-0" aria-hidden="true" />;
  }
}

export function CheckoutModal({ order, onClose, onSettled }: CheckoutModalProps) {
  const { state, settleOrder } = usePos();
  const rate = state.settings.exchangeRate;
  const breakdown = useMemo(
    () => calculateOrderBreakdown(order.items, rate),
    [order.items, rate],
  );
  const totalUsd = breakdown.totalUsd;

  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod>('zelle');
  const [amountInput, setAmountInput] = useState<string>('');
  const [referenceInput, setReferenceInput] = useState<string>('');
  const [payments, setPayments] = useState<PaymentEntry[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const summary = useMemo(
    () => calculatePaymentSummary(totalUsd, payments, rate),
    [payments, rate, totalUsd],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isSubmitting) {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isSubmitting, onClose]);

  const selectedCurrency = getMethodCurrency(selectedMethod);
  const parsedAmount = Number(amountInput.replace(',', '.'));
  const livePreviewEquivalent = useMemo(() => {
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return null;
    }
    if (selectedCurrency === 'VES') {
      return `Equivalente: $${bsToUsd(parsedAmount, rate).toFixed(2)} USD`;
    }
    return `Equivalente: Bs ${usdToBs(parsedAmount, rate).toFixed(2)}`;
  }, [parsedAmount, rate, selectedCurrency]);

  const handleSelectMethod = (method: PaymentMethod) => {
    setSelectedMethod(method);
    setAmountInput('');
    setReferenceInput('');
    setErrorMessage(null);
  };

  const handleFillRemaining = () => {
    setErrorMessage(null);
    const fillValue =
      selectedCurrency === 'USD' ? summary.remainingUsd : summary.remainingBs;
    if (fillValue <= 0) {
      setAmountInput('0.00');
      return;
    }
    setAmountInput(fillValue.toFixed(2));
  };

  const handleAddPayment = () => {
    setErrorMessage(null);
    const numeric = Number(amountInput.replace(',', '.'));
    if (!Number.isFinite(numeric) || numeric <= 0) {
      setErrorMessage('Ingresa un monto válido mayor a 0.');
      return;
    }

    const entry = createPaymentEntry({
      id: `pay-${Date.now()}-${payments.length + 1}`,
      method: selectedMethod,
      amountNative: numeric,
      exchangeRate: rate,
      reference: referenceInput.trim() || undefined,
      paidAt: new Date().toISOString(),
    });

    setPayments((prev) => [...prev, entry]);
    setAmountInput('');
    setReferenceInput('');
  };

  const handleRemovePayment = (paymentId: string) => {
    setErrorMessage(null);
    setPayments((prev) => prev.filter((p) => p.id !== paymentId));
  };

  const handleConfirmCheckout = async () => {
    if (!summary.isSettled || isSubmitting) {
      return;
    }
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const closedOrder = await settleOrder(order.id, payments);
      onSettled?.(closedOrder);
      onClose();
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'No se pudo completar el cobro.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const currentMeta = METHOD_META.find((m) => m.method === selectedMethod)!;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="checkout-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <div className="w-full max-w-2xl bg-[#FAF8F4] text-[#0F2A36] border border-[#E5DFD3] rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-5 py-4 bg-[#F2EDE4] border-b border-[#E5DFD3] flex items-center justify-between gap-3">
          <div>
            <h2 id="checkout-modal-title" className="text-lg font-extrabold text-[#0F2A36]">
              Cobrar y cerrar · {order.locationLabel}
            </h2>
            <p className="text-xs font-medium text-[#0F2A36]/70 tabular-nums">
              Tasa BCV: 1 USD = {rate.toFixed(2)} Bs · Incluye IVA (16%)
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Cerrar cobro"
            className="min-h-12 min-w-12 rounded-xl border border-[#E5DFD3] bg-white hover:bg-[#FAF8F4] flex items-center justify-center text-[#0F2A36] cursor-pointer"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-5">
          {/* Total Summary with Subtotal + IVA 16% */}
          <div className="bg-white border border-[#E5DFD3] rounded-2xl p-4 space-y-3">
            <div className="grid grid-cols-2 gap-2 text-xs font-semibold text-[#0F2A36]/75 tabular-nums pb-2.5 border-b border-[#E5DFD3]">
              <div>
                <span>Subtotal productos: </span>
                <strong className="text-[#0F2A36]">${breakdown.subtotalUsd.toFixed(2)}</strong>
              </div>
              <div className="text-right">
                <span>IVA ({Math.round(breakdown.ivaRate * 100)}%): </span>
                <strong className="text-[#0F2A36]">${breakdown.ivaUsd.toFixed(2)}</strong>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <p className="text-xs font-semibold text-[#0F2A36]/70">Total a cobrar USD</p>
                <p className="text-3xl font-extrabold text-[#0F2A36] tabular-nums">
                  ${summary.totalUsd.toFixed(2)}
                </p>
              </div>
              <div className="sm:text-right">
                <p className="text-xs font-semibold text-[#0F2A36]/70">Total a cobrar en Bolívares</p>
                <p className="text-2xl font-extrabold text-[#0E7490] tabular-nums">
                  Bs {summary.totalBs.toFixed(2)}
                </p>
              </div>
            </div>
          </div>

          {/* Method Picker */}
          <section className="space-y-2.5">
            <h3 className="text-sm font-bold text-[#0F2A36]">
              Método de pago (soporta pagos combinados)
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {METHOD_META.map((item) => {
                const active = selectedMethod === item.method;
                return (
                  <button
                    key={item.method}
                    type="button"
                    aria-pressed={active}
                    onClick={() => handleSelectMethod(item.method)}
                    className={`min-h-12 px-3.5 py-2.5 rounded-xl border text-left flex items-center justify-between gap-2 text-sm font-bold transition-colors cursor-pointer ${
                      active
                        ? 'bg-[#0E7490] border-[#0E7490] text-white'
                        : 'bg-white border-[#E5DFD3] text-[#0F2A36] hover:bg-[#F2EDE4]'
                    }`}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      {renderMethodIcon(item.method)}
                      <span className="truncate">{item.label}</span>
                    </span>
                    <span
                      className={`shrink-0 px-2 py-0.5 rounded-md text-xs font-bold ${
                        active ? 'bg-white/20 text-white' : 'bg-[#F2EDE4] text-[#0F2A36]'
                      }`}
                    >
                      {item.currencyLabel}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Amount entry form */}
          <div className="bg-white border border-[#E5DFD3] rounded-2xl p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="checkout-amount-input"
                  className="block text-xs font-bold text-[#0F2A36] mb-1"
                >
                  Monto ({currentMeta.currencyLabel})
                </label>
                <input
                  id="checkout-amount-input"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                  placeholder={selectedCurrency === 'USD' ? '0.00' : '0.00'}
                  className="w-full min-h-12 px-3.5 rounded-xl border border-[#E5DFD3] bg-[#FAF8F4] text-base font-bold text-[#0F2A36] tabular-nums focus:outline-2 focus:outline-[#0E7490]"
                />
                {livePreviewEquivalent && (
                  <p className="mt-1 text-xs font-semibold text-[#0E7490] tabular-nums">
                    {livePreviewEquivalent}
                  </p>
                )}
              </div>

              {currentMeta.needsReference && (
                <div>
                  <label
                    htmlFor="checkout-ref-input"
                    className="block text-xs font-bold text-[#0F2A36] mb-1"
                  >
                    Referencia (opcional)
                  </label>
                  <input
                    id="checkout-ref-input"
                    type="text"
                    value={referenceInput}
                    onChange={(e) => setReferenceInput(e.target.value)}
                    placeholder="Últimos dígitos / confirmación"
                    className="w-full min-h-12 px-3.5 rounded-xl border border-[#E5DFD3] bg-[#FAF8F4] text-sm font-medium text-[#0F2A36] focus:outline-2 focus:outline-[#0E7490]"
                  />
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={handleFillRemaining}
                disabled={summary.remainingUsd <= 0}
                className="min-h-12 px-4 rounded-xl border border-[#0E7490]/35 bg-[#0E7490]/10 hover:bg-[#0E7490]/20 disabled:opacity-50 text-xs sm:text-sm font-bold text-[#0E7490] tabular-nums cursor-pointer disabled:cursor-not-allowed"
              >
                Pagar restante (
                {selectedCurrency === 'USD'
                  ? `$${summary.remainingUsd.toFixed(2)}`
                  : `Bs ${summary.remainingBs.toFixed(2)}`}
                )
              </button>

              <button
                type="button"
                onClick={handleAddPayment}
                className="min-h-12 px-4 rounded-xl bg-[#0E7490] hover:bg-[#0B5E75] text-white text-sm font-bold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                <span>Agregar pago</span>
              </button>
            </div>
          </div>

          {/* Payments registered */}
          {payments.length > 0 && (
            <section className="bg-white border border-[#E5DFD3] rounded-2xl overflow-hidden">
              <div className="px-4 py-2.5 bg-[#F2EDE4] border-b border-[#E5DFD3] flex items-center justify-between">
                <h3 className="text-xs font-bold text-[#0F2A36]">
                  Pagos registrados ({payments.length})
                </h3>
                <span className="text-xs font-bold text-[#0F2A36] tabular-nums">
                  Pagado: ${summary.paidUsd.toFixed(2)} · Bs {summary.paidBs.toFixed(2)}
                </span>
              </div>
              <ul className="divide-y divide-[#E5DFD3]">
                {payments.map((entry) => (
                  <li
                    key={entry.id}
                    className="px-4 py-3 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-[#0F2A36]">
                        {METHOD_LABEL_MAP[entry.method]}
                      </p>
                      <p className="text-xs font-medium text-[#0F2A36]/75 tabular-nums">
                        {entry.currency === 'USD'
                          ? `$${entry.amountNative.toFixed(2)} USD (Bs ${entry.amountBs.toFixed(2)})`
                          : `Bs ${entry.amountNative.toFixed(2)} ($${entry.amountUsd.toFixed(2)} USD)`}
                        {entry.reference ? ` · Ref: ${entry.reference}` : ''}
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label={`Eliminar pago ${METHOD_LABEL_MAP[entry.method]}`}
                      onClick={() => handleRemovePayment(entry.id)}
                      className="min-h-12 min-w-12 rounded-xl border border-[#E5DFD3] hover:bg-red-50 text-[#B91C1C] flex items-center justify-center cursor-pointer"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Live Remaining or Estimated Change */}
          {!summary.isSettled ? (
            <div className="rounded-2xl border border-[#B45309]/35 bg-[#B45309]/10 p-4 flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-bold text-[#92400E]">Restante por cubrir</span>
              <span className="text-lg font-extrabold text-[#92400E] tabular-nums">
                ${summary.remainingUsd.toFixed(2)} · Bs {summary.remainingBs.toFixed(2)}
              </span>
            </div>
          ) : (
            <div className="rounded-2xl border border-[#047857]/35 bg-[#047857]/10 p-4 space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-sm font-bold text-[#047857]">
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  <span>Cuenta cubierta</span>
                </span>
                <span className="text-sm font-extrabold text-[#047857] tabular-nums">
                  Pagado: ${summary.paidUsd.toFixed(2)}
                </span>
              </div>
              {summary.changeUsd > 0 && (
                <div className="pt-1.5 border-t border-[#047857]/20 flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="font-semibold text-[#0F2A36]">
                    Vuelto estimado (referencia visual)
                  </span>
                  <span className="font-extrabold text-[#0F2A36] tabular-nums">
                    ${summary.changeUsd.toFixed(2)} · Bs {summary.changeBs.toFixed(2)}
                  </span>
                </div>
              )}
            </div>
          )}

          {errorMessage && (
            <p
              role="alert"
              className="text-sm font-semibold text-[#B91C1C] flex items-center gap-1.5"
            >
              <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{errorMessage}</span>
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 bg-[#F2EDE4] border-t border-[#E5DFD3] flex flex-wrap items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="min-h-12 px-5 rounded-xl border border-[#E5DFD3] bg-white hover:bg-[#FAF8F4] text-sm font-bold text-[#0F2A36] cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={!summary.isSettled || isSubmitting}
            onClick={() => void handleConfirmCheckout()}
            className="min-h-12 px-5 rounded-xl bg-[#047857] hover:bg-[#065F46] disabled:bg-[#0F2A36]/25 disabled:text-white/80 text-white text-sm font-bold inline-flex items-center gap-2 cursor-pointer disabled:cursor-not-allowed"
          >
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            <span>Confirmar Cobro y Cerrar</span>
          </button>
        </div>
      </div>
    </div>
  );
}
