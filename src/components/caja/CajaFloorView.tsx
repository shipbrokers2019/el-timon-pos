import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Ban,
  CheckCircle2,
  Clock,
  CreditCard,
  Plus,
  Printer,
  Umbrella,
  UtensilsCrossed,
  X,
} from 'lucide-react';
import { calculateOrderTotalUsd, usdToBs } from '../../domain/currency';
import { usePos } from '../../store/PosProvider';
import type { Location, Order, VoidDisposition } from '../../types/pos';
import { getElapsedMinutes } from '../timeUtils';
import { CheckoutModal } from './CheckoutModal';

type ZoneFilter = 'todas' | 'mesas' | 'toldos' | 'por_cobrar';

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

  // Inline add-item form state
  const [showAddItem, setShowAddItem] = useState(false);
  const [addMenuItemId, setAddMenuItemId] = useState<string>('');
  const [addQty, setAddQty] = useState<number>(1);
  const [addNotes, setAddNotes] = useState<string>('');

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

  const availableMenu = useMemo(
    () => state.menu.filter((item) => !item.outOfStock),
    [state.menu],
  );

  const handleSelectLocation = (locationId: string) => {
    setSelectedLocationId(locationId);
    setShowAddItem(false);
    setVoidingItemId(null);
    setVoidReason('');
    setActionError(null);
    setActionFeedback(null);
  };

  const handleAddItemSubmit = async () => {
    if (!selectedLocation || !currentUser) {
      return;
    }
    const targetId = addMenuItemId || availableMenu[0]?.id;
    if (!targetId) {
      setActionError('No hay productos disponibles para agregar.');
      return;
    }
    setActionError(null);
    try {
      await submitComanda({
        locationId: selectedLocation.id,
        waiterId: currentUser.id,
        waiterName: currentUser.name,
        items: [{ menuItemId: targetId, quantity: Math.max(1, addQty), notes: addNotes }],
      });
      setAddQty(1);
      setAddNotes('');
      setShowAddItem(false);
      setActionFeedback('Ítem agregado a la cuenta.');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'No se pudo agregar el ítem.');
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

      {/* Floor Grid + Account Detail Split */}
      <div
        className={`grid gap-5 items-start ${
          selectedLocation ? 'grid-cols-1 xl:grid-cols-[1fr_440px]' : 'grid-cols-1'
        }`}
      >
        <div className="space-y-6">
          {(zoneFilter === 'todas' || zoneFilter === 'mesas') && (
            <section aria-label="Mesas" className="space-y-3">
              <h2 className="text-base font-extrabold text-[#0F2A36] flex items-center gap-2">
                <UtensilsCrossed className="h-4 w-4 text-[#0E7490]" aria-hidden="true" />
                <span>Mesas ({mesas.length})</span>
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
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
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
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
                  {/* Running Totals */}
                  <div className="p-4 rounded-xl bg-[#FAF8F4] border border-[#E5DFD3] flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold text-[#0F2A36]/70">
                        Total cuenta · {selectedOrder.waiterName}
                      </p>
                      <p className="text-2xl font-extrabold text-[#0F2A36] tabular-nums">
                        ${calculateOrderTotalUsd(selectedOrder.items).toFixed(2)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-semibold text-[#0F2A36]/70">En Bolívares</p>
                      <p className="text-lg font-extrabold text-[#0E7490] tabular-nums">
                        Bs{' '}
                        {usdToBs(
                          calculateOrderTotalUsd(selectedOrder.items),
                          rate,
                        ).toFixed(2)}
                      </p>
                    </div>
                  </div>

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

              {/* Quick Add Item */}
              <div className="pt-2 border-t border-[#E5DFD3]">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddItem((prev) => !prev);
                    if (!addMenuItemId && availableMenu[0]) {
                      setAddMenuItemId(availableMenu[0].id);
                    }
                  }}
                  className="min-h-12 px-3.5 rounded-xl border border-[#0E7490]/35 bg-[#0E7490]/8 hover:bg-[#0E7490]/15 text-xs sm:text-sm font-bold text-[#0E7490] inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  <span>{showAddItem ? 'Ocultar formulario' : 'Agregar ítem a la cuenta'}</span>
                </button>

                {showAddItem && (
                  <div className="mt-3 p-3.5 rounded-xl bg-[#FAF8F4] border border-[#E5DFD3] space-y-3">
                    <div>
                      <label
                        htmlFor="caja-add-item-select"
                        className="block text-xs font-bold text-[#0F2A36] mb-1"
                      >
                        Producto
                      </label>
                      <select
                        id="caja-add-item-select"
                        value={addMenuItemId || availableMenu[0]?.id || ''}
                        onChange={(e) => setAddMenuItemId(e.target.value)}
                        className="w-full min-h-12 px-3 rounded-xl border border-[#E5DFD3] bg-white text-sm font-semibold text-[#0F2A36]"
                      >
                        {availableMenu.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name} — ${item.priceUsd.toFixed(2)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label
                          htmlFor="caja-add-qty"
                          className="block text-xs font-bold text-[#0F2A36] mb-1"
                        >
                          Cant.
                        </label>
                        <input
                          id="caja-add-qty"
                          type="number"
                          min={1}
                          value={addQty}
                          onChange={(e) => setAddQty(Math.max(1, Number(e.target.value) || 1))}
                          className="w-full min-h-12 px-3 rounded-xl border border-[#E5DFD3] bg-white text-sm font-bold tabular-nums"
                        />
                      </div>
                      <div className="col-span-2">
                        <label
                          htmlFor="caja-add-notes"
                          className="block text-xs font-bold text-[#0F2A36] mb-1"
                        >
                          Nota (opcional)
                        </label>
                        <input
                          id="caja-add-notes"
                          type="text"
                          value={addNotes}
                          onChange={(e) => setAddNotes(e.target.value)}
                          placeholder="Ej. Sin sal"
                          className="w-full min-h-12 px-3 rounded-xl border border-[#E5DFD3] bg-white text-sm"
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleAddItemSubmit()}
                      className="w-full min-h-12 px-4 rounded-xl bg-[#0E7490] hover:bg-[#0B5E75] text-white text-sm font-bold cursor-pointer"
                    >
                      Confirmar producto
                    </button>
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
