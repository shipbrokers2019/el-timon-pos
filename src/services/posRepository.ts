import {
  calculateOrderBreakdown,
  calculatePaymentSummary,
  roundMoney,
  summarizePaymentsByMethod,
} from '../domain/currency';
import { formatTicketText, type TicketPayload } from '../domain/escpos';
import {
  applyComandaRecipeDeductions,
  applyVoidInventoryResolution,
} from '../domain/recipes';
import type {
  Comanda,
  ComandaStatus,
  Ingredient,
  InventoryMovement,
  MenuItem,
  Order,
  OrderItem,
  PaymentEntry,
  PosState,
  PreFacturaSnapshot,
  PrintJob,
  PrintStatus,
  PrinterConfig,
  Shift,
  UserProfile,
  VoidDisposition,
} from '../types/pos';
import { createEmptyPaymentMethodTotals, createInitialPosState } from './seedData';

export const POS_STORAGE_KEY = 'brisa_pos_state_v1';
export const POS_OFFLINE_QUEUE_KEY = 'brisa_pos_offline_queue_v1';
export const POS_BROADCAST_CHANNEL = 'brisa_pos_sync_v1';

export interface SubmitComandaInput {
  comandaId?: string;
  locationId: string;
  waiterId: string;
  waiterName: string;
  items: Array<{ menuItemId: string; quantity: number; notes: string }>;
  isOffline?: boolean;
}

export interface SubmitComandaResult {
  order: Order;
  comanda: Comanda | null;
  printJob: PrintJob | null;
}

export interface CloseShiftResult {
  shift: Shift;
  printJob: PrintJob;
}

export interface PosRepository {
  getState(): PosState;
  getPendingSyncCount(): number;
  subscribe(listener: (state: PosState) => void): () => void;
  submitComanda(input: SubmitComandaInput): Promise<SubmitComandaResult>;
  syncOfflineQueue(): Promise<void>;
  updateComandaStatus(comandaId: string, status: ComandaStatus): Promise<void>;
  acknowledgeKitchenReady(locationId: string): Promise<void>;
  requestCheck(locationId: string): Promise<void>;
  releaseLocation(locationId: string): Promise<void>;
  voidOrderItem(
    orderId: string,
    itemId: string,
    disposition: VoidDisposition,
    reason: string,
    adminUser: Pick<UserProfile, 'id' | 'name'>,
  ): Promise<void>;
  settleOrder(orderId: string, payments: PaymentEntry[]): Promise<Order>;
  openShift(userId: string): Promise<Shift>;
  closeShift(userId: string, notes?: string): Promise<CloseShiftResult>;
  adjustIngredientStock(
    ingredientId: string,
    delta: number,
    type: 'reposicion' | 'merma' | 'ajuste',
    reason: string,
    userId: string,
  ): Promise<Ingredient>;
  saveIngredient(ingredient: Omit<Ingredient, 'id'> & { id?: string }): Promise<Ingredient>;
  saveMenuItem(item: Omit<MenuItem, 'id'> & { id?: string }): Promise<MenuItem>;
  toggleMenuOutOfStock(menuItemId: string, outOfStock?: boolean): Promise<MenuItem>;
  updateExchangeRate(rate: number, source?: string): Promise<void>;
  saveUser(user: Omit<UserProfile, 'id'> & { id?: string }): Promise<UserProfile>;
  savePrinterConfig(printer: PrinterConfig): Promise<void>;
  createPreCuentaPrintJob(orderId: string): Promise<PrintJob>;
  createTestPrintJob(): Promise<PrintJob>;
  updatePrintJobStatus(
    printJobId: string,
    status: PrintStatus,
    meta?: { printedAt?: string; error?: string },
  ): Promise<void>;
  resetDemoData(): Promise<void>;
}

interface BroadcastSyncMessage {
  sourceId: string;
  state: PosState;
  offlineQueue: string[];
}

function createId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function roundQuantity(value: number): number {
  const absRounded = Math.round((Math.abs(value) + 1e-9) * 1000) / 1000;
  if (absRounded === 0) {
    return 0;
  }
  return value < 0 ? -absRounded : absRounded;
}

