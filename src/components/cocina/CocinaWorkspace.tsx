import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChefHat,
  Clock,
  Flame,
  History,
  Printer,
} from 'lucide-react';
import { formatTicketText } from '../../domain/escpos';
import { usePos } from '../../store/PosProvider';
import type { Comanda, PrintJob, PrintStatus } from '../../types/pos';
import { getElapsedMinutes } from '../timeUtils';

const THIRTY_MINUTES_MS = 30 * 60 * 1000;

const PRINT_STATUS_INFO: Record<PrintStatus, { label: string; className: string }> = {
  printed: { label: 'Impresa', className: 'bg-[#047857]/12 text-[#047857] border-[#047857]/30' },
  printed_locally: {
    label: 'Impresa local',
    className: 'bg-[#0E7490]/12 text-[#0E7490] border-[#0E7490]/30',
  },
  pending: { label: 'Pendiente', className: 'bg-[#B45309]/12 text-[#B45309] border-[#B45309]/30' },
  printing: { label: 'Pendiente', className: 'bg-[#B45309]/12 text-[#B45309] border-[#B45309]/30' },
  failed: { label: 'Error impresora', className: 'bg-[#B91C1C]/12 text-[#B91C1C] border-[#B91C1C]/30' },
};

function getTimerPillClass(minutes: number): string {
  if (minutes > 20) {
    return 'bg-[#B91C1C] text-white';
  }
  if (minutes >= 10) {
    return 'bg-[#B45309] text-white';
  }
  return 'bg-[#047857] text-white';
}

