import { useMemo, useState } from 'react';
import {
  BarChart3,
  Clock,
  CreditCard,
  Package,
  TrendingDown,
  TrendingUp,
  Umbrella,
  Users,
  UtensilsCrossed,
} from 'lucide-react';
import { computeAnalytics } from '../../domain/analytics';
import { usePos } from '../../store/PosProvider';
import type { PaymentMethod } from '../../types/pos';

type PeriodPreset = 'hoy' | '7d' | '30d' | 'custom';

const PAYMENT_LABELS: ReadonlyArray<{ method: PaymentMethod; label: string }> = [
  { method: 'zelle', label: 'Zelle' },
  { method: 'efectivo_usd', label: 'Dólares en efectivo' },
  { method: 'debito_punto', label: 'Débito / Punto de venta' },
  { method: 'efectivo_bs', label: 'Bolívares en efectivo' },
];

function toLocalDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildRange(
  preset: PeriodPreset,
  customFrom: string,
  customTo: string,
): { fromIso: string; toIso: string } {
  const now = new Date();
  const endOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    23,
    59,
    59,
    999,
  );

  if (preset === 'hoy') {
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      0,
      0,
      0,
      0,
    );
    return { fromIso: startOfToday.toISOString(), toIso: endOfToday.toISOString() };
  }

  if (preset === '7d') {
    const start = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - 6,
      0,
      0,
      0,
      0,
    );
    return { fromIso: start.toISOString(), toIso: endOfToday.toISOString() };
  }

  if (preset === '30d') {
    const start = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - 29,
      0,
      0,
      0,
      0,
    );
    return { fromIso: start.toISOString(), toIso: endOfToday.toISOString() };
  }

  const fromParts = customFrom.split('-').map(Number);
  const toParts = customTo.split('-').map(Number);
  const fromDate =
    fromParts.length === 3
      ? new Date(fromParts[0], fromParts[1] - 1, fromParts[2], 0, 0, 0, 0)
      : new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const toDate =
    toParts.length === 3
      ? new Date(toParts[0], toParts[1] - 1, toParts[2], 23, 59, 59, 999)
      : endOfToday;

  return { fromIso: fromDate.toISOString(), toIso: toDate.toISOString() };
}

function formatQty(val: number): string {
  return Number(val.toFixed(3)).toString();
}

