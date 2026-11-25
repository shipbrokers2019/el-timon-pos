import { useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Play,
  Printer,
} from 'lucide-react';
import { roundMoney, summarizePaymentsByMethod } from '../../domain/currency';
import { formatTicketText } from '../../domain/escpos';
import { usePos } from '../../store/PosProvider';
import type { PaymentMethod, PrintJob, Shift } from '../../types/pos';

const PAYMENT_METHOD_ROWS: ReadonlyArray<{ method: PaymentMethod; label: string }> = [
  { method: 'zelle', label: 'Zelle' },
  { method: 'efectivo_usd', label: 'Dólares en efectivo' },
  { method: 'debito_punto', label: 'Débito / Punto de venta' },
  { method: 'efectivo_bs', label: 'Bolívares en efectivo' },
];

function formatDateTime(iso?: string): string {
  if (!iso) {
    return '—';
  }
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return iso;
  }
  return parsed.toLocaleString('es-VE', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

export function CashCloseView() {
  const { state, closeShift, openShift, reprintJob } = usePos();
  const [notes, setNotes] = useState('');
  const [isClosing, setIsClosing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  const activeShift = useMemo(
    () => state.shifts.find((s) => s.status === 'abierto') ?? null,
    [state.shifts],
  );

  const closedShifts = useMemo(
    () =>
      state.shifts
        .filter((s) => s.status === 'cerrado')
        .slice()
        .sort((a, b) => Date.parse(b.closedAt ?? '') - Date.parse(a.closedAt ?? '')),
    [state.shifts],
  );

  const openLocations = useMemo(
    () => state.locations.filter((loc) => loc.status !== 'libre'),
    [state.locations],
  );

  const activeShiftMetrics = useMemo(() => {
    if (!activeShift) {
      return null;
    }
    const shiftOrders = state.orders.filter(
      (order) => order.status === 'cerrada' && order.shiftId === activeShift.id,
    );
    const totalSalesUsd = roundMoney(
      shiftOrders.reduce((sum, order) => sum + order.totalUsd, 0),
    );
    const totalSalesBs = roundMoney(
      shiftOrders.reduce((sum, order) => sum + order.totalBs, 0),
    );
    const ordersCount = shiftOrders.length;
    const avgTicketUsd = ordersCount > 0 ? roundMoney(totalSalesUsd / ordersCount) : 0;
    const totalsByMethod = summarizePaymentsByMethod(shiftOrders);

    return {
      totalSalesUsd,
      totalSalesBs,
      ordersCount,
      avgTicketUsd,
      totalsByMethod,
    };
  }, [activeShift, state.orders]);

  const userNameById = useMemo(
    () => new Map(state.users.map((u) => [u.id, u.name])),
    [state.users],
  );

  const handleCloseShift = async () => {
    if (!activeShift || isClosing) {
      return;
    }
    setIsClosing(true);
    setErrorMessage(null);
    setFeedbackMessage(null);
    try {
      await closeShift(notes.trim() || undefined);
      await openShift();
      setNotes('');
      setFeedbackMessage('Turno cerrado, ticket 80mm generado y nuevo turno abierto.');
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'No se pudo cerrar el turno.',
      );
    } finally {
      setIsClosing(false);
    }
  };

  const handleOpenShift = async () => {
    setErrorMessage(null);
    try {
      await openShift();
      setFeedbackMessage('Nuevo turno abierto.');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'No se pudo abrir el turno.');
    }
  };

  const handleReprintShift = (shift: Shift) => {
    const existing = state.printJobs.find(
      (job) => job.type === 'cierre' && job.referenceId === shift.id,
    );
    if (existing) {
      void reprintJob(existing);
      return;
    }
    const closedByName =
      (shift.closedBy ? userNameById.get(shift.closedBy) : undefined) ??
      shift.closedBy ??
      'Administrador';
    const fallbackJob: PrintJob = {
      id: `pj-cierre-${shift.id}`,
      type: 'cierre',
      referenceId: shift.id,
      title: `Cierre de Turno · ${shift.id}`,
      textPreview: formatTicketText({
        type: 'cierre',
        restaurantName: state.settings.printer.restaurantName,
        shift,
        closedByName,
        timestampIso: shift.closedAt ?? new Date().toISOString(),
      }),
      status: 'pending',
      createdAt: shift.closedAt ?? new Date().toISOString(),
    };
    void reprintJob(fallbackJob);
  };

  return (
    <div className="space-y-6">
      {/* Warning if open locations exist */}
      {openLocations.length > 0 && (
        <div
          role="status"
          className="p-4 rounded-2xl bg-[#B45309]/10 border border-[#B45309]/40 text-[#92400E] flex items-start gap-3"
        >
          <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5 text-[#B45309]" aria-hidden="true" />
          <div className="text-sm">
            <p className="font-bold">
              Hay {openLocations.length} ubicación(es) con cuenta abierta antes del cierre
            </p>
            <p className="mt-0.5 text-xs font-medium">
              Abiertas actualmente: {openLocations.map((l) => l.label).join(', ')}. Cierra y cobra esas cuentas si pertenecen a este turno.
            </p>
          </div>
        </div>
      )}

      {/* Active shift card */}
      <section className="bg-white border border-[#E5DFD3] rounded-2xl overflow-hidden">
        <div className="px-5 py-4 bg-[#F2EDE4] border-b border-[#E5DFD3] flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-extrabold text-[#0F2A36]">
              Cierre de Caja por Ventas
            </h2>
            <p className="text-xs font-medium text-[#0F2A36]/75">
              {activeShift
                ? `Turno activo abierto el ${formatDateTime(activeShift.openedAt)}`
                : 'No hay turno activo en este momento'}
            </p>
          </div>

          {activeShift ? (
            <span className="inline-flex items-center px-3 py-1 rounded-full bg-[#047857] text-white text-xs font-bold">
              Turno abierto
            </span>
          ) : (
            <button
              type="button"
              onClick={() => void handleOpenShift()}
              className="min-h-12 px-4 rounded-xl bg-[#0E7490] hover:bg-[#0B5E75] text-white text-sm font-bold inline-flex items-center gap-2 cursor-pointer"
            >
              <Play className="h-4 w-4" aria-hidden="true" />
              <span>Abrir nuevo turno</span>
            </button>
          )}
        </div>

        {activeShift && activeShiftMetrics && (
          <div className="p-5 space-y-5">
            {/* Summary metrics strip */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-4 rounded-xl bg-[#FAF8F4] border border-[#E5DFD3]">
                <p className="text-xs font-semibold text-[#0F2A36]/70">Ventas del turno</p>
                <p className="mt-1 text-2xl font-extrabold text-[#0F2A36] tabular-nums">
                  ${activeShiftMetrics.totalSalesUsd.toFixed(2)}
                </p>
                <p className="text-xs font-semibold text-[#0E7490] tabular-nums">
                  Bs {activeShiftMetrics.totalSalesBs.toFixed(2)}
                </p>
              </div>

              <div className="p-4 rounded-xl bg-[#FAF8F4] border border-[#E5DFD3]">
                <p className="text-xs font-semibold text-[#0F2A36]/70">Cuentas cerradas</p>
                <p className="mt-1 text-2xl font-extrabold text-[#0F2A36] tabular-nums">
                  {activeShiftMetrics.ordersCount}
                </p>
              </div>

              <div className="p-4 rounded-xl bg-[#FAF8F4] border border-[#E5DFD3]">
                <p className="text-xs font-semibold text-[#0F2A36]/70">Ticket promedio</p>
                <p className="mt-1 text-2xl font-extrabold text-[#0F2A36] tabular-nums">
                  ${activeShiftMetrics.avgTicketUsd.toFixed(2)}
                </p>
              </div>
            </div>

            {/* 4 Payment Methods Breakdown Table */}
            <div className="overflow-x-auto border border-[#E5DFD3] rounded-xl">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#F2EDE4] border-b border-[#E5DFD3] text-xs font-bold text-[#0F2A36]">
                    <th className="py-3 px-4">Método de pago</th>
                    <th className="py-3 px-4 text-right">Operaciones</th>
                    <th className="py-3 px-4 text-right">Total USD</th>
                    <th className="py-3 px-4 text-right">Total Bs</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5DFD3] text-sm">
                  {PAYMENT_METHOD_ROWS.map(({ method, label }) => {
                    const bucket = activeShiftMetrics.totalsByMethod[method];
                    return (
                      <tr key={method} className="hover:bg-[#FAF8F4]">
                        <td className="py-3 px-4 font-bold text-[#0F2A36]">{label}</td>
                        <td className="py-3 px-4 text-right font-semibold text-[#0F2A36]/80 tabular-nums">
                          {bucket.count}
                        </td>
                        <td className="py-3 px-4 text-right font-extrabold text-[#0F2A36] tabular-nums">
                          ${bucket.totalUsd.toFixed(2)}
                        </td>
                        <td className="py-3 px-4 text-right font-bold text-[#0E7490] tabular-nums">
                          Bs {bucket.totalBs.toFixed(2)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Closing Notes & Submit */}
            <div className="space-y-3 pt-2 border-t border-[#E5DFD3]">
              <div>
                <label
                  htmlFor="shift-close-notes"
                  className="block text-xs font-bold text-[#0F2A36] mb-1"
                >
                  Notas de cierre (opcional)
                </label>
                <textarea
                  id="shift-close-notes"
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Observaciones del turno..."
                  className="w-full p-3 rounded-xl border border-[#E5DFD3] bg-[#FAF8F4] text-sm text-[#0F2A36] focus:outline-2 focus:outline-[#0E7490]"
                />
              </div>

              {errorMessage && (
                <p
                  role="alert"
                  className="text-sm font-semibold text-[#B91C1C] flex items-center gap-1.5"
                >
                  <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{errorMessage}</span>
                </p>
              )}

              {feedbackMessage && (
                <p
                  role="status"
                  className="text-sm font-semibold text-[#047857] flex items-center gap-1.5"
                >
                  <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{feedbackMessage}</span>
                </p>
              )}

              <div className="flex justify-end">
                <button
                  type="button"
                  disabled={isClosing}
                  onClick={() => void handleCloseShift()}
                  className="min-h-12 px-5 rounded-xl bg-[#0E7490] hover:bg-[#0B5E75] disabled:opacity-50 text-white text-sm font-bold inline-flex items-center gap-2 cursor-pointer"
                >
                  <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
                  <span>Cerrar Turno e Imprimir 80mm</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Historical closed shifts */}
      <section className="bg-white border border-[#E5DFD3] rounded-2xl overflow-hidden">
        <div className="px-5 py-3.5 bg-[#F2EDE4] border-b border-[#E5DFD3]">
          <h3 className="text-base font-extrabold text-[#0F2A36]">
            Historial de turnos cerrados ({closedShifts.length})
          </h3>
        </div>

        {closedShifts.length === 0 ? (
          <p className="p-5 text-sm font-medium text-[#0F2A36]/70">
            Aún no hay cierres de turno registrados.
          </p>
        ) : (
          <ul className="divide-y divide-[#E5DFD3]">
            {closedShifts.map((shift) => {
              const closedByName =
                (shift.closedBy ? userNameById.get(shift.closedBy) : undefined) ??
                shift.closedBy ??
                'Admin';
              return (
                <li
                  key={shift.id}
                  className="p-4 flex flex-wrap items-center justify-between gap-3"
                >
                  <div className="space-y-0.5">
                    <p className="text-sm font-extrabold text-[#0F2A36] tabular-nums">
                      Cierre {formatDateTime(shift.closedAt)} · {shift.ordersCount} cuenta(s)
                    </p>
                    <p className="text-xs font-semibold text-[#0F2A36]/75 tabular-nums">
                      Total: <strong className="text-[#0F2A36]">${shift.totalSalesUsd.toFixed(2)}</strong> · Bs{' '}
                      {shift.totalSalesBs.toFixed(2)} · Por {closedByName}
                    </p>
                    {shift.notes && (
                      <p className="text-xs text-[#0F2A36]/65">Nota: {shift.notes}</p>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => handleReprintShift(shift)}
                    className="min-h-12 px-4 rounded-xl border border-[#E5DFD3] bg-[#FAF8F4] hover:bg-[#F2EDE4] text-xs font-bold text-[#0F2A36] inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Printer className="h-4 w-4 text-[#0E7490]" aria-hidden="true" />
                    <span>Reimprimir 80mm</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