export function CocinaWorkspace() {
  const { state, updateComandaStatus, reprintJob } = usePos();
  const [viewMode, setViewMode] = useState<'cola' | 'historial'>('cola');
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [syncError, setSyncError] = useState<string | null>(null);

  const handleAdvanceStatus = async (comandaId: string, nextStatus: Comanda['status']) => {
    setSyncError(null);
    try {
      await updateComandaStatus(comandaId, nextStatus);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'No se pudo actualizar el estado en la nube.';
      setSyncError(`Error al actualizar comanda: ${message}`);
    }
  };

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, []);

  const activeComandas = useMemo(
    () =>
      state.comandas
        .filter((c) => c.status !== 'lista')
        .sort((a, b) => {
          const timeDiff = Date.parse(a.createdAt) - Date.parse(b.createdAt);
          if (Number.isFinite(timeDiff) && timeDiff !== 0) {
            return timeDiff;
          }
          return a.sequenceNumber - b.sequenceNumber;
        }),
    [state.comandas],
  );

  const recentHistory = useMemo(
    () =>
      state.comandas
        .filter((c) => {
          if (c.status !== 'lista') {
            return false;
          }
          const completedMs = Date.parse(c.completedAt ?? c.updatedAt);
          if (Number.isNaN(completedMs)) {
            return false;
          }
          return nowMs - completedMs <= THIRTY_MINUTES_MS;
        })
        .sort((a, b) => {
          const aMs = Date.parse(a.completedAt ?? a.updatedAt);
          const bMs = Date.parse(b.completedAt ?? b.updatedAt);
          return bMs - aMs;
        }),
    [nowMs, state.comandas],
  );

  const printJobByRefId = useMemo(() => {
    const map = new Map<string, PrintJob>();
    for (const job of state.printJobs) {
      map.set(job.referenceId, job);
    }
    return map;
  }, [state.printJobs]);

  const handleReprint = (comanda: Comanda) => {
    const existing = printJobByRefId.get(comanda.id);
    if (existing) {
      void reprintJob(existing);
      return;
    }

    const restaurantName = state.settings.printer.restaurantName;
    const isVoid = comanda.isVoidAlert === true;
    const fallbackItem = comanda.items[0];
    const textPreview =
      isVoid && fallbackItem
        ? formatTicketText({
            type: 'anulacion',
            restaurantName,
            locationLabel: comanda.locationLabel,
            waiterName: comanda.waiterName,
            item: fallbackItem,
            reason: comanda.voidReason ?? fallbackItem.voidReason ?? '',
            timestampIso: comanda.createdAt,
          })
        : formatTicketText({
            type: 'comanda',
            restaurantName,
            comanda,
          });

    const fallbackJob: PrintJob = {
      id: `pj-${comanda.id}`,
      type: isVoid ? 'anulacion' : 'comanda',
      referenceId: comanda.id,
      title: isVoid
        ? `ANULACIÓN · ${comanda.locationLabel}`
        : `Comanda #${comanda.sequenceNumber} · ${comanda.locationLabel}`,
      textPreview,
      status: comanda.printStatus,
      createdAt: comanda.createdAt,
    };

    void reprintJob(fallbackJob);
  };

  const displayedComandas = viewMode === 'cola' ? activeComandas : recentHistory;

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[#111827] text-white p-4 sm:p-6">
      <div className="max-w-7xl mx-auto space-y-5">
        {/* KDS Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <ChefHat className="h-6 w-6 text-emerald-400" aria-hidden="true" />
            <h1 className="text-xl font-extrabold tracking-tight">
              Pantalla de Cocina (KDS)
            </h1>
          </div>

          <div className="inline-flex gap-2">
            <button
              type="button"
              aria-pressed={viewMode === 'cola'}
              onClick={() => setViewMode('cola')}
              className={`min-h-12 px-4 rounded-xl border text-sm font-bold inline-flex items-center gap-2 transition-colors cursor-pointer ${
                viewMode === 'cola'
                  ? 'bg-[#047857] border-[#047857] text-white'
                  : 'bg-[#1F2937] border-white/15 text-slate-200 hover:bg-[#374151]'
              }`}
            >
              <Flame className="h-4 w-4" aria-hidden="true" />
              <span className="tabular-nums">Cola activa ({activeComandas.length})</span>
            </button>

            <button
              type="button"
              aria-pressed={viewMode === 'historial'}
              onClick={() => setViewMode('historial')}
              className={`min-h-12 px-4 rounded-xl border text-sm font-bold inline-flex items-center gap-2 transition-colors cursor-pointer ${
                viewMode === 'historial'
                  ? 'bg-[#0E7490] border-[#0E7490] text-white'
                  : 'bg-[#1F2937] border-white/15 text-slate-200 hover:bg-[#374151]'
              }`}
            >
              <History className="h-4 w-4" aria-hidden="true" />
              <span className="tabular-nums">Historial (30 min) ({recentHistory.length})</span>
            </button>
          </div>
        </div>

        {/* Sync error alert (if cloud rejects a status update) */}
        {syncError && (
          <div
            role="alert"
            className="rounded-xl border border-red-400/50 bg-red-950/70 px-4 py-3 text-sm font-semibold text-red-100 flex items-center justify-between gap-3"
          >
            <span>{syncError}</span>
            <button
              type="button"
              onClick={() => setSyncError(null)}
              className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-bold cursor-pointer"
            >
              Cerrar
            </button>
          </div>
        )}

        {/* Empty state */}
        {displayedComandas.length === 0 ? (
          <section className="rounded-2xl border border-white/15 bg-[#1F2937] p-8 text-center">
            <p className="text-base font-semibold text-slate-200">
              {viewMode === 'cola'
                ? 'No hay comandas pendientes en cocina.'
                : 'No hay comandas completadas en los últimos 30 minutos.'}
            </p>
          </section>
        ) : (
          <section
            aria-label={viewMode === 'cola' ? 'Cola de comandas activas' : 'Historial de comandas'}
            className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start"
          >
            {displayedComandas.map((comanda) => {
              const elapsedMin = getElapsedMinutes(comanda.createdAt, nowMs);
              const timerClass = getTimerPillClass(elapsedMin);
              const job = printJobByRefId.get(comanda.id);
              const printStatus: PrintStatus = job?.status ?? comanda.printStatus;
              const printInfo = PRINT_STATUS_INFO[printStatus];
              const isVoidAlert = comanda.isVoidAlert === true;

              return (
                <article
                  key={comanda.id}
                  className={`rounded-2xl overflow-hidden shadow-md border ${
                    isVoidAlert
                      ? 'bg-white text-[#0F172A] border-[#B91C1C]'
                      : 'bg-white text-[#0F172A] border-slate-200'
                  }`}
                >
                  {/* Header */}
                  <div
                    className={`px-4 py-3.5 border-b flex items-start justify-between gap-2 ${
                      isVoidAlert
                        ? 'bg-[#B91C1C] text-white border-[#991B1B]'
                        : 'bg-slate-100 text-[#0F172A] border-slate-200'
                    }`}
                  >
                    <div>
                      {isVoidAlert && (
                        <div className="inline-flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wide mb-1">
                          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                          <span>ANULACIÓN — NO PREPARAR</span>
                        </div>
                      )}
                      <h2 className="text-2xl font-extrabold tracking-tight leading-none">
                        {comanda.locationLabel.toUpperCase()}
                      </h2>
                      <p
                        className={`mt-1.5 text-xs font-semibold tabular-nums ${
                          isVoidAlert ? 'text-red-100' : 'text-slate-600'
                        }`}
                      >
                        #{comanda.sequenceNumber} · Ronda {comanda.roundNumber} · {comanda.waiterName}
                      </p>
                    </div>

                    <span
                      className={`shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-extrabold tabular-nums ${
                        isVoidAlert ? 'bg-white text-[#B91C1C]' : timerClass
                      }`}
                    >
                      <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>{elapsedMin} min</span>
                    </span>
                  </div>

                  {/* Items */}
                  <div className="p-4 space-y-3">
                    {isVoidAlert && comanda.voidReason && (
                      <div className="p-3 rounded-xl bg-red-50 border border-[#B91C1C]/30 text-sm font-bold text-[#B91C1C]">
                        Motivo: {comanda.voidReason}
                      </div>
                    )}

                    <ul className="space-y-2.5">
                      {comanda.items.map((item) => (
                        <li
                          key={item.id}
                          className="pb-2.5 border-b border-slate-100 last:border-b-0 last:pb-0"
                        >
                          <p className="text-lg font-extrabold text-[#0F172A] leading-snug">
                            <span className="tabular-nums">{item.quantity}x</span> {item.name}
                          </p>
                          {item.notes.trim().length > 0 && (
                            <p className="mt-1 px-2.5 py-1 rounded-lg bg-amber-50 border border-amber-300 text-sm font-bold text-[#92400E]">
                              {item.notes.trim()}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Footer actions */}
                  <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`inline-flex items-center px-2.5 py-1 rounded-full border text-xs font-bold ${printInfo.className}`}
                      >
                        {printInfo.label}
                      </span>

                      <button
                        type="button"
                        onClick={() => handleReprint(comanda)}
                        className="min-h-12 px-3.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-xs font-bold text-[#0F172A] inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <Printer className="h-4 w-4" aria-hidden="true" />
                        <span>Reimprimir 80mm</span>
                      </button>
                    </div>

                    {viewMode === 'cola' && isVoidAlert && (
                      <button
                        type="button"
                        onClick={() => void handleAdvanceStatus(comanda.id, 'lista')}
                        className="w-full min-h-12 px-4 rounded-xl bg-[#B91C1C] hover:bg-[#991B1B] text-white text-sm font-bold inline-flex items-center justify-center gap-2 cursor-pointer"
                      >
                        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                        <span>Confirmar anulación</span>
                      </button>
                    )}

                    {viewMode === 'cola' && !isVoidAlert && comanda.status === 'pendiente' && (
                      <button
                        type="button"
                        onClick={() => void handleAdvanceStatus(comanda.id, 'en_preparacion')}
                        className="w-full min-h-12 px-4 rounded-xl bg-[#B45309] hover:bg-[#92400E] text-white text-sm font-bold inline-flex items-center justify-center gap-2 cursor-pointer"
                      >
                        <Flame className="h-4 w-4" aria-hidden="true" />
                        <span>En preparación</span>
                      </button>
                    )}

                    {viewMode === 'cola' &&
                      !isVoidAlert &&
                      comanda.status === 'en_preparacion' && (
                        <button
                          type="button"
                          onClick={() => void handleAdvanceStatus(comanda.id, 'lista')}
                          className="w-full min-h-12 px-4 rounded-xl bg-[#047857] hover:bg-[#065F46] text-white text-sm font-bold inline-flex items-center justify-center gap-2 cursor-pointer"
                        >
                          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                          <span>Marcar Listo</span>
                        </button>
                      )}
                  </div>
                </article>
              );
            })}
          </section>
        )}
      </div>
    </main>
  );
}