export function AnalyticsView() {
  const { state } = usePos();
  const [preset, setPreset] = useState<PeriodPreset>('hoy');
  const todayStr = useMemo(() => toLocalDateInputValue(new Date()), []);
  const [customFrom, setCustomFrom] = useState<string>(todayStr);
  const [customTo, setCustomTo] = useState<string>(todayStr);

  const range = useMemo(
    () => buildRange(preset, customFrom, customTo),
    [customFrom, customTo, preset],
  );

  const report = useMemo(
    () =>
      computeAnalytics(
        state.orders,
        state.movements,
        state.ingredients,
        state.users,
        range,
      ),
    [range, state.ingredients, state.movements, state.orders, state.users],
  );

  const topDishes = report.topDishes.slice(0, 6);
  const bottomDishes = report.bottomDishes.slice(0, 6);
  const maxDishQty = Math.max(1, ...topDishes.map((d) => d.quantitySold));

  const activeHours = useMemo(() => {
    const withSales = report.byHour.filter((h) => h.ordersCount > 0);
    if (withSales.length > 0) {
      return withSales;
    }
    return report.byHour.slice(9, 21);
  }, [report.byHour]);

  const maxHourRevenue = Math.max(1, ...activeHours.map((h) => h.revenueUsd));

  const totalZoneRevenue =
    report.byZone.mesas.revenueUsd + report.byZone.toldos.revenueUsd;
  const mesasShare =
    totalZoneRevenue > 0
      ? Math.round((report.byZone.mesas.revenueUsd / totalZoneRevenue) * 100)
      : 0;
  const toldosShare =
    totalZoneRevenue > 0
      ? Math.round((report.byZone.toldos.revenueUsd / totalZoneRevenue) * 100)
      : 0;

  const totalMethodRevenueUsd = PAYMENT_LABELS.reduce(
    (sum, { method }) => sum + report.byPaymentMethod[method].totalUsd,
    0,
  );

  return (
    <div className="space-y-6">
      {/* Period filter bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Período de estadísticas">
          {(
            [
              { id: 'hoy', label: 'Hoy' },
              { id: '7d', label: '7 días' },
              { id: '30d', label: '30 días' },
              { id: 'custom', label: 'Rango personalizado' },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={preset === item.id}
              onClick={() => setPreset(item.id)}
              className={`min-h-12 px-4 rounded-xl border text-sm font-bold transition-colors cursor-pointer ${
                preset === item.id
                  ? 'bg-[#0E7490] border-[#0E7490] text-white'
                  : 'bg-white border-[#E5DFD3] text-[#0F2A36] hover:bg-[#F2EDE4]'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {preset === 'custom' && (
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs font-bold text-[#0F2A36] flex items-center gap-1.5">
              <span>Desde</span>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="min-h-12 px-3 rounded-xl border border-[#E5DFD3] bg-white text-sm font-semibold tabular-nums"
              />
            </label>
            <label className="text-xs font-bold text-[#0F2A36] flex items-center gap-1.5">
              <span>Hasta</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="min-h-12 px-3 rounded-xl border border-[#E5DFD3] bg-white text-sm font-semibold tabular-nums"
              />
            </label>
          </div>
        )}
      </div>

      {/* Summary Metrics Strip */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="p-5 rounded-2xl bg-white border border-[#E5DFD3]">
          <p className="text-xs font-semibold text-[#0F2A36]/70">Ventas totales</p>
          <p className="mt-1 text-3xl font-extrabold text-[#0F2A36] tabular-nums">
            ${report.totalRevenueUsd.toFixed(2)}
          </p>
          <p className="text-sm font-bold text-[#0E7490] tabular-nums">
            Bs {report.totalRevenueBs.toFixed(2)}
          </p>
        </div>

        <div className="p-5 rounded-2xl bg-white border border-[#E5DFD3]">
          <p className="text-xs font-semibold text-[#0F2A36]/70">Cuentas cerradas</p>
          <p className="mt-1 text-3xl font-extrabold text-[#0F2A36] tabular-nums">
            {report.ordersCount}
          </p>
        </div>

        <div className="p-5 rounded-2xl bg-white border border-[#E5DFD3]">
          <p className="text-xs font-semibold text-[#0F2A36]/70">Ticket promedio</p>
          <p className="mt-1 text-3xl font-extrabold text-[#0F2A36] tabular-nums">
            ${report.averageTicketUsd.toFixed(2)}
          </p>
        </div>
      </section>

      {/* Top & Bottom Dishes */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <section className="bg-white border border-[#E5DFD3] rounded-2xl overflow-hidden">
          <div className="px-5 py-3.5 bg-[#F2EDE4] border-b border-[#E5DFD3] flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-[#047857]" aria-hidden="true" />
            <h2 className="text-base font-extrabold text-[#0F2A36]">Platos más vendidos</h2>
          </div>
          {topDishes.length === 0 ? (
            <p className="p-5 text-sm text-[#0F2A36]/70">
              Sin ventas cerradas en el período seleccionado.
            </p>
          ) : (
            <ul className="divide-y divide-[#E5DFD3]">
              {topDishes.map((dish) => {
                const widthPct = Math.max(8, Math.round((dish.quantitySold / maxDishQty) * 100));
                return (
                  <li key={dish.menuItemId} className="p-4 space-y-1.5">
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="font-bold text-[#0F2A36] truncate">{dish.name}</span>
                      <span className="shrink-0 font-extrabold text-[#0F2A36] tabular-nums">
                        {dish.quantitySold} u · ${dish.revenueUsd.toFixed(2)}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-[#F2EDE4] overflow-hidden">
                      <div
                        className="h-full rounded-full bg-[#0E7490]"
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="bg-white border border-[#E5DFD3] rounded-2xl overflow-hidden">
          <div className="px-5 py-3.5 bg-[#F2EDE4] border-b border-[#E5DFD3] flex items-center gap-2">
            <TrendingDown className="h-4 w-4 text-[#B45309]" aria-hidden="true" />
            <h2 className="text-base font-extrabold text-[#0F2A36]">Menos vendidos</h2>
          </div>
          {bottomDishes.length === 0 ? (
            <p className="p-5 text-sm text-[#0F2A36]/70">
              Sin ventas cerradas en el período seleccionado.
            </p>
          ) : (
            <ul className="divide-y divide-[#E5DFD3]">
              {bottomDishes.map((dish) => (
                <li
                  key={dish.menuItemId}
                  className="px-4 py-3 flex items-center justify-between gap-2 text-sm"
                >
                  <span className="font-semibold text-[#0F2A36] truncate">{dish.name}</span>
                  <span className="shrink-0 font-bold text-[#0F2A36]/80 tabular-nums">
                    {dish.quantitySold} u · ${dish.revenueUsd.toFixed(2)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Mesas vs Toldos Comparison */}
      <section className="bg-white border border-[#E5DFD3] rounded-2xl overflow-hidden">
        <div className="px-5 py-3.5 bg-[#F2EDE4] border-b border-[#E5DFD3] flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-[#0E7490]" aria-hidden="true" />
          <h2 className="text-base font-extrabold text-[#0F2A36]">
            Mesas vs. Toldos en la playa
          </h2>
        </div>

        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 rounded-xl bg-[#FAF8F4] border border-[#E5DFD3] space-y-2">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-sm font-extrabold text-[#0F2A36]">
                <UtensilsCrossed className="h-4 w-4 text-[#0E7490]" aria-hidden="true" />
                <span>Mesas</span>
              </span>
              <span className="text-xs font-bold text-[#0E7490] tabular-nums">
                {mesasShare}% de ventas
              </span>
            </div>
            <p className="text-2xl font-extrabold text-[#0F2A36] tabular-nums">
              ${report.byZone.mesas.revenueUsd.toFixed(2)}
            </p>
            <p className="text-xs font-semibold text-[#0F2A36]/75 tabular-nums">
              {report.byZone.mesas.ordersCount} cuenta(s) · Ticket promedio: $
              {report.byZone.mesas.averageTicketUsd.toFixed(2)}
            </p>
            <div className="h-2 rounded-full bg-[#E5DFD3] overflow-hidden">
              <div
                className="h-full rounded-full bg-[#0E7490]"
                style={{ width: `${mesasShare}%` }}
              />
            </div>
          </div>

          <div className="p-4 rounded-xl bg-[#FAF8F4] border border-[#E5DFD3] space-y-2">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-sm font-extrabold text-[#0F2A36]">
                <Umbrella className="h-4 w-4 text-[#047857]" aria-hidden="true" />
                <span>Toldos en la playa</span>
              </span>
              <span className="text-xs font-bold text-[#047857] tabular-nums">
                {toldosShare}% de ventas
              </span>
            </div>
            <p className="text-2xl font-extrabold text-[#0F2A36] tabular-nums">
              ${report.byZone.toldos.revenueUsd.toFixed(2)}
            </p>
            <p className="text-xs font-semibold text-[#0F2A36]/75 tabular-nums">
              {report.byZone.toldos.ordersCount} cuenta(s) · Ticket promedio: $
              {report.byZone.toldos.averageTicketUsd.toFixed(2)}
            </p>
            <div className="h-2 rounded-full bg-[#E5DFD3] overflow-hidden">
              <div
                className="h-full rounded-full bg-[#047857]"
                style={{ width: `${toldosShare}%` }}
              />
            </div>
          </div>
        </div>
      </section>

      {/* Peak Hours & Payment Methods */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <section className="bg-white border border-[#E5DFD3] rounded-2xl overflow-hidden">
          <div className="px-5 py-3.5 bg-[#F2EDE4] border-b border-[#E5DFD3] flex items-center gap-2">
            <Clock className="h-4 w-4 text-[#0E7490]" aria-hidden="true" />
            <h2 className="text-base font-extrabold text-[#0F2A36]">Horas pico</h2>
          </div>
          <div className="p-4 space-y-2.5">
            {activeHours.map((entry) => {
              const widthPct =
                entry.revenueUsd > 0
                  ? Math.max(6, Math.round((entry.revenueUsd / maxHourRevenue) * 100))
                  : 0;
              return (
                <div
                  key={entry.hour}
                  className="grid grid-cols-[54px_1fr_110px] items-center gap-2.5 text-xs"
                >
                  <span className="font-bold text-[#0F2A36] tabular-nums">{entry.label}</span>
                  <div className="h-3 rounded-full bg-[#F2EDE4] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#0E7490]"
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>
                  <span className="text-right font-bold text-[#0F2A36] tabular-nums">
                    ${entry.revenueUsd.toFixed(2)} ({entry.ordersCount})
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="bg-white border border-[#E5DFD3] rounded-2xl overflow-hidden">
          <div className="px-5 py-3.5 bg-[#F2EDE4] border-b border-[#E5DFD3] flex items-center gap-2">
            <CreditCard className="h-4 w-4 text-[#0E7490]" aria-hidden="true" />
            <h2 className="text-base font-extrabold text-[#0F2A36]">Métodos de pago</h2>
          </div>
          <ul className="divide-y divide-[#E5DFD3]">
            {PAYMENT_LABELS.map(({ method, label }) => {
              const bucket = report.byPaymentMethod[method];
              const pct =
                totalMethodRevenueUsd > 0
                  ? Math.round((bucket.totalUsd / totalMethodRevenueUsd) * 100)
                  : 0;
              return (
                <li key={method} className="p-4 space-y-1.5">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="font-bold text-[#0F2A36]">{label}</span>
                    <span className="font-extrabold text-[#0F2A36] tabular-nums">
                      ${bucket.totalUsd.toFixed(2)} ({pct}%)
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-[#0F2A36]/70 tabular-nums">
                    <span>{bucket.count} operación(es)</span>
                    <span>Bs {bucket.totalBs.toFixed(2)}</span>
                  </div>
                  <div className="h-2 rounded-full bg-[#F2EDE4] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#047857]"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      {/* Waiter Performance & Recipe Ingredient Consumption */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <section className="bg-white border border-[#E5DFD3] rounded-2xl overflow-hidden">
          <div className="px-5 py-3.5 bg-[#F2EDE4] border-b border-[#E5DFD3] flex items-center gap-2">
            <Users className="h-4 w-4 text-[#0E7490]" aria-hidden="true" />
            <h2 className="text-base font-extrabold text-[#0F2A36]">
              Rendimiento por mesonero
            </h2>
          </div>
          {report.byWaiter.length === 0 ? (
            <p className="p-5 text-sm text-[#0F2A36]/70">
              Sin cuentas cerradas en el período.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-[#E5DFD3] bg-[#FAF8F4] text-xs font-bold text-[#0F2A36]/80">
                    <th className="py-2.5 px-4">Mesonero</th>
                    <th className="py-2.5 px-4 text-right">Cuentas</th>
                    <th className="py-2.5 px-4 text-right">Total USD</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5DFD3]">
                  {report.byWaiter.map((waiter) => (
                    <tr key={waiter.waiterId}>
                      <td className="py-2.5 px-4 font-bold text-[#0F2A36]">
                        {waiter.waiterName}
                      </td>
                      <td className="py-2.5 px-4 text-right font-semibold tabular-nums">
                        {waiter.ordersCount}
                      </td>
                      <td className="py-2.5 px-4 text-right font-extrabold text-[#0E7490] tabular-nums">
                        ${waiter.revenueUsd.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="bg-white border border-[#E5DFD3] rounded-2xl overflow-hidden">
          <div className="px-5 py-3.5 bg-[#F2EDE4] border-b border-[#E5DFD3] flex items-center gap-2">
            <Package className="h-4 w-4 text-[#0E7490]" aria-hidden="true" />
            <h2 className="text-base font-extrabold text-[#0F2A36]">
              Consumo de insumos por recetas
            </h2>
          </div>
          {report.ingredientUsage.length === 0 ? (
            <p className="p-5 text-sm text-[#0F2A36]/70">
              Sin consumo registrado en el período.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-[#E5DFD3] bg-[#FAF8F4] text-xs font-bold text-[#0F2A36]/80">
                    <th className="py-2.5 px-4">Insumo</th>
                    <th className="py-2.5 px-4 text-right">Consumido</th>
                    <th className="py-2.5 px-4 text-right">Stock actual</th>
                    <th className="py-2.5 px-4">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5DFD3]">
                  {report.ingredientUsage.map((row) => (
                    <tr key={row.ingredientId}>
                      <td className="py-2.5 px-4 font-bold text-[#0F2A36]">
                        {row.ingredientName}
                      </td>
                      <td className="py-2.5 px-4 text-right font-semibold tabular-nums">
                        {formatQty(row.consumedQuantity)} {row.unit}
                      </td>
                      <td className="py-2.5 px-4 text-right font-bold tabular-nums">
                        {formatQty(row.currentStock)} {row.unit}
                      </td>
                      <td className="py-2.5 px-4">
                        {row.needsRestock ? (
                          <span className="inline-flex px-2 py-0.5 rounded-full bg-[#B45309] text-white text-xs font-bold">
                            Reponer
                          </span>
                        ) : (
                          <span className="inline-flex px-2 py-0.5 rounded-full bg-[#047857]/12 text-[#047857] text-xs font-bold">
                            OK
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
