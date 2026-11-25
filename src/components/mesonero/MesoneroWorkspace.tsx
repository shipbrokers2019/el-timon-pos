import { useEffect, useMemo, useState } from 'react';
import { BellRing, Clock, Umbrella, UtensilsCrossed, WifiOff } from 'lucide-react';
import { usePos } from '../../store/PosProvider';
import type { Location, Zone } from '../../types/pos';
import { getElapsedMinutes } from '../timeUtils';
import { OrderComposer } from './OrderComposer';

const STATUS_BADGES: Record<Location['status'], { label: string; className: string }> = {
  libre: {
    label: 'Libre',
    className: 'bg-[#047857]/12 text-[#047857] border border-[#047857]/30',
  },
  ocupada: {
    label: 'Ocupada',
    className: 'bg-[#0E7490] text-white border border-[#0E7490]',
  },
  por_cobrar: {
    label: 'Por cobrar',
    className: 'bg-[#B45309] text-white border border-[#B45309]',
  },
};

export function MesoneroWorkspace() {
  const { state } = usePos();
  const [activeZone, setActiveZone] = useState<Zone>('mesas');
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const mesas = useMemo(
    () =>
      state.locations
        .filter((loc) => loc.zone === 'mesas')
        .sort((a, b) => a.number - b.number),
    [state.locations],
  );

  const toldos = useMemo(
    () =>
      state.locations
        .filter((loc) => loc.zone === 'toldos')
        .sort((a, b) => a.number - b.number),
    [state.locations],
  );

  const openOrderById = useMemo(() => {
    const map = new Map<string, { openedAt: string }>();
    for (const order of state.orders) {
      if (order.status === 'abierta') {
        map.set(order.id, { openedAt: order.openedAt });
      }
    }
    return map;
  }, [state.orders]);

  const visibleLocations = activeZone === 'mesas' ? mesas : toldos;

  const selectedLocation = useMemo(
    () => state.locations.find((loc) => loc.id === selectedLocationId) ?? null,
    [selectedLocationId, state.locations],
  );

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[#FAF8F4] text-[#0F2A36] p-4 sm:p-6">
      <div className="max-w-7xl mx-auto space-y-5">
        {/* Zone tabs */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex gap-2" role="tablist" aria-label="Zonas del local">
            <button
              type="button"
              role="tab"
              aria-selected={activeZone === 'mesas'}
              onClick={() => setActiveZone('mesas')}
              className={`min-h-12 px-4 rounded-xl border text-sm font-bold inline-flex items-center gap-2 transition-colors cursor-pointer ${
                activeZone === 'mesas'
                  ? 'bg-[#0E7490] border-[#0E7490] text-white'
                  : 'bg-[#F2EDE4] border-[#0F2A36]/15 text-[#0F2A36] hover:bg-white'
              }`}
            >
              <UtensilsCrossed className="h-4 w-4" aria-hidden="true" />
              <span className="tabular-nums">Mesas ({mesas.length})</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeZone === 'toldos'}
              onClick={() => setActiveZone('toldos')}
              className={`min-h-12 px-4 rounded-xl border text-sm font-bold inline-flex items-center gap-2 transition-colors cursor-pointer ${
                activeZone === 'toldos'
                  ? 'bg-[#0E7490] border-[#0E7490] text-white'
                  : 'bg-[#F2EDE4] border-[#0F2A36]/15 text-[#0F2A36] hover:bg-white'
              }`}
            >
              <Umbrella className="h-4 w-4" aria-hidden="true" />
              <span className="tabular-nums">Toldos Playa ({toldos.length})</span>
            </button>
          </div>
        </div>

        {/* Location grid + OrderComposer split layout */}
        <div
          className={`grid gap-5 items-start ${
            selectedLocation ? 'grid-cols-1 lg:grid-cols-[1fr_430px]' : 'grid-cols-1'
          }`}
        >
          <section aria-label={activeZone === 'mesas' ? 'Mesas' : 'Toldos Playa'}>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
              {visibleLocations.map((loc) => {
                const badge = STATUS_BADGES[loc.status];
                const activeOrder = loc.activeOrderId
                  ? openOrderById.get(loc.activeOrderId)
                  : undefined;
                const elapsedMin = activeOrder
                  ? getElapsedMinutes(activeOrder.openedAt, nowMs)
                  : null;
                const isSelected = selectedLocation?.id === loc.id;

                return (
                  <button
                    key={loc.id}
                    type="button"
                    onClick={() => setSelectedLocationId(loc.id)}
                    className={`min-h-28 p-3.5 rounded-2xl border text-left flex flex-col justify-between gap-2 transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-white border-[#0E7490] ring-2 ring-[#0E7490]/30'
                        : loc.status === 'libre'
                          ? 'bg-[#F2EDE4] hover:bg-white border-[#0F2A36]/15'
                          : 'bg-white hover:bg-[#FAF8F4] border-[#0F2A36]/25'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-base font-extrabold text-[#0F2A36] leading-tight">
                        {loc.label}
                      </span>
                      <span
                        className={`shrink-0 px-2 py-0.5 rounded-full text-[11px] font-bold ${badge.className}`}
                      >
                        {badge.label}
                      </span>
                    </div>

                    <div className="space-y-1">
                      {elapsedMin !== null && loc.status !== 'libre' && (
                        <div className="inline-flex items-center gap-1 text-xs font-semibold text-[#0F2A36]/75 tabular-nums">
                          <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>{elapsedMin} min</span>
                        </div>
                      )}

                      {loc.kitchenReadyAlert && (
                        <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#047857] text-white text-[11px] font-bold">
                          <BellRing className="h-3 w-3" aria-hidden="true" />
                          <span>Listo en cocina</span>
                        </div>
                      )}

                      {loc.pendingSync && (
                        <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#B45309]/15 border border-[#B45309]/35 text-[#78350F] text-[11px] font-bold">
                          <WifiOff className="h-3 w-3" aria-hidden="true" />
                          <span>Pendiente Wi-Fi</span>
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {selectedLocation && (
            <OrderComposer
              key={selectedLocation.id}
              location={selectedLocation}
              onClose={() => setSelectedLocationId(null)}
            />
          )}
        </div>
      </div>
    </main>
  );
}
