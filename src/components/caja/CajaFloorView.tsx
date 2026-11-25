import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Ban,
  CheckCircle2,
  Clock,
  CreditCard,
  Minus,
  Plus,
  Printer,
  Send,
  Trash2,
  Umbrella,
  UtensilsCrossed,
  X,
} from 'lucide-react';
import { calculateOrderBreakdown, calculateOrderTotalUsd, usdToBs } from '../../domain/currency';
import { usePos } from '../../store/PosProvider';
import type { Location, MenuCategory, MenuItem, Order, VoidDisposition } from '../../types/pos';
import { getElapsedMinutes } from '../timeUtils';
import { CheckoutModal } from './CheckoutModal';

type ZoneFilter = 'todas' | 'mesas' | 'toldos' | 'por_cobrar';

const CATEGORY_TABS: ReadonlyArray<'Todos' | MenuCategory> = [
  'Todos',
  'Platos',
  'Entradas',
  'Bebidas',
  'Cócteles',
  'Extras',
];

interface DraftCartLine {
  menuItemId: string;
  name: string;
  priceUsd: number;
  quantity: number;
  notes: string;
}

const STATUS_BADGE: Record<Location['status'], { label: string; className: string }> = {
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

export function CajaFloorView() {
  const {
    state,
    currentUser,
    submitComanda,
    voidOrderItem,
    createPreCuentaPrintJob,
  } = usePos();

  const [zoneFilter, setZoneFilter] = useState<ZoneFilter>('todas');
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [checkoutOrder, setCheckoutOrder] = useState<Order | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  // Visual category menu + multi-item cart state
  const [showAddItem, setShowAddItem] = useState(false);
  const [activeCategory, setActiveCategory] = useState<'Todos' | MenuCategory>('Todos');
  const [draftCart, setDraftCart] = useState<DraftCartLine[]>([]);
  const [submittingCart, setSubmittingCart] = useState(false);

  // Inline void form state
  const [voidingItemId, setVoidingItemId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState<string>('');
  const [voidDisposition, setVoidDisposition] = useState<VoidDisposition>('restock');

  const [actionError, setActionError] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const rate = state.settings.exchangeRate;

  const openOrderByLocationId = useMemo(() => {
    const map = new Map<string, Order>();
    for (const order of state.orders) {
      if (order.status === 'abierta') {
        map.set(order.locationId, order);
      }
    }
    return map;
  }, [state.orders]);

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

  const porCobrarLocations = useMemo(
    () => state.locations.filter((loc) => loc.status === 'por_cobrar'),
    [state.locations],
  );

  const openAccountsCount = useMemo(
    () => state.locations.filter((loc) => loc.status !== 'libre').length,
    [state.locations],
  );

  const selectedLocation = useMemo(
    () => state.locations.find((loc) => loc.id === selectedLocationId) ?? null,
    [selectedLocationId, state.locations],
  );

  const selectedOrder = useMemo(() => {
    if (!selectedLocation) {
      return null;
    }
    return openOrderByLocationId.get(selectedLocation.id) ?? null;
  }, [openOrderByLocationId, selectedLocation]);

  const filteredMenu = useMemo(
    () =>
      activeCategory === 'Todos'
        ? state.menu
        : state.menu.filter((item) => item.category === activeCategory),
    [activeCategory, state.menu],
  );

  const draftCartTotalUsd = useMemo(
    () => draftCart.reduce((sum, line) => sum + line.priceUsd * line.quantity, 0),
    [draftCart],
  );

  const handleSelectLocation = (locationId: string) => {
    const hasOpenOrder = openOrderByLocationId.has(locationId);
    setSelectedLocationId(locationId);
    // Open visual menu automatically for free tables; collapsed by default when inspecting an active account
    setShowAddItem(!hasOpenOrder);
    setActiveCategory('Todos');
    setDraftCart([]);
    setVoidingItemId(null);
    setVoidReason('');
    setActionError(null);
    setActionFeedback(null);
  };

  const handleAddProductToDraft = (item: MenuItem) => {
    if (item.outOfStock) {
      return;
    }
    setActionError(null);
    setActionFeedback(null);
    setDraftCart((prev) => {
      const existing = prev.find((line) => line.menuItemId === item.id);
      if (existing) {
        return prev.map((line) =>
          line.menuItemId === item.id ? { ...line, quantity: line.quantity + 1 } : line,
        );
      }
      return [
        ...prev,
        {
          menuItemId: item.id,
          name: item.name,
          priceUsd: item.priceUsd,
          quantity: 1,
          notes: '',
        },
      ];
    });
  };

  const handleAdjustDraftQty = (menuItemId: string, delta: number) => {
    setDraftCart((prev) =>
      prev
        .map((line) =>
          line.menuItemId === menuItemId
            ? { ...line, quantity: line.quantity + delta }
            : line,
        )
        .filter((line) => line.quantity > 0),
    );
  };

  const handleDraftNoteChange = (menuItemId: string, notes: string) => {
    setDraftCart((prev) =>
      prev.map((line) => (line.menuItemId === menuItemId ? { ...line, notes } : line)),
    );
  };

  const handleRemoveDraftLine = (menuItemId: string) => {
    setDraftCart((prev) => prev.filter((line) => line.menuItemId !== menuItemId));
  };

  const handleAddItemSubmit = async () => {
    if (!selectedLocation || !currentUser || draftCart.length === 0) {
      return;
    }
    setActionError(null);
    setSubmittingCart(true);
    try {
      await submitComanda({
        locationId: selectedLocation.id,
        waiterId: currentUser.id,
        waiterName: currentUser.name,
        items: draftCart.map((line) => ({
          menuItemId: line.menuItemId,
          quantity: line.quantity,
          notes: line.notes.trim(),
        })),
      });
      setDraftCart([]);
      setShowAddItem(false);
      setActionFeedback('Productos agregados a la cuenta.');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'No se pudieron agregar los productos.');
    } finally {
      setSubmittingCart(false);
    }
  };

  const handleConfirmVoid = async () => {
    if (!selectedOrder || !voidingItemId) {
      return;
    }
    const trimmedReason = voidReason.trim();
    if (!trimmedReason) {
      setActionError('Debes indicar el motivo de la anulación.');
      return;
    }
    setActionError(null);
    try {
      await voidOrderItem(selectedOrder.id, voidingItemId, voidDisposition, trimmedReason);
      setVoidingItemId(null);
      setVoidReason('');
      setVoidDisposition('restock');
      setActionFeedback(
        voidDisposition === 'restock'
          ? 'Ítem anulado y devuelto al inventario.'
          : 'Ítem anulado y registrado como merma.',
      );
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'No se pudo anular el ítem.');
    }
  };

  const handlePrintPreCuenta = async () => {
    if (!selectedOrder) {
      return;
    }
    setActionError(null);
    try {
      await createPreCuentaPrintJob(selectedOrder.id);
      setActionFeedback(
        'Pre-factura generada y enviada a la tablet del mesonero para mostrar al cliente.',
      );
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'No se pudo generar la pre-cuenta.',
      );
    }
  };

  const renderLocationCard = (loc: Location) => {
    const order = openOrderByLocationId.get(loc.id);
    const totalUsd = order ? calculateOrderTotalUsd(order.items) : 0;
    const totalBs = order ? usdToBs(totalUsd, rate) : 0;
    const elapsedMin = order ? getElapsedMinutes(order.openedAt, nowMs) : null;
    const badge = STATUS_BADGE[loc.status];
    const isSelected = selectedLocationId === loc.id;
    const isPorCobrar = loc.status === 'por_cobrar';

    return (
      <button
        key={loc.id}
        type="button"
        onClick={() => handleSelectLocation(loc.id)}
        className={`min-h-32 p-3.5 rounded-2xl border text-left flex flex-col justify-between gap-2 transition-colors cursor-pointer ${
          isSelected
            ? 'bg-white border-[#0E7490] ring-2 ring-[#0E7490]/30'
            : isPorCobrar
              ? 'bg-[#B45309]/10 hover:bg-[#B45309]/15 border-[#B45309]'
              : loc.status === 'ocupada'
                ? 'bg-white hover:bg-[#FAF8F4] border-[#0E7490]/45'
                : 'bg-[#F2EDE4]/70 hover:bg-white border-[#E5DFD3]'
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

        {order ? (
          <div className="space-y-0.5">
            <p className="text-lg font-extrabold text-[#0F2A36] tabular-nums leading-tight">
              ${totalUsd.toFixed(2)}
            </p>
            <p className="text-xs font-semibold text-[#0E7490] tabular-nums">
              Bs {totalBs.toFixed(2)}
            </p>
            <div className="pt-1 flex items-center justify-between gap-1 text-[11px] font-medium text-[#0F2A36]/70">
              <span className="truncate">{order.waiterName}</span>
              {elapsedMin !== null && (
                <span className="shrink-0 inline-flex items-center gap-0.5 tabular-nums">
                  <Clock className="h-3 w-3" aria-hidden="true" />
                  {elapsedMin}m
                </span>
              )}
            </div>
          </div>
        ) : (
          <p className="text-xs font-medium text-[#0F2A36]/55">Disponible</p>
        )}
      </button>
    );
  };

  return (
    <div className="space-y-5">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filtrar ubicaciones">
          <button
            type="button"
            aria-pressed={zoneFilter === 'todas'}
            onClick={() => setZoneFilter('todas')}
            className={`min-h-12 px-4 rounded-xl border text-sm font-bold transition-colors cursor-pointer ${
              zoneFilter === 'todas'
                ? 'bg-[#0E7490] border-[#0E7490] text-white'
                : 'bg-white border-[#E5DFD3] text-[#0F2A36] hover:bg-[#F2EDE4]'
            }`}
          >
            Todas ({state.locations.length})
          </button>
          <button
            type="button"
            aria-pressed={zoneFilter === 'mesas'}
            onClick={() => setZoneFilter('mesas')}
            className={`min-h-12 px-4 rounded-xl border text-sm font-bold inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
              zoneFilter === 'mesas'
                ? 'bg-[#0E7490] border-[#0E7490] text-white'
                : 'bg-white border-[#E5DFD3] text-[#0F2A36] hover:bg-[#F2EDE4]'
            }`}
          >
            <UtensilsCrossed className="h-4 w-4" aria-hidden="true" />
            <span className="tabular-nums">Mesas ({mesas.length})</span>
          </button>
          <button
            type="button"
            aria-pressed={zoneFilter === 'toldos'}
            onClick={() => setZoneFilter('toldos')}
            className={`min-h-12 px-4 rounded-xl border text-sm font-bold inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
              zoneFilter === 'toldos'
                ? 'bg-[#0E7490] border-[#0E7490] text-white'
                : 'bg-white border-[#E5DFD3] text-[#0F2A36] hover:bg-[#F2EDE4]'
            }`}
          >
            <Umbrella className="h-4 w-4" aria-hidden="true" />
            <span className="tabular-nums">Toldos ({toldos.length})</span>
          </button>
          {porCobrarLocations.length > 0 && (
            <button
              type="button"
              aria-pressed={zoneFilter === 'por_cobrar'}
              onClick={() => setZoneFilter('por_cobrar')}
              className={`min-h-12 px-4 rounded-xl border text-sm font-bold transition-colors cursor-pointer tabular-nums ${
                zoneFilter === 'por_cobrar'
                  ? 'bg-[#B45309] border-[#B45309] text-white'
                  : 'bg-[#B45309]/10 border-[#B45309]/40 text-[#92400E] hover:bg-[#B45309]/20'
              }`}
            >
              Por cobrar ({porCobrarLocations.length})
            </button>
          )}
        </div>

        <p className="text-sm font-semibold text-[#0F2A36]/75 tabular-nums">
          Cuentas abiertas: <strong className="text-[#0F2A36]">{openAccountsCount}</strong>
        </p>
      </div>

      {!selectedLocation && actionFeedback && (
        <p
          role="status"
          className="p-3.5 rounded-xl bg-[#047857]/10 border border-[#047857]/30 text-sm font-semibold text-[#047857]"
        >
          {actionFeedback}
        </p>
      )}

      {/* Floor Grid + Account Detail Split */}
      <div
        className={`grid gap-5 items-start ${
          selectedLocation ? 'grid-cols-1 xl:grid-cols-[minmax(0,1fr)_440px]' : 'grid-cols-1'
        }`}
      >
        <div className="min-w-0 space-y-6">
          {(zoneFilter === 'todas' || zoneFilter === 'mesas') && (
            <section aria-label="Mesas" className="space-y-3">
              <h2 className="text-base font-extrabold text-[#0F2A36] flex items-center gap-2">
                <UtensilsCrossed className="h-4 w-4 text-[#0E7490]" aria-hidden="true" />
                <span>Mesas ({mesas.length})</span>
              </h2>
              <div
                className={`grid gap-3 ${
                  selectedLocation
                    ? 'grid-cols-2 sm:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-4'
                    : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5'
                }`}
              >
                {mesas.map(renderLocationCard)}
              </div>
            </section>
          )}

          {(zoneFilter === 'todas' || zoneFilter === 'toldos') && (
            <section aria-label="Toldos en la playa" className="space-y-3">
              <h2 className="text-base font-extrabold text-[#0F2A36] flex items-center gap-2">
                <Umbrella className="h-4 w-4 text-[#0E7490]" aria-hidden="true" />
                <span>Toldos Playa ({toldos.length})</span>
              </h2>
              <div
                className={`grid gap-3 ${
                  selectedLocation
                    ? 'grid-cols-2 sm:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-4'
                    : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5'
                }`}
              >
                {toldos.map(renderLocationCard)}
              </div>
            </section>
          )}

          {zoneFilter === 'por_cobrar' && (
            <section aria-label="Cuentas por cobrar" className="space-y-3">
              <h2 className="text-base font-extrabold text-[#92400E]">
                Cuentas solicitadas (Por cobrar)
              </h2>
              {porCobrarLocations.length === 0 ? (
                <p className="p-6 rounded-2xl bg-white border border-[#E5DFD3] text-sm font-medium text-[#0F2A36]/70">
                  No hay cuentas pendientes por cobrar en este momento.
                </p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {porCobrarLocations.map(renderLocationCard)}
                </div>
              )}
            </section>
          )}
        </div>

        {/* Account Detail Side Panel */}
        {selectedLocation && (
          <aside
            aria-label={`Detalle de cuenta ${selectedLocation.label}`}
            className="bg-white border border-[#E5DFD3] rounded-2xl overflow-hidden shadow-sm"
          >
            <div className="px-4 py-3.5 bg-[#F2EDE4] border-b border-[#E5DFD3] flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <h2 className="text-lg font-extrabold text-[#0F2A36] truncate">
                  {selectedLocation.label}
                </h2>
                <span
                  className={`shrink-0 px-2.5 py-0.5 rounded-full text-xs font-bold ${
                    STATUS_BADGE[selectedLocation.status].className
                  }`}
                >
                  {STATUS_BADGE[selectedLocation.status].label}
                </span>
              </div>
              <button
                type="button"
                aria-label="Cerrar detalle de cuenta"
                onClick={() => setSelectedLocationId(null)}
                className="min-h-12 min-w-12 rounded-xl border border-[#E5DFD3] bg-white hover:bg-[#FAF8F4] flex items-center justify-center text-[#0F2A36] cursor-pointer"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              {selectedOrder ? (
                <>
                  {/* Running Totals with 16% IVA Breakdown */}
                  {(() => {
                    const bd = calculateOrderBreakdown(selectedOrder.items, rate);
                    return (
                      <div className="p-4 rounded-xl bg-[#FAF8F4] border border-[#E5DFD3] space-y-2">
                        <div className="flex items-center justify-between text-xs font-semibold text-[#0F2A36]/75 tabular-nums">
                          <span>Subtotal productos · {selectedOrder.waiterName}</span>
                          <span>${bd.subtotalUsd.toFixed(2)}</span>
                        </div>
                        <div className="flex items-center justify-between text-xs font-semibold text-[#0F2A36]/75 tabular-nums">
                          <span>IVA ({Math.round(bd.ivaRate * 100)}%)</span>
                          <span>${bd.ivaUsd.toFixed(2)}</span>
                        </div>
                        <div className="pt-2 border-t border-[#E5DFD3] flex items-center justify-between gap-3">
                          <div>
                            <p className="text-xs font-bold text-[#0F2A36]/80">Total a cobrar USD</p>
                            <p className="text-2xl font-extrabold text-[#0F2A36] tabular-nums">
                              ${bd.totalUsd.toFixed(2)}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs font-bold text-[#0F2A36]/80">En Bolívares</p>
                            <p className="text-lg font-extrabold text-[#0E7490] tabular-nums">
                              Bs {bd.totalBs.toFixed(2)}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Primary Actions */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      onClick={() => void handlePrintPreCuenta()}
                      className="min-h-12 px-3.5 rounded-xl border border-[#E5DFD3] bg-[#FAF8F4] hover:bg-[#F2EDE4] text-sm font-bold text-[#0F2A36] inline-flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <Printer className="h-4 w-4 text-[#0E7490]" aria-hidden="true" />
                      <span>Imprimir Pre-cuenta 80mm</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setCheckoutOrder(selectedOrder)}
                      className="min-h-12 px-3.5 rounded-xl bg-[#047857] hover:bg-[#065F46] text-white text-sm font-bold inline-flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <CreditCard className="h-4 w-4" aria-hidden="true" />
                      <span>Cobrar y Cerrar Cuenta</span>
                    </button>
                  </div>
                </>
              ) : (
                <p className="text-sm font-medium text-[#0F2A36]/70">
                  Esta ubicación está libre. Puedes agregar un producto directamente desde Caja para abrir cuenta.
                </p>
              )}

              {/* Quick Add Products (Category cards matching Mesonero UX) */}
              <div className="pt-2 border-t border-[#E5DFD3]">
                <button
                  type="button"
                  onClick={() => setShowAddItem((prev) => !prev)}
                  className="min-h-12 px-3.5 rounded-xl border border-[#0E7490]/35 bg-[#0E7490]/8 hover:bg-[#0E7490]/15 text-xs sm:text-sm font-bold text-[#0E7490] inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  <span>{showAddItem ? 'Ocultar menú de productos' : 'Agregar productos'}</span>
                </button>

                {showAddItem && (
                  <div className="mt-3 p-3.5 rounded-xl bg-[#FAF8F4] border border-[#E5DFD3] space-y-3">
                    {/* Category tabs */}
                    <div
                      className="flex flex-wrap gap-1.5"
                      role="tablist"
                      aria-label="Categorías del menú en Caja"
                    >
                      {CATEGORY_TABS.map((category) => {
                        const active = activeCategory === category;
                        return (
                          <button
                            key={category}
                            type="button"
                            role="tab"
                            aria-selected={active}
                            onClick={() => setActiveCategory(category)}
                            className={`min-h-10 px-3 rounded-xl border text-xs font-bold transition-colors cursor-pointer ${
                              active
                                ? 'bg-[#0E7490] border-[#0E7490] text-white'
                                : 'bg-white border-[#E5DFD3] text-[#0F2A36] hover:bg-[#F2EDE4]'
                            }`}
                          >
                            {category}
                          </button>
                        );
                      })}
                    </div>

                    {/* Visual product cards */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-64 overflow-y-auto pr-0.5">
                      {filteredMenu.map((item) => {
                        const isOut = item.outOfStock;
                        const bsPrice = usdToBs(item.priceUsd, rate);
                        return (
                          <button
                            key={item.id}
                            type="button"
                            disabled={isOut}
                            onClick={() => handleAddProductToDraft(item)}
                            className={`min-h-14 p-2.5 rounded-xl border text-left flex items-center justify-between gap-2 transition-colors ${
                              isOut
                                ? 'bg-[#E7E0D4]/70 border-[#0F2A36]/10 text-[#0F2A36]/45 cursor-not-allowed'
                                : 'bg-white hover:bg-[#0E7490]/5 active:bg-[#0E7490]/10 border-[#E5DFD3] text-[#0F2A36] cursor-pointer'
                            }`}
                          >
                            <div className="min-w-0">
                              <p className="text-xs font-bold leading-snug truncate">
                                {item.name}
                              </p>
                              <div className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5">
                                <span className="text-xs font-extrabold text-[#0E7490] tabular-nums">
                                  ${item.priceUsd.toFixed(2)}
                                </span>
                                <span className="text-[11px] font-semibold text-[#0F2A36]/65 tabular-nums">
                                  Bs {bsPrice.toFixed(2)}
                                </span>
                              </div>
                            </div>

                            {isOut ? (
                              <span className="shrink-0 px-2 py-0.5 rounded-full bg-[#B91C1C]/12 border border-[#B91C1C]/30 text-[10px] font-bold text-[#B91C1C]">
                                Agotado
                              </span>
                            ) : (
                              <span
                                aria-hidden="true"
                                className="shrink-0 h-8 w-8 rounded-lg bg-[#0E7490]/10 text-[#0E7490] flex items-center justify-center"
                              >
                                <Plus className="h-4 w-4" />
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>

                    {/* Draft cart */}
                    {draftCart.length > 0 && (
                      <div className="pt-2.5 border-t border-[#E5DFD3] space-y-2">
                        <div className="flex items-center justify-between text-xs font-bold text-[#0F2A36]">
                          <span>Por agregar ({draftCart.reduce((s, l) => s + l.quantity, 0)})</span>
                          <span className="text-[#0E7490] tabular-nums">
                            ${draftCartTotalUsd.toFixed(2)}
                          </span>
                        </div>

                        <ul className="space-y-2">
                          {draftCart.map((line) => (
                            <li
                              key={line.menuItemId}
                              className="p-2.5 rounded-xl bg-white border border-[#E5DFD3] space-y-2"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-bold text-[#0F2A36] truncate">
                                  {line.name}
                                </span>
                                <div className="flex items-center gap-1 shrink-0">
                                  <button
                                    type="button"
                                    aria-label={`Disminuir ${line.name}`}
                                    onClick={() => handleAdjustDraftQty(line.menuItemId, -1)}
                                    className="h-8 w-8 rounded-lg border border-[#E5DFD3] bg-[#FAF8F4] hover:bg-white flex items-center justify-center text-[#0F2A36] cursor-pointer"
                                  >
                                    <Minus className="h-3.5 w-3.5" aria-hidden="true" />
                                  </button>
                                  <span className="min-w-6 text-center text-xs font-extrabold tabular-nums">
                                    {line.quantity}
                                  </span>
                                  <button
                                    type="button"
                                    aria-label={`Aumentar ${line.name}`}
                                    onClick={() => handleAdjustDraftQty(line.menuItemId, 1)}
                                    className="h-8 w-8 rounded-lg border border-[#E5DFD3] bg-[#FAF8F4] hover:bg-white flex items-center justify-center text-[#0F2A36] cursor-pointer"
                                  >
                                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                                  </button>
                                  <button
                                    type="button"
                                    aria-label={`Quitar ${line.name}`}
                                    onClick={() => handleRemoveDraftLine(line.menuItemId)}
                                    className="h-8 w-8 rounded-lg border border-[#B91C1C]/25 bg-red-50 hover:bg-red-100 flex items-center justify-center text-[#B91C1C] cursor-pointer"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                                  </button>
                                </div>
                              </div>

                              <input
                                type="text"
                                value={line.notes}
                                onChange={(e) =>
                                  handleDraftNoteChange(line.menuItemId, e.target.value)
                                }
                                placeholder="Nota cocina (ej. Sin cebolla, bien cocida)"
                                aria-label={`Nota para ${line.name}`}
                                className="w-full min-h-9 px-2.5 rounded-lg border border-[#E5DFD3] bg-[#FAF8F4] text-xs text-[#0F2A36]"
                              />
                            </li>
                          ))}
                        </ul>

                        <button
                          type="button"
                          disabled={submittingCart}
                          onClick={() => void handleAddItemSubmit()}
                          className="w-full min-h-12 px-4 rounded-xl bg-[#0E7490] hover:bg-[#0B5E75] disabled:opacity-50 text-white text-sm font-bold inline-flex items-center justify-center gap-2 cursor-pointer"
                        >
                          <Send className="h-4 w-4" aria-hidden="true" />
                          <span>
                            {submittingCart
                              ? 'Agregando...'
                              : `Agregar a la cuenta ($${draftCartTotalUsd.toFixed(2)})`}
                          </span>
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {actionError && (
                <p
                  role="alert"
                  className="text-xs font-semibold text-[#B91C1C] flex items-center gap-1.5"
                >
                  <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{actionError}</span>
                </p>
              )}

              {actionFeedback && (
                <p
                  role="status"
                  className="text-xs font-semibold text-[#047857] flex items-center gap-1.5"
                >
                  <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{actionFeedback}</span>
                </p>
              )}

              {/* Itemized List */}
              {selectedOrder && (
                <section className="pt-2 border-t border-[#E5DFD3] space-y-2.5">
                  <h3 className="text-sm font-bold text-[#0F2A36]">
                    Consumo detallado ({selectedOrder.items.length})
                  </h3>

                  <ul className="divide-y divide-[#E5DFD3] border border-[#E5DFD3] rounded-xl overflow-hidden">
                    {selectedOrder.items.map((item) => {
                      const lineUsd = item.quantity * item.unitPriceUsd;
                      const isVoidingThis = voidingItemId === item.id;

                      return (
                        <li key={item.id} className="p-3 bg-[#FAF8F4]/60 space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p
                                className={`text-sm font-bold ${
                                  item.voided
                                    ? 'line-through text-[#0F2A36]/50'
                                    : 'text-[#0F2A36]'
                                }`}
                              >
                                <span className="tabular-nums">{item.quantity}x</span> {item.name}
                              </p>
                              {item.notes.trim() && (
                                <p className="text-xs font-medium text-[#0F2A36]/65">
                                  Nota: {item.notes.trim()}
                                </p>
                              )}
                              {item.voided && (
                                <p className="mt-0.5 text-xs font-semibold text-[#B91C1C]">
                                  Anulado ({item.voidDisposition === 'restock' ? 'Devuelto a inventario' : 'Merma'}):{' '}
                                  {item.voidReason}
                                </p>
                              )}
                            </div>

                            <div className="text-right shrink-0 space-y-1">
                              <p
                                className={`text-sm font-extrabold tabular-nums ${
                                  item.voided
                                    ? 'line-through text-[#0F2A36]/40'
                                    : 'text-[#0F2A36]'
                                }`}
                              >
                                ${lineUsd.toFixed(2)}
                              </p>
                              {item.voided ? (
                                <span className="inline-block px-2 py-0.5 rounded-full bg-[#B91C1C]/12 text-[#B91C1C] text-[11px] font-bold">
                                  Anulado
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setVoidingItemId(isVoidingThis ? null : item.id);
                                    setVoidReason('');
                                    setVoidDisposition('restock');
                                    setActionError(null);
                                  }}
                                  className="min-h-12 px-2.5 rounded-lg border border-[#B91C1C]/30 bg-white hover:bg-red-50 text-xs font-bold text-[#B91C1C] inline-flex items-center gap-1 cursor-pointer"
                                >
                                  <Ban className="h-3.5 w-3.5" aria-hidden="true" />
                                  <span>Anular ítem</span>
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Explicit 1-tap Void Resolution Form */}
                          {isVoidingThis && (
                            <div className="p-3 rounded-xl bg-white border border-[#B91C1C]/35 space-y-2.5">
                              <div>
                                <label
                                  htmlFor={`void-reason-${item.id}`}
                                  className="block text-xs font-bold text-[#0F2A36] mb-1"
                                >
                                  Motivo de anulación
                                </label>
                                <input
                                  id={`void-reason-${item.id}`}
                                  type="text"
                                  value={voidReason}
                                  onChange={(e) => setVoidReason(e.target.value)}
                                  placeholder="Ej. Cliente canceló antes de preparar"
                                  className="w-full min-h-12 px-3 rounded-lg border border-[#E5DFD3] bg-[#FAF8F4] text-xs font-medium"
                                />
                              </div>

                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                <button
                                  type="button"
                                  aria-pressed={voidDisposition === 'restock'}
                                  onClick={() => setVoidDisposition('restock')}
                                  className={`min-h-12 px-3 rounded-xl border text-xs font-bold cursor-pointer ${
                                    voidDisposition === 'restock'
                                      ? 'bg-[#047857] border-[#047857] text-white'
                                      : 'bg-[#FAF8F4] border-[#E5DFD3] text-[#0F2A36]'
                                  }`}
                                >
                                  Devolver insumos al inventario
                                </button>
                                <button
                                  type="button"
                                  aria-pressed={voidDisposition === 'merma'}
                                  onClick={() => setVoidDisposition('merma')}
                                  className={`min-h-12 px-3 rounded-xl border text-xs font-bold cursor-pointer ${
                                    voidDisposition === 'merma'
                                      ? 'bg-[#B91C1C] border-[#B91C1C] text-white'
                                      : 'bg-[#FAF8F4] border-[#E5DFD3] text-[#0F2A36]'
                                  }`}
                                >
                                  Registrar como merma
                                </button>
                              </div>

                              <div className="flex justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() => setVoidingItemId(null)}
                                  className="min-h-12 px-3 rounded-xl border border-[#E5DFD3] text-xs font-bold text-[#0F2A36] cursor-pointer"
                                >
                                  Cancelar
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleConfirmVoid()}
                                  className="min-h-12 px-4 rounded-xl bg-[#B91C1C] hover:bg-[#991B1B] text-white text-xs font-bold cursor-pointer"
                                >
                                  Confirmar anulación
                                </button>
                              </div>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}
            </div>
          </aside>
        )}
      </div>

      {/* Checkout Modal */}
      {checkoutOrder && (
        <CheckoutModal
          order={checkoutOrder}
          onClose={() => setCheckoutOrder(null)}
          onSettled={() => {
            setActionFeedback('Cuenta cobrada y cerrada correctamente.');
            setSelectedLocationId(null);
          }}
        />
      )}
    </div>
  );
}
