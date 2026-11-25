import { useMemo, useState } from 'react';
import {
  AlertCircle,
  BellRing,
  CheckCircle2,
  Minus,
  Plus,
  ReceiptText,
  Send,
  WifiOff,
  X,
} from 'lucide-react';
import { usePos } from '../../store/PosProvider';
import { usdToBs } from '../../domain/currency';
import type { ComandaStatus, Location, MenuCategory, OrderItem } from '../../types/pos';

interface OrderComposerProps {
  location: Location;
  onClose: () => void;
}

interface CartItemDraft {
  menuItemId: string;
  name: string;
  quantity: number;
  notes: string;
}

const CATEGORIES: ReadonlyArray<'Todos' | MenuCategory> = [
  'Todos',
  'Platos',
  'Entradas',
  'Bebidas',
  'Cócteles',
  'Extras',
];

const COMANDA_STATUS_LABEL: Record<ComandaStatus, string> = {
  pendiente: 'Pendiente',
  en_preparacion: 'En preparación',
  lista: 'Listo',
};

const LOCATION_STATUS_BADGE: Record<Location['status'], { label: string; className: string }> = {
  libre: { label: 'Libre', className: 'bg-[#047857]/12 text-[#047857] border-[#047857]/30' },
  ocupada: { label: 'Ocupada', className: 'bg-[#0E7490] text-white border-[#0E7490]' },
  por_cobrar: { label: 'Por cobrar', className: 'bg-[#B45309] text-white border-[#B45309]' },
};