function readJsonStorage<T>(key: string): T | null {
  if (typeof localStorage === 'undefined') {
    return null;
  }
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJsonStorage(key: string, value: unknown): void {
  if (typeof localStorage === 'undefined') {
    return;
  }
  localStorage.setItem(key, JSON.stringify(value));
}

function buildPrintJobRecord(params: {
  id?: string;
  type: PrintJob['type'];
  referenceId: string;
  title: string;
  payload: TicketPayload;
  createdAt: string;
}): PrintJob {
  return {
    id: params.id ?? createId('pj'),
    type: params.type,
    referenceId: params.referenceId,
    title: params.title,
    textPreview: formatTicketText(params.payload),
    status: 'pending',
    createdAt: params.createdAt,
  };
}

export interface LocalPosRepositoryOptions {
  /** Optional suffix to isolate localStorage keys per station role in cloud mode. */
  storageKeySuffix?: string;
  /** Disable BroadcastChannel when Firestore onSnapshot is the authoritative sync layer. */
  enableBroadcastChannel?: boolean;
}

/**
 * Offline-first local repository backed by localStorage and BroadcastChannel so
 * Mesonero, Cocina and Caja tabs stay synchronized in real time.
 */
export class LocalPosRepository implements PosRepository {
  private state: PosState;
  private offlineQueue: Set<string>;
  private readonly listeners = new Set<(state: PosState) => void>();
  private readonly instanceId = createId('tab');
  private readonly storageKey: string;
  private readonly offlineQueueKey: string;
  private readonly enableBroadcastChannel: boolean;
  private channel: BroadcastChannel | null = null;

  constructor(options: LocalPosRepositoryOptions = {}) {
    const suffix = options.storageKeySuffix ? `_${options.storageKeySuffix}` : '';
    this.storageKey = `${POS_STORAGE_KEY}${suffix}`;
    this.offlineQueueKey = `${POS_OFFLINE_QUEUE_KEY}${suffix}`;
    this.enableBroadcastChannel = options.enableBroadcastChannel ?? true;

    const savedState = readJsonStorage<PosState>(this.storageKey);
    if (savedState && Array.isArray(savedState.locations) && savedState.locations.length > 0) {
      let needsPersist = false;
      if (savedState.settings?.printer?.restaurantName === 'Brisa Marina Beach Club') {
        savedState.settings.printer.restaurantName = 'El Timón Restaurante';
        needsPersist = true;
      }
      const baselineLocations = createInitialPosState().locations;
      const savedById = new Map(savedState.locations.map((loc) => [loc.id, loc]));
      if (baselineLocations.some((loc) => !savedById.has(loc.id))) {
        const mergedMap = new Map(baselineLocations.map((loc) => [loc.id, loc]));
        for (const loc of savedState.locations) {
          mergedMap.set(loc.id, loc);
        }
        savedState.locations = Array.from(mergedMap.values()).sort(
          (a, b) => a.zone.localeCompare(b.zone) || a.number - b.number,
        );
        needsPersist = true;
      }
      if (needsPersist) {
        writeJsonStorage(this.storageKey, savedState);
      }
      this.state = savedState;
    } else {
      this.state = createInitialPosState();
      writeJsonStorage(this.storageKey, this.state);
    }

    const savedQueue = readJsonStorage<string[]>(this.offlineQueueKey);
    this.offlineQueue = new Set(Array.isArray(savedQueue) ? savedQueue : []);

    this.ensureChannel();
  }

  private ensureChannel(): BroadcastChannel | null {
    if (!this.enableBroadcastChannel) {
      return null;
    }
    if (this.channel) {
      return this.channel;
    }
    if (typeof BroadcastChannel === 'undefined') {
      return null;
    }
    const ch = new BroadcastChannel(POS_BROADCAST_CHANNEL);
    ch.onmessage = (event: MessageEvent<BroadcastSyncMessage>) => {
      if (!event.data || event.data.sourceId === this.instanceId) {
        return;
      }
      this.state = event.data.state;
      this.offlineQueue = new Set(event.data.offlineQueue ?? []);
      this.notifyListeners();
    };
    this.channel = ch;
    return ch;
  }

  getState(): PosState {
    return this.state;
  }

  getPendingSyncCount(): number {
    const pendingComandaIds = new Set(
      this.state.comandas.filter((c) => c.pendingSync === true).map((c) => c.id),
    );
    for (const id of this.offlineQueue) {
      pendingComandaIds.add(id);
    }
    return pendingComandaIds.size;
  }

  getOfflineQueueIds(): string[] {
    return Array.from(this.offlineQueue);
  }

  subscribe(listener: (state: PosState) => void): () => void {
    this.ensureChannel();
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Replaces local snapshot from an authoritative external source (e.g. Firestore listeners)
   * without re-broadcasting redundant local writes unless requested.
   */
  replaceState(nextState: PosState): void {
    this.state = nextState;
    writeJsonStorage(this.storageKey, this.state);
    this.notifyListeners();
  }

  dispose(): void {
    this.channel?.close();
    this.channel = null;
    this.listeners.clear();
  }

  private postBroadcast(message: BroadcastSyncMessage): void {
    const channel = this.ensureChannel();
    if (!channel) {
      return;
    }
    try {
      channel.postMessage(message);
    } catch {
      // Recover if the channel was closed externally (e.g. React StrictMode remount)
      this.channel = null;
      const reopened = this.ensureChannel();
      try {
        reopened?.postMessage(message);
      } catch {
        // Ignore broadcast failure; localStorage persistence still succeeded
      }
    }
  }

  private commit(nextState: PosState): void {
    this.state = nextState;
    writeJsonStorage(this.storageKey, this.state);
    writeJsonStorage(this.offlineQueueKey, Array.from(this.offlineQueue));
    this.postBroadcast({
      sourceId: this.instanceId,
      state: this.state,
      offlineQueue: Array.from(this.offlineQueue),
    });
    this.notifyListeners();
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  async submitComanda(input: SubmitComandaInput): Promise<SubmitComandaResult> {
    if (input.items.length === 0) {
      throw new Error('La comanda debe incluir al menos un ítem');
    }

    const location = this.state.locations.find((loc) => loc.id === input.locationId);
    if (!location) {
      throw new Error(`Ubicación no encontrada: ${input.locationId}`);
    }

    const nowIso = new Date().toISOString();
    const comandaId = input.comandaId ?? createId('cmd');

    // Idempotency guard across ALL orders (open and already-closed)
    const existingOrderForComanda = this.state.orders.find((o) =>
      o.items.some((item) => item.comandaId === comandaId),
    );
    if (existingOrderForComanda) {
      const existingComanda =
        this.state.comandas.find((c) => c.id === comandaId) ?? null;
      const existingJob = existingComanda
        ? this.state.printJobs.find((j) => j.referenceId === existingComanda.id) ?? null
        : null;
      return {
        order: existingOrderForComanda,
        comanda: existingComanda,
        printJob: existingJob,
      };
    }

    const menuById = new Map(this.state.menu.map((item) => [item.id, item]));
    const activeShift = this.state.shifts.find((shift) => shift.status === 'abierto');

    let order =
      this.state.orders.find(
        (o) =>
          o.status === 'abierta' &&
          (o.id === location.activeOrderId || o.locationId === location.id),
      ) ?? null;

    const isNewOrder = order === null;
    if (!order) {
      order = {
        id: createId('ord'),
        locationId: location.id,
        locationLabel: location.label,
        zone: location.zone,
        waiterId: input.waiterId,
        waiterName: input.waiterName,
        shiftId: activeShift?.id ?? '',
        status: 'abierta',
        items: [],
        totalUsd: 0,
        totalBs: 0,
        exchangeRate: this.state.settings.exchangeRate,
        payments: [],
        openedAt: nowIso,
      };
    }

    const existingRounds = new Set(order.items.map((item) => item.comandaId));
    const roundNumber = existingRounds.size + 1;

    const newOrderItems: OrderItem[] = input.items.map((entry, idx) => {
      if (!Number.isFinite(entry.quantity) || entry.quantity <= 0) {
        throw new Error('La cantidad del producto debe ser mayor que 0');
      }
      const menuItem = menuById.get(entry.menuItemId);
      if (!menuItem) {
        throw new Error(`Producto no encontrado en el menú: ${entry.menuItemId}`);
      }
      return {
        id: `${comandaId}-oi-${idx + 1}`,
        menuItemId: menuItem.id,
        name: menuItem.name,
        quantity: entry.quantity,
        unitPriceUsd: menuItem.priceUsd,
        notes: entry.notes,
        sendsToKitchen: menuItem.sendsToKitchen,
        comandaId,
      };
    });

    const updatedOrderItems = [...order.items, ...newOrderItems];
    const breakdown = calculateOrderBreakdown(
      updatedOrderItems,
      this.state.settings.exchangeRate,
    );

    const updatedOrder: Order = {
      ...order,
      waiterId: input.waiterId,
      waiterName: input.waiterName,
      items: updatedOrderItems,
      subtotalUsd: breakdown.subtotalUsd,
      ivaRate: breakdown.ivaRate,
      ivaUsd: breakdown.ivaUsd,
      ivaBs: breakdown.ivaBs,
      totalUsd: breakdown.totalUsd,
      totalBs: breakdown.totalBs,
      exchangeRate: this.state.settings.exchangeRate,
    };

    // Deduct recipe ingredients for ALL items in the round (kitchen & bar/extras)
    const deductionEnvelope: Comanda = {
      id: comandaId,
      sequenceNumber: this.state.nextComandaSeq,
      orderId: updatedOrder.id,
      locationId: location.id,
      locationLabel: location.label,
      zone: location.zone,
      roundNumber,
      waiterId: input.waiterId,
      waiterName: input.waiterName,
      items: newOrderItems,
      status: 'pendiente',
      printStatus: 'pending',
      createdAt: nowIso,
      updatedAt: nowIso,
      pendingSync: Boolean(input.isOffline),
      isVoidAlert: false,
    };

    const { ingredients: updatedIngredients, newMovements } =
      applyComandaRecipeDeductions(
        this.state.ingredients,
        this.state.menu,
        deductionEnvelope,
        this.state.movements,
        nowIso,
      );

    // Non-kitchen filtering: only sendsToKitchen === true items go to Cocina KDS & 80mm printer
    const kitchenItems = newOrderItems.filter((item) => item.sendsToKitchen === true);
    let createdComanda: Comanda | null = null;
    let createdPrintJob: PrintJob | null = null;
    let nextComandaSeq = this.state.nextComandaSeq;

    if (kitchenItems.length > 0) {
      createdComanda = {
        ...deductionEnvelope,
        sequenceNumber: nextComandaSeq,
        items: kitchenItems,
      };
      nextComandaSeq += 1;

      createdPrintJob = buildPrintJobRecord({
        id: `pj-${createdComanda.id}`,
        type: 'comanda',
        referenceId: createdComanda.id,
        title: `Comanda #${createdComanda.sequenceNumber} · ${location.label}`,
        payload: {
          type: 'comanda',
          restaurantName: this.state.settings.printer.restaurantName,
          comanda: createdComanda,
        },
        createdAt: nowIso,
      });
    }

    if (input.isOffline === true) {
      this.offlineQueue.add(comandaId);
    }

    const updatedLocations = this.state.locations.map((loc) =>
      loc.id === location.id
        ? {
            ...loc,
            status: 'ocupada' as const,
            activeOrderId: updatedOrder.id,
            pendingSync: input.isOffline === true ? true : Boolean(loc.pendingSync),
          }
        : loc,
    );

    const updatedOrders = isNewOrder
      ? [...this.state.orders, updatedOrder]
      : this.state.orders.map((o) => (o.id === updatedOrder.id ? updatedOrder : o));

    this.commit({
      ...this.state,
      locations: updatedLocations,
      ingredients: updatedIngredients,
      orders: updatedOrders,
      comandas: createdComanda ? [...this.state.comandas, createdComanda] : this.state.comandas,
      movements:
        newMovements.length > 0
          ? [...this.state.movements, ...newMovements]
          : this.state.movements,
      printJobs: createdPrintJob
        ? [...this.state.printJobs, createdPrintJob]
        : this.state.printJobs,
      nextComandaSeq,
    });

    return {
      order: updatedOrder,
      comanda: createdComanda,
      printJob: createdPrintJob,
    };
  }

  async syncOfflineQueue(): Promise<void> {
    let nextIngredients = this.state.ingredients;
    let nextMovements = this.state.movements;
    const nowIso = new Date().toISOString();

    for (const comandaId of this.offlineQueue) {
      const matchingComanda = this.state.comandas.find((c) => c.id === comandaId);
      if (matchingComanda) {
        const res = applyComandaRecipeDeductions(
          nextIngredients,
          this.state.menu,
          matchingComanda,
          nextMovements,
          nowIso,
        );
        nextIngredients = res.ingredients;
        if (res.newMovements.length > 0) {
          nextMovements = [...nextMovements, ...res.newMovements];
        }
      }
    }

    this.offlineQueue.clear();

    const updatedLocations = this.state.locations.map((loc) =>
      loc.pendingSync ? { ...loc, pendingSync: false } : loc,
    );
    const updatedComandas = this.state.comandas.map((comanda) =>
      comanda.pendingSync
        ? { ...comanda, pendingSync: false, updatedAt: nowIso }
        : comanda,
    );

    this.commit({
      ...this.state,
      locations: updatedLocations,
      comandas: updatedComandas,
      ingredients: nextIngredients,
      movements: nextMovements,
    });
  }

  async updateComandaStatus(comandaId: string, status: ComandaStatus): Promise<void> {
    const target = this.state.comandas.find((c) => c.id === comandaId);
    if (!target) {
      throw new Error(`Comanda no encontrada: ${comandaId}`);
    }

    const nowIso = new Date().toISOString();
    const updatedComandas = this.state.comandas.map((comanda) =>
      comanda.id === comandaId
        ? {
            ...comanda,
            status,
            updatedAt: nowIso,
            completedAt: status === 'lista' ? nowIso : comanda.completedAt,
          }
        : comanda,
    );

    const updatedLocations =
      status === 'lista'
        ? this.state.locations.map((loc) =>
            loc.id === target.locationId ? { ...loc, kitchenReadyAlert: true } : loc,
          )
        : this.state.locations;

    this.commit({
      ...this.state,
      comandas: updatedComandas,
      locations: updatedLocations,
    });
  }

  async acknowledgeKitchenReady(locationId: string): Promise<void> {
    const updatedLocations = this.state.locations.map((loc) =>
      loc.id === locationId ? { ...loc, kitchenReadyAlert: false } : loc,
    );

    this.commit({
      ...this.state,
      locations: updatedLocations,
    });
  }

  async requestCheck(locationId: string): Promise<void> {
    const location = this.state.locations.find((loc) => loc.id === locationId);
    if (!location) {
      throw new Error(`Ubicación no encontrada: ${locationId}`);
    }
    if (!location.activeOrderId) {
      throw new Error(`La ubicación ${location.label} no tiene una orden abierta`);
    }

    const updatedLocations = this.state.locations.map((loc) =>
      loc.id === locationId ? { ...loc, status: 'por_cobrar' as const } : loc,
    );

    this.commit({
      ...this.state,
      locations: updatedLocations,
    });
  }

  async releaseLocation(locationId: string): Promise<void> {
    const updatedLocations = this.state.locations.map((loc) =>
      loc.id === locationId
        ? {
            ...loc,
            status: 'libre' as const,
            activeOrderId: null,
            kitchenReadyAlert: false,
            pendingSync: false,
            preFacturaReady: false,
          }
        : loc,
    );

    this.commit({
      ...this.state,
      locations: updatedLocations,
    });
  }

  async voidOrderItem(
    orderId: string,
    itemId: string,
    disposition: VoidDisposition,
    reason: string,
    adminUser: Pick<UserProfile, 'id' | 'name'>,
  ): Promise<void> {
    const order = this.state.orders.find((o) => o.id === orderId);
    if (!order) {
      throw new Error(`Orden no encontrada: ${orderId}`);
    }
    if (order.status === 'cerrada') {
      throw new Error('No se puede anular un ítem de una orden ya cerrada');
    }

    const targetItem = order.items.find((item) => item.id === itemId);
    if (!targetItem) {
      throw new Error(`Ítem no encontrado en la orden: ${itemId}`);
    }
    if (targetItem.voided === true) {
      return;
    }

    const nowIso = new Date().toISOString();
    const voidedItem: OrderItem = {
      ...targetItem,
      voided: true,
      voidReason: reason,
      voidDisposition: disposition,
      voidedBy: adminUser.id,
      voidedAt: nowIso,
    };

    const updatedItems = order.items.map((item) =>
      item.id === itemId ? voidedItem : item,
    );
    const breakdown = calculateOrderBreakdown(
      updatedItems,
      this.state.settings.exchangeRate,
    );

    const updatedOrder: Order = {
      ...order,
      items: updatedItems,
      subtotalUsd: breakdown.subtotalUsd,
      ivaRate: breakdown.ivaRate,
      ivaUsd: breakdown.ivaUsd,
      ivaBs: breakdown.ivaBs,
      totalUsd: breakdown.totalUsd,
      totalBs: breakdown.totalBs,
      exchangeRate: this.state.settings.exchangeRate,
    };

    const { ingredients: updatedIngredients, newMovements } =
      applyVoidInventoryResolution(
        this.state.ingredients,
        this.state.menu,
        voidedItem,
        disposition,
        reason,
        adminUser.id,
        nowIso,
      );

    let nextComandaSeq = this.state.nextComandaSeq;
    let updatedComandas = this.state.comandas;
    let updatedPrintJobs = this.state.printJobs;

    if (voidedItem.sendsToKitchen === true) {
      const sourceComanda = this.state.comandas.find(
        (c) => c.id === voidedItem.comandaId,
      );
      const voidComanda: Comanda = {
        id: createId('cmd-void'),
        sequenceNumber: nextComandaSeq,
        orderId: order.id,
        locationId: order.locationId,
        locationLabel: order.locationLabel,
        zone: order.zone,
        roundNumber: sourceComanda?.roundNumber ?? 1,
        waiterId: order.waiterId,
        waiterName: order.waiterName,
        items: [voidedItem],
        status: 'pendiente',
        printStatus: 'pending',
        createdAt: nowIso,
        updatedAt: nowIso,
        isVoidAlert: true,
        voidReason: reason,
      };
      nextComandaSeq += 1;
      updatedComandas = [...updatedComandas, voidComanda];

      const voidPrintJob = buildPrintJobRecord({
        id: `pj-${voidComanda.id}`,
        type: 'anulacion',
        referenceId: voidComanda.id,
        title: `ANULACIÓN · ${order.locationLabel}`,
        payload: {
          type: 'anulacion',
          restaurantName: this.state.settings.printer.restaurantName,
          locationLabel: order.locationLabel,
          waiterName: order.waiterName,
          item: voidedItem,
          reason,
          timestampIso: nowIso,
        },
        createdAt: nowIso,
      });
      updatedPrintJobs = [...updatedPrintJobs, voidPrintJob];
    }

    this.commit({
      ...this.state,
      ingredients: updatedIngredients,
      orders: this.state.orders.map((o) => (o.id === order.id ? updatedOrder : o)),
      comandas: updatedComandas,
      movements:
        newMovements.length > 0
          ? [...this.state.movements, ...newMovements]
          : this.state.movements,
      printJobs: updatedPrintJobs,
      nextComandaSeq,
    });
  }

  async settleOrder(orderId: string, payments: PaymentEntry[]): Promise<Order> {
    const order = this.state.orders.find((o) => o.id === orderId);
    if (!order) {
      throw new Error(`Orden no encontrada: ${orderId}`);
    }
    if (order.status === 'cerrada') {
      throw new Error('La orden ya fue cerrada');
    }

    const rate = this.state.settings.exchangeRate;
    const breakdown = calculateOrderBreakdown(order.items, rate);
    const summary = calculatePaymentSummary(breakdown.totalUsd, payments, rate);
    if (!summary.isSettled) {
      throw new Error(
        `Pago insuficiente: faltan $${summary.remainingUsd.toFixed(2)} para cerrar la cuenta`,
      );
    }

    const nowIso = new Date().toISOString();
    const activeShift = this.state.shifts.find((s) => s.status === 'abierto');
    const resolvedShiftId = order.shiftId || activeShift?.id || '';

    const closedOrder: Order = {
      ...order,
      shiftId: resolvedShiftId,
      status: 'cerrada',
      subtotalUsd: breakdown.subtotalUsd,
      ivaRate: breakdown.ivaRate,
      ivaUsd: breakdown.ivaUsd,
      ivaBs: breakdown.ivaBs,
      totalUsd: breakdown.totalUsd,
      totalBs: breakdown.totalBs,
      exchangeRate: rate,
      payments: payments.map((payment) => ({ ...payment })),
      closedAt: nowIso,
    };

    const updatedOrders = this.state.orders.map((o) =>
      o.id === closedOrder.id ? closedOrder : o,
    );

    const updatedShifts = this.state.shifts.map((shift) => {
      if (shift.status !== 'abierto' || shift.id !== resolvedShiftId) {
        return shift;
      }
      const shiftOrders = updatedOrders.filter(
        (o) => o.status === 'cerrada' && o.shiftId === shift.id,
      );
      return {
        ...shift,
        ordersCount: shiftOrders.length,
        totalSalesUsd: roundMoney(
          shiftOrders.reduce((sum, entry) => sum + entry.totalUsd, 0),
        ),
        totalSalesBs: roundMoney(
          shiftOrders.reduce((sum, entry) => sum + entry.totalBs, 0),
        ),
        totalsByMethod: summarizePaymentsByMethod(shiftOrders),
      };
    });

    const updatedLocations = this.state.locations.map((loc) =>
      loc.id === order.locationId
        ? {
            ...loc,
            status: 'libre' as const,
            activeOrderId: null,
            kitchenReadyAlert: false,
            pendingSync: false,
            preFacturaReady: false,
          }
        : loc,
    );

    // Auto-complete any remaining active kitchen comandas for this settled order
    const updatedComandas = this.state.comandas.map((comanda) =>
      comanda.orderId === order.id && comanda.status !== 'lista'
        ? {
            ...comanda,
            status: 'lista' as const,
            updatedAt: nowIso,
            completedAt: comanda.completedAt ?? nowIso,
          }
        : comanda,
    );

    this.commit({
      ...this.state,
      locations: updatedLocations,
      orders: updatedOrders,
      shifts: updatedShifts,
      comandas: updatedComandas,
    });

    return closedOrder;
  }

  async openShift(userId: string): Promise<Shift> {
    const existingOpen = this.state.shifts.find((s) => s.status === 'abierto');
    if (existingOpen) {
      throw new Error('Ya existe un turno abierto');
    }

    const shift: Shift = {
      id: createId('shift'),
      openedAt: new Date().toISOString(),
      openedBy: userId,
      status: 'abierto',
      totalSalesUsd: 0,
      totalSalesBs: 0,
      ordersCount: 0,
      totalsByMethod: createEmptyPaymentMethodTotals(),
    };

    this.commit({
      ...this.state,
      shifts: [...this.state.shifts, shift],
    });

    return shift;
  }

  async closeShift(userId: string, notes?: string): Promise<CloseShiftResult> {
    const openShift = this.state.shifts.find((s) => s.status === 'abierto');
    if (!openShift) {
      throw new Error('No hay ningún turno abierto para cerrar');
    }

    const nowIso = new Date().toISOString();
    const shiftOrders = this.state.orders.filter(
      (o) => o.status === 'cerrada' && o.shiftId === openShift.id,
    );

    const closedShift: Shift = {
      ...openShift,
      status: 'cerrado',
      closedAt: nowIso,
      closedBy: userId,
      notes,
      ordersCount: shiftOrders.length,
      totalSalesUsd: roundMoney(
        shiftOrders.reduce((sum, order) => sum + order.totalUsd, 0),
      ),
      totalSalesBs: roundMoney(
        shiftOrders.reduce((sum, order) => sum + order.totalBs, 0),
      ),
      totalsByMethod: summarizePaymentsByMethod(shiftOrders),
    };

    const closedByName =
      this.state.users.find((u) => u.id === userId)?.name ?? userId;

    const printJob = buildPrintJobRecord({
      type: 'cierre',
      referenceId: closedShift.id,
      title: `Cierre de Turno · ${closedShift.id}`,
      payload: {
        type: 'cierre',
        restaurantName: this.state.settings.printer.restaurantName,
        shift: closedShift,
        closedByName,
        timestampIso: nowIso,
      },
      createdAt: nowIso,
    });

    this.commit({
      ...this.state,
      shifts: this.state.shifts.map((s) =>
        s.id === closedShift.id ? closedShift : s,
      ),
      printJobs: [...this.state.printJobs, printJob],
    });

    return { shift: closedShift, printJob };
  }

  async adjustIngredientStock(
    ingredientId: string,
    delta: number,
    type: 'reposicion' | 'merma' | 'ajuste',
    reason: string,
    userId: string,
  ): Promise<Ingredient> {
    if (!Number.isFinite(delta) || delta === 0) {
      throw new Error('La cantidad de ajuste debe ser un número distinto de 0');
    }

    const target = this.state.ingredients.find((ing) => ing.id === ingredientId);
    if (!target) {
      throw new Error(`Ingrediente no encontrado: ${ingredientId}`);
    }

    let signedDelta = delta;
    if (type === 'reposicion') {
      signedDelta = Math.abs(delta);
    } else if (type === 'merma') {
      signedDelta = -Math.abs(delta);
    }

    const nowIso = new Date().toISOString();
    const updatedIngredient: Ingredient = {
      ...target,
      stock: roundQuantity(target.stock + signedDelta),
    };

    const movement: InventoryMovement = {
      id: createId('mov'),
      ingredientId: target.id,
      ingredientName: target.name,
      type,
      delta: roundQuantity(signedDelta),
      unit: target.unit,
      reason,
      userId,
      createdAt: nowIso,
    };

    this.commit({
      ...this.state,
      ingredients: this.state.ingredients.map((ing) =>
        ing.id === ingredientId ? updatedIngredient : ing,
      ),
      movements: [...this.state.movements, movement],
    });

    return updatedIngredient;
  }

  async saveIngredient(
    ingredient: Omit<Ingredient, 'id'> & { id?: string },
  ): Promise<Ingredient> {
    const id = ingredient.id ?? createId('ing');
    const saved: Ingredient = { ...ingredient, id };
    const exists = this.state.ingredients.some((ing) => ing.id === id);

    this.commit({
      ...this.state,
      ingredients: exists
        ? this.state.ingredients.map((ing) => (ing.id === id ? saved : ing))
        : [...this.state.ingredients, saved],
    });

    return saved;
  }

  async saveMenuItem(
    item: Omit<MenuItem, 'id'> & { id?: string },
  ): Promise<MenuItem> {
    const id = item.id ?? createId('menu');
    const saved: MenuItem = { ...item, id };
    const exists = this.state.menu.some((entry) => entry.id === id);

    this.commit({
      ...this.state,
      menu: exists
        ? this.state.menu.map((entry) => (entry.id === id ? saved : entry))
        : [...this.state.menu, saved],
    });

    return saved;
  }

  async toggleMenuOutOfStock(
    menuItemId: string,
    outOfStock?: boolean,
  ): Promise<MenuItem> {
    const target = this.state.menu.find((entry) => entry.id === menuItemId);
    if (!target) {
      throw new Error(`Producto no encontrado: ${menuItemId}`);
    }

    const updated: MenuItem = {
      ...target,
      outOfStock: outOfStock !== undefined ? outOfStock : !target.outOfStock,
    };

    this.commit({
      ...this.state,
      menu: this.state.menu.map((entry) =>
        entry.id === menuItemId ? updated : entry,
      ),
    });

    return updated;
  }

  async updateExchangeRate(rate: number, source = 'Manual'): Promise<void> {
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new Error('La tasa de cambio debe ser mayor que 0');
    }

    const nowIso = new Date().toISOString();
    // Recalculate ONLY open orders; closed orders keep their frozen snapshot
    const updatedOrders = this.state.orders.map((order) => {
      if (order.status === 'cerrada') {
        return order;
      }
      const breakdown = calculateOrderBreakdown(order.items, rate);
      return {
        ...order,
        exchangeRate: rate,
        subtotalUsd: breakdown.subtotalUsd,
        ivaRate: breakdown.ivaRate,
        ivaUsd: breakdown.ivaUsd,
        ivaBs: breakdown.ivaBs,
        totalUsd: breakdown.totalUsd,
        totalBs: breakdown.totalBs,
      };
    });

    this.commit({
      ...this.state,
      orders: updatedOrders,
      settings: {
        ...this.state.settings,
        exchangeRate: rate,
        exchangeRateUpdatedAt: nowIso,
        exchangeRateSource: source,
      },
    });
  }

  async saveUser(
    user: Omit<UserProfile, 'id'> & { id?: string },
  ): Promise<UserProfile> {
    const cleanPin = user.pin.trim();
    if (!/^\d{4}$/.test(cleanPin)) {
      throw new Error('El PIN debe tener exactamente 4 dígitos numéricos');
    }

    const id = user.id ?? createId('user');
    const saved: UserProfile = { ...user, id, pin: cleanPin };
    const exists = this.state.users.some((u) => u.id === id);

    this.commit({
      ...this.state,
      users: exists
        ? this.state.users.map((u) => (u.id === id ? saved : u))
        : [...this.state.users, saved],
    });

    return saved;
  }

  async savePrinterConfig(printer: PrinterConfig): Promise<void> {
    this.commit({
      ...this.state,
      settings: {
        ...this.state.settings,
        printer: { ...printer },
      },
    });
  }

  async createPreCuentaPrintJob(orderId: string): Promise<PrintJob> {
    const order = this.state.orders.find((o) => o.id === orderId);
    if (!order) {
      throw new Error(`Orden no encontrada: ${orderId}`);
    }

    const nowIso = new Date().toISOString();
    const rate =
      order.status === 'cerrada'
        ? order.exchangeRate
        : this.state.settings.exchangeRate;
    const breakdown = calculateOrderBreakdown(order.items, rate);
    const activeItems = order.items
      .filter((item) => !item.voided)
      .map((item) => ({
        id: item.id,
        name: item.name,
        quantity: item.quantity,
        unitPriceUsd: item.unitPriceUsd,
        subtotalUsd: roundMoney(item.quantity * item.unitPriceUsd),
      }));

    const preFactura: PreFacturaSnapshot = {
      id: createId('pref'),
      orderId: order.id,
      locationId: order.locationId,
      locationLabel: order.locationLabel,
      restaurantName: this.state.settings.printer.restaurantName,
      items: activeItems,
      subtotalUsd: breakdown.subtotalUsd,
      subtotalBs: breakdown.subtotalBs,
      ivaRate: breakdown.ivaRate,
      ivaUsd: breakdown.ivaUsd,
      ivaBs: breakdown.ivaBs,
      totalUsd: breakdown.totalUsd,
      totalBs: breakdown.totalBs,
      exchangeRate: rate,
      generatedAt: nowIso,
    };

    const printJob = buildPrintJobRecord({
      type: 'precuenta',
      referenceId: order.id,
      title: `Precuenta · ${order.locationLabel}`,
      payload: {
        type: 'precuenta',
        restaurantName: this.state.settings.printer.restaurantName,
        order,
        exchangeRate: rate,
        timestampIso: nowIso,
      },
      createdAt: nowIso,
    });

    const updatedOrders = this.state.orders.map((o) =>
      o.id === order.id ? { ...o, preFactura } : o,
    );
    const updatedLocations = this.state.locations.map((loc) =>
      loc.id === order.locationId && order.status === 'abierta'
        ? { ...loc, preFacturaReady: true }
        : loc,
    );

    this.commit({
      ...this.state,
      orders: updatedOrders,
      locations: updatedLocations,
      printJobs: [...this.state.printJobs, printJob],
    });

    return printJob;
  }

  async createTestPrintJob(): Promise<PrintJob> {
    const nowIso = new Date().toISOString();
    const { restaurantName, ip, port } = this.state.settings.printer;

    const printJob = buildPrintJobRecord({
      type: 'prueba',
      referenceId: 'printer-test',
      title: `Prueba 80mm · ${ip}:${port}`,
      payload: {
        type: 'prueba',
        restaurantName,
        ip,
        port,
        timestampIso: nowIso,
      },
      createdAt: nowIso,
    });

    this.commit({
      ...this.state,
      printJobs: [...this.state.printJobs, printJob],
    });

    return printJob;
  }

  async updatePrintJobStatus(
    printJobId: string,
    status: PrintStatus,
    meta?: { printedAt?: string; error?: string },
  ): Promise<void> {
    const job = this.state.printJobs.find((j) => j.id === printJobId);
    if (!job) {
      return;
    }

    const updatedPrintJobs = this.state.printJobs.map((entry) =>
      entry.id === printJobId
        ? {
            ...entry,
            status,
            printedAt: meta?.printedAt ?? entry.printedAt,
            error: meta?.error,
          }
        : entry,
    );

    const updatedComandas =
      job.type === 'comanda'
        ? this.state.comandas.map((comanda) =>
            comanda.id === job.referenceId
              ? { ...comanda, printStatus: status }
              : comanda,
          )
        : this.state.comandas;

    this.commit({
      ...this.state,
      printJobs: updatedPrintJobs,
      comandas: updatedComandas,
    });
  }

  async resetDemoData(): Promise<void> {
    this.offlineQueue.clear();
    this.commit(createInitialPosState());
  }
}