export function OrderComposer({ location, onClose }: OrderComposerProps) {
  const {
    state,
    currentUser,
    isOnline,
    submitComanda,
    requestCheck,
    acknowledgeKitchenReady,
  } = usePos();

  const [selectedCategory, setSelectedCategory] = useState<'Todos' | MenuCategory>('Todos');
  const [cart, setCart] = useState<CartItemDraft[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  const activeOrder = useMemo(
    () =>
      state.orders.find(
        (order) =>
          order.status === 'abierta' &&
          (order.id === location.activeOrderId || order.locationId === location.id),
      ) ?? null,
    [location.activeOrderId, location.id, state.orders],
  );

  const orderRounds = useMemo(() => {
    if (!activeOrder) {
      return [];
    }
    const grouped = new Map<string, OrderItem[]>();
    for (const item of activeOrder.items) {
      const list = grouped.get(item.comandaId);
      if (list) {
        list.push(item);
      } else {
        grouped.set(item.comandaId, [item]);
      }
    }
    return Array.from(grouped.entries()).map(([comandaId, items], idx) => {
      const comanda = state.comandas.find((c) => c.id === comandaId) ?? null;
      return {
        comandaId,
        roundNumber: comanda?.roundNumber ?? idx + 1,
        status: comanda ? COMANDA_STATUS_LABEL[comanda.status] : 'Barra / Directo',
        items,
      };
    });
  }, [activeOrder, state.comandas]);

  const filteredMenu = useMemo(
    () =>
      selectedCategory === 'Todos'
        ? state.menu
        : state.menu.filter((item) => item.category === selectedCategory),
    [selectedCategory, state.menu],
  );

  const handleAddMenuItem = (menuItemId: string, name: string) => {
    setErrorMessage(null);
    setFeedbackMessage(null);
    setCart((prev) => {
      const existingIndex = prev.findIndex((entry) => entry.menuItemId === menuItemId);
      if (existingIndex === -1) {
        return [...prev, { menuItemId, name, quantity: 1, notes: '' }];
      }
      return prev.map((entry, idx) =>
        idx === existingIndex ? { ...entry, quantity: entry.quantity + 1 } : entry,
      );
    });
  };

  const handleStepQuantity = (menuItemId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((entry) =>
          entry.menuItemId === menuItemId
            ? { ...entry, quantity: entry.quantity + delta }
            : entry,
        )
        .filter((entry) => entry.quantity > 0),
    );
  };

  const handleNoteChange = (menuItemId: string, notes: string) => {
    setCart((prev) =>
      prev.map((entry) =>
        entry.menuItemId === menuItemId ? { ...entry, notes } : entry,
      ),
    );
  };

  const handleSubmitRound = async () => {
    if (!currentUser || cart.length === 0 || isSubmitting) {
      return;
    }
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await submitComanda({
        locationId: location.id,
        waiterId: currentUser.id,
        waiterName: currentUser.name,
        items: cart.map((entry) => ({
          menuItemId: entry.menuItemId,
          quantity: entry.quantity,
          notes: entry.notes,
        })),
      });
      setCart([]);
      setFeedbackMessage(
        isOnline
          ? 'Comanda enviada correctamente.'
          : 'Comanda guardada localmente en esta tablet.',
      );
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'No se pudo enviar la comanda',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRequestCheck = async () => {
    setErrorMessage(null);
    try {
      await requestCheck(location.id);
      setFeedbackMessage('Cuenta solicitada a Caja.');
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'No se pudo pedir la cuenta',
      );
    }
  };

  const statusBadge = LOCATION_STATUS_BADGE[location.status];

  return (
    <aside
      aria-label={`Comanda de ${location.label}`}
      className="bg-[#F2EDE4] border border-[#0F2A36]/15 rounded-2xl flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="px-4 py-3.5 border-b border-[#0F2A36]/15 bg-[#FAF8F4] flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <h2 className="text-xl font-extrabold text-[#0F2A36] truncate">
            {location.label}
          </h2>
          <span
            className={`inline-flex items-center px-2.5 py-0.5 rounded-full border text-xs font-bold ${statusBadge.className}`}
          >
            {statusBadge.label}
          </span>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar panel de pedido"
          className="min-h-12 min-w-12 rounded-xl border border-[#0F2A36]/15 bg-[#F2EDE4] hover:bg-white flex items-center justify-center text-[#0F2A36] cursor-pointer"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      <div className="p-4 space-y-4 overflow-y-auto max-h-[calc(100vh-11rem)]">
        {/* Kitchen ready alert acknowledgement */}
        {location.kitchenReadyAlert && (
          <div className="p-3 rounded-xl bg-[#047857] text-white flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-bold">
              <BellRing className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Listo en cocina</span>
            </div>
            <button
              type="button"
              onClick={() => void acknowledgeKitchenReady(location.id)}
              className="min-h-12 px-3 rounded-lg bg-white text-[#047857] text-xs font-bold cursor-pointer"
            >
              Confirmar entrega
            </button>
          </div>
        )}

        {/* Discrete offline banner */}
        {!isOnline && (
          <div
            role="status"
            className="p-3 rounded-xl bg-[#B45309]/12 border border-[#B45309]/35 text-[#78350F] text-xs font-semibold flex items-start gap-2"
          >
            <WifiOff className="h-4 w-4 shrink-0 mt-0.5 text-[#B45309]" aria-hidden="true" />
            <span>
              Sin Wi-Fi: el pedido se guardará en esta tablet y se enviará al recuperar señal
            </span>
          </div>
        )}

        {/* Category tabs */}
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Categorías del menú">
          {CATEGORIES.map((category) => {
            const active = selectedCategory === category;
            return (
              <button
                key={category}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setSelectedCategory(category)}
                className={`min-h-12 px-3 rounded-xl border text-xs font-bold transition-colors cursor-pointer ${
                  active
                    ? 'bg-[#0E7490] border-[#0E7490] text-white'
                    : 'bg-[#FAF8F4] border-[#0F2A36]/15 text-[#0F2A36] hover:bg-white'
                }`}
              >
                {category}
              </button>
            );
          })}
        </div>

        {/* Menu item grid (menu prices visible for offering; no caja totals or numeric stock) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {filteredMenu.map((item) => (
            <button
              key={item.id}
              type="button"
              disabled={item.outOfStock}
              onClick={() => handleAddMenuItem(item.id, item.name)}
              className={`min-h-14 p-3 rounded-xl border text-left flex items-center justify-between gap-2 transition-colors ${
                item.outOfStock
                  ? 'bg-[#FAF8F4]/60 border-[#0F2A36]/10 text-[#0F2A36]/45 cursor-not-allowed'
                  : 'bg-[#FAF8F4] hover:bg-white border-[#0F2A36]/15 text-[#0F2A36] cursor-pointer'
              }`}
            >
              <div className="min-w-0">
                <p className="text-sm font-bold leading-snug truncate">{item.name}</p>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                  <span
                    className={`text-xs font-extrabold tabular-nums ${
                      item.outOfStock ? 'text-[#0F2A36]/45' : 'text-[#0E7490]'
                    }`}
                  >
                    ${item.priceUsd.toFixed(2)}
                  </span>
                  <span
                    className={`text-[11px] font-semibold tabular-nums ${
                      item.outOfStock ? 'text-[#0F2A36]/40' : 'text-[#0F2A36]/70'
                    }`}
                  >
                    Bs {usdToBs(item.priceUsd, state.settings.exchangeRate).toFixed(2)}
                  </span>
                  <span className="text-[11px] font-medium text-[#0F2A36]/55">
                    {item.category}
                  </span>
                </div>
              </div>
              {item.outOfStock ? (
                <span className="shrink-0 px-2 py-0.5 rounded-full bg-[#B91C1C] text-white text-[11px] font-bold">
                  Agotado
                </span>
              ) : (
                <Plus className="h-4 w-4 shrink-0 text-[#0E7490]" aria-hidden="true" />
              )}
            </button>
          ))}
        </div>

        {/* Current round cart */}
        <section className="pt-3 border-t border-[#0F2A36]/15 space-y-2.5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-[#0F2A36]">Ronda actual</h3>
            <span className="text-xs font-semibold text-[#0F2A36]/70 tabular-nums">
              {cart.reduce((sum, entry) => sum + entry.quantity, 0)} ítem(s)
            </span>
          </div>

          {cart.length === 0 ? (
            <p className="text-xs font-medium text-[#0F2A36]/70 py-2">
              Toca un producto del menú para agregarlo a la comanda.
            </p>
          ) : (
            <ul className="space-y-2">
              {cart.map((entry) => (
                <li
                  key={entry.menuItemId}
                  className="p-3 rounded-xl bg-[#FAF8F4] border border-[#0F2A36]/15 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-bold text-[#0F2A36]">{entry.name}</span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        aria-label={`Quitar uno de ${entry.name}`}
                        onClick={() => handleStepQuantity(entry.menuItemId, -1)}
                        className="h-12 w-12 rounded-xl border border-[#0F2A36]/20 bg-[#F2EDE4] hover:bg-white flex items-center justify-center text-[#0F2A36] cursor-pointer"
                      >
                        <Minus className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <span className="w-7 text-center text-sm font-extrabold tabular-nums">
                        {entry.quantity}
                      </span>
                      <button
                        type="button"
                        aria-label={`Agregar uno de ${entry.name}`}
                        onClick={() => handleStepQuantity(entry.menuItemId, 1)}
                        className="h-12 w-12 rounded-xl border border-[#0F2A36]/20 bg-[#F2EDE4] hover:bg-white flex items-center justify-center text-[#0F2A36] cursor-pointer"
                      >
                        <Plus className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                  <input
                    type="text"
                    value={entry.notes}
                    aria-label={`Nota para ${entry.name}`}
                    onChange={(e) => handleNoteChange(entry.menuItemId, e.target.value)}
                    placeholder="Nota para cocina (ej. Sin cebolla, bien fría)"
                    className="w-full min-h-12 px-3 rounded-lg bg-white border border-[#0F2A36]/20 text-xs font-medium text-[#0F2A36] placeholder:text-[#0F2A36]/50 focus:outline-2 focus:outline-[#0E7490]"
                  />
                </li>
              ))}
            </ul>
          )}

          {errorMessage && (
            <p
              role="alert"
              className="text-xs font-semibold text-[#B91C1C] flex items-center gap-1.5"
            >
              <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{errorMessage}</span>
            </p>
          )}

          {feedbackMessage && (
            <p
              role="status"
              className="text-xs font-semibold text-[#047857] flex items-center gap-1.5"
            >
              <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{feedbackMessage}</span>
            </p>
          )}

          <button
            type="button"
            disabled={cart.length === 0 || isSubmitting}
            onClick={() => void handleSubmitRound()}
            className="w-full min-h-12 px-4 rounded-xl bg-[#0E7490] hover:bg-[#0B5E75] disabled:bg-[#0F2A36]/25 disabled:text-white/80 text-white text-sm font-bold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:cursor-not-allowed"
          >
            <Send className="h-4 w-4" aria-hidden="true" />
            <span>Enviar Comanda</span>
          </button>
        </section>

        {/* Existing rounds summary (NO totals, NO void buttons) */}
        {orderRounds.length > 0 && (
          <section className="pt-3 border-t border-[#0F2A36]/15 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-[#0F2A36]">Rondas enviadas</h3>
              {location.status === 'ocupada' && (
                <button
                  type="button"
                  onClick={() => void handleRequestCheck()}
                  className="min-h-12 px-3.5 rounded-xl bg-[#B45309] hover:bg-[#92400E] text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <ReceiptText className="h-4 w-4" aria-hidden="true" />
                  <span>Pedir cuenta</span>
                </button>
              )}
              {location.status === 'por_cobrar' && (
                <span className="px-3 py-1.5 rounded-xl bg-[#B45309]/15 border border-[#B45309]/35 text-[#78350F] text-xs font-bold">
                  Cuenta solicitada
                </span>
              )}
            </div>

            <div className="space-y-2">
              {orderRounds.map((round) => (
                <div
                  key={round.comandaId}
                  className="p-3 rounded-xl bg-[#FAF8F4] border border-[#0F2A36]/15 space-y-1.5"
                >
                  <div className="flex items-center justify-between text-xs font-bold text-[#0F2A36]/80">
                    <span className="tabular-nums">Ronda {round.roundNumber}</span>
                    <span>{round.status}</span>
                  </div>
                  <ul className="space-y-1">
                    {round.items.map((item) => (
                      <li
                        key={item.id}
                        className={`text-xs flex items-start justify-between gap-2 ${
                          item.voided ? 'line-through text-[#0F2A36]/50' : 'text-[#0F2A36]'
                        }`}
                      >
                        <span>
                          <strong className="tabular-nums">{item.quantity}x</strong> {item.name}
                          {item.notes.trim() ? ` — ${item.notes.trim()}` : ''}
                        </span>
                        {item.voided && (
                          <span className="shrink-0 text-[11px] font-bold text-[#B91C1C]">
                            Anulado
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </aside>
  );
}
