import { getApp, getApps, initializeApp, type FirebaseOptions } from 'firebase/app';
import {
  collection,
  doc,
  getFirestore,
  initializeFirestore,
  onSnapshot,
  persistentLocalCache,
  persistentMultipleTabManager,
  query,
  setDoc,
  where,
  writeBatch,
  type Firestore,
  type Unsubscribe,
} from 'firebase/firestore';
import type {
  ComandaStatus,
  Ingredient,
  InventoryMovement,
  MenuItem,
  Order,
  PaymentEntry,
  PosState,
  PrintJob,
  PrintStatus,
  PrinterConfig,
  Role,
  Shift,
  UserProfile,
  VoidDisposition,
} from '../types/pos';
import {
  LocalPosRepository,
  type CloseShiftResult,
  type PosRepository,
  type SubmitComandaInput,
  type SubmitComandaResult,
} from './posRepository';

interface ImportMetaWithEnv {
  env?: Record<string, string | undefined>;
}

function getFirebaseEnvConfig(): FirebaseOptions | null {
  const env = (import.meta as unknown as ImportMetaWithEnv).env;
  const apiKey = env?.VITE_FIREBASE_API_KEY?.trim();
  if (!env || !apiKey) {
    return null;
  }

  return {
    apiKey,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: env.VITE_FIREBASE_APP_ID,
  };
}

export function isFirebaseConfigured(): boolean {
  return getFirebaseEnvConfig() !== null;
}

function initFirestoreClient(config: FirebaseOptions): Firestore {
  const app = getApps().length > 0 ? getApp() : initializeApp(config);
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
    });
  } catch {
    return getFirestore(app);
  }
}

/**
 * Firestore-backed repository with persistent local cache, non-blocking offline writes,
 * offline queue flushing on reconnect, and station-scoped queries compliant with firestore.rules.
 */
export class FirebasePosRepository implements PosRepository {
  private readonly local = new LocalPosRepository();
  private readonly db: Firestore;
  private readonly stationRole: Role | null;
  private readonly unsubscribes: Unsubscribe[] = [];

  constructor(config: FirebaseOptions, stationRole: Role | null = null) {
    this.db = initFirestoreClient(config);
    this.stationRole = stationRole;
    this.attachListeners();
  }

  private isAdminWriter(): boolean {
    return this.stationRole === 'caja_admin' || this.stationRole === null;
  }

  /**
   * Dispatches a Firestore write without blocking UI mutations on server acknowledgement
   * (critical during beach Wi-Fi outages where Firestore write promises stay pending).
   */
  private commitNonBlocking(operation: Promise<void>): void {
    void operation.catch((err) => {
      if (typeof console !== 'undefined') {
        console.warn('[FirebasePosRepository] Write deferred/failed:', err);
      }
    });
  }

  private getPendingComandaIds(state: PosState): Set<string> {
    const ids = new Set(this.local.getOfflineQueueIds());
    for (const comanda of state.comandas) {
      if (comanda.pendingSync === true) {
        ids.add(comanda.id);
      }
    }
    return ids;
  }

  private attachListeners(): void {
    const role = this.stationRole;

    if (role !== 'cocina') {
      this.unsubscribes.push(
        onSnapshot(collection(this.db, 'locations'), (snap) => {
          if (snap.empty) return;
          const current = this.local.getState();
          const pendingLocalById = new Map(
            current.locations
              .filter((loc) => loc.pendingSync === true)
              .map((loc) => [loc.id, loc]),
          );
          const remoteLocations = snap.docs
            .map((d) => d.data() as PosState['locations'][number])
            .map((loc) => pendingLocalById.get(loc.id) ?? loc)
            .sort((a, b) => a.zone.localeCompare(b.zone) || a.number - b.number);
          this.local.replaceState({ ...current, locations: remoteLocations });
        }),
      );

      this.unsubscribes.push(
        onSnapshot(collection(this.db, 'menu'), (snap) => {
          if (snap.empty) return;
          const current = this.local.getState();
          const menu = snap.docs.map((d) => d.data() as MenuItem);
          this.local.replaceState({ ...current, menu });
        }),
      );

      // Mesonero queries MUST filter status == 'abierta' per firestore.rules
      const ordersQuery =
        role === 'mesonero'
          ? query(collection(this.db, 'orders'), where('status', '==', 'abierta'))
          : collection(this.db, 'orders');

      this.unsubscribes.push(
        onSnapshot(ordersQuery, (snap) => {
          const current = this.local.getState();
          const incoming = snap.docs.map((d) => d.data() as Order);
          const pendingComandaIds = this.getPendingComandaIds(current);
          const pendingLocationOrderIds = new Set(
            current.locations
              .filter((loc) => loc.pendingSync === true && loc.activeOrderId)
              .map((loc) => loc.activeOrderId as string),
          );
          const isLocalUnsynced = (order: Order): boolean =>
            pendingLocationOrderIds.has(order.id) ||
            order.items.some((item) => pendingComandaIds.has(item.comandaId));

          const unsyncedLocal = current.orders.filter(isLocalUnsynced);
          const unsyncedMap = new Map(unsyncedLocal.map((o) => [o.id, o]));
          const remoteIds = new Set(incoming.map((o) => o.id));

          if (role === 'mesonero') {
            const preservedClosed = current.orders.filter(
              (o) => o.status === 'cerrada' && !remoteIds.has(o.id) && !unsyncedMap.has(o.id),
            );
            const mergedIncoming = incoming.map((o) => unsyncedMap.get(o.id) ?? o);
            const extraUnsynced = unsyncedLocal.filter((o) => !remoteIds.has(o.id));
            this.local.replaceState({
              ...current,
              orders: [...preservedClosed, ...mergedIncoming, ...extraUnsynced],
            });
            return;
          }

          if (snap.empty && unsyncedLocal.length === 0) return;
          const mergedOrders = [
            ...incoming.map((o) => unsyncedMap.get(o.id) ?? o),
            ...unsyncedLocal.filter((o) => !remoteIds.has(o.id)),
          ];
          this.local.replaceState({ ...current, orders: mergedOrders });
        }),
      );
    }

    this.unsubscribes.push(
      onSnapshot(collection(this.db, 'comandas'), (snap) => {
        const current = this.local.getState();
        const remoteComandas = snap.docs.map((d) => d.data() as PosState['comandas'][number]);
        const pendingLocal = current.comandas.filter((c) => c.pendingSync === true);
        if (snap.empty && pendingLocal.length === 0) return;

        const pendingMap = new Map(pendingLocal.map((c) => [c.id, c]));
        const remoteIds = new Set(remoteComandas.map((c) => c.id));
        const merged = [
          ...remoteComandas.map((c) => pendingMap.get(c.id) ?? c),
          ...pendingLocal.filter((c) => !remoteIds.has(c.id)),
        ].sort((a, b) => a.sequenceNumber - b.sequenceNumber);

        this.local.replaceState({ ...current, comandas: merged });
      }),
    );

    this.unsubscribes.push(
      onSnapshot(collection(this.db, 'printJobs'), (snap) => {
        const current = this.local.getState();
        const remoteJobs = snap.docs.map((d) => d.data() as PrintJob);
        const pendingComandaIds = this.getPendingComandaIds(current);
        const pendingLocalJobs = current.printJobs.filter((job) =>
          pendingComandaIds.has(job.referenceId),
        );
        if (snap.empty && pendingLocalJobs.length === 0) return;

        const pendingJobMap = new Map(pendingLocalJobs.map((j) => [j.id, j]));
        const remoteIds = new Set(remoteJobs.map((j) => j.id));
        const merged = [
          ...remoteJobs.map((j) => pendingJobMap.get(j.id) ?? j),
          ...pendingLocalJobs.filter((j) => !remoteIds.has(j.id)),
        ];

        this.local.replaceState({ ...current, printJobs: merged });
      }),
    );

    this.unsubscribes.push(
      onSnapshot(doc(this.db, 'settings', 'public'), (snap) => {
        if (!snap.exists()) return;
        const data = snap.data() as Partial<{
          restaurantName: string;
          printer: PrinterConfig;
        }>;
        const current = this.local.getState();
        this.local.replaceState({
          ...current,
          settings: {
            ...current.settings,
            printer: {
              ...current.settings.printer,
              ...(data.printer ?? {}),
              restaurantName:
                data.restaurantName ??
                data.printer?.restaurantName ??
                current.settings.printer.restaurantName,
            },
          },
        });
      }),
    );

    if (this.isAdminWriter()) {
      this.unsubscribes.push(
        onSnapshot(collection(this.db, 'ingredients'), (snap) => {
          if (snap.empty) return;
          const current = this.local.getState();
          this.local.replaceState({
            ...current,
            ingredients: snap.docs.map((d) => d.data() as Ingredient),
          });
        }),
      );

      this.unsubscribes.push(
        onSnapshot(collection(this.db, 'inventoryMovements'), (snap) => {
          if (snap.empty) return;
          const current = this.local.getState();
          this.local.replaceState({
            ...current,
            movements: snap.docs.map((d) => d.data() as InventoryMovement),
          });
        }),
      );

      this.unsubscribes.push(
        onSnapshot(collection(this.db, 'shifts'), (snap) => {
          if (snap.empty) return;
          const current = this.local.getState();
          this.local.replaceState({
            ...current,
            shifts: snap.docs.map((d) => d.data() as Shift),
          });
        }),
      );

      this.unsubscribes.push(
        onSnapshot(collection(this.db, 'users'), (snap) => {
          if (snap.empty) return;
          const current = this.local.getState();
          this.local.replaceState({
            ...current,
            users: snap.docs.map((d) => d.data() as UserProfile),
          });
        }),
      );

      this.unsubscribes.push(
        onSnapshot(doc(this.db, 'settings', 'app'), (snap) => {
          if (!snap.exists()) return;
          const data = snap.data() as Partial<PosState['settings']>;
          const current = this.local.getState();
          this.local.replaceState({
            ...current,
            settings: {
              ...current.settings,
              ...data,
            },
          });
        }),
      );
    }
  }

  dispose(): void {
    for (const unsub of this.unsubscribes) {
      unsub();
    }
    this.unsubscribes.length = 0;
    this.local.dispose();
  }

  getState(): PosState {
    return this.local.getState();
  }

  getPendingSyncCount(): number {
    return this.local.getPendingSyncCount();
  }

  subscribe(listener: (state: PosState) => void): () => void {
    if (this.unsubscribes.length === 0) {
      this.attachListeners();
    }
    return this.local.subscribe(listener);
  }

  async submitComanda(input: SubmitComandaInput): Promise<SubmitComandaResult> {
    const prevMovIds = new Set(this.local.getState().movements.map((m) => m.id));
    const result = await this.local.submitComanda(input);

    // Defer remote persistence when explicitly offline; syncOfflineQueue() flushes on reconnect
    if (input.isOffline === true) {
      return result;
    }

    const state = this.local.getState();
    const location = state.locations.find((l) => l.id === input.locationId);
    const batch = writeBatch(this.db);

    batch.set(doc(this.db, 'orders', result.order.id), result.order, { merge: true });
    if (location) {
      batch.set(doc(this.db, 'locations', location.id), location, { merge: true });
    }
    if (result.comanda) {
      batch.set(doc(this.db, 'comandas', result.comanda.id), result.comanda, {
        merge: true,
      });
    }
    if (result.printJob) {
      batch.set(doc(this.db, 'printJobs', result.printJob.id), result.printJob, {
        merge: true,
      });
    }

    if (this.isAdminWriter()) {
      const touchedIngIds = new Set<string>();
      for (const movement of state.movements) {
        if (!prevMovIds.has(movement.id)) {
          touchedIngIds.add(movement.ingredientId);
          batch.set(doc(this.db, 'inventoryMovements', movement.id), movement, {
            merge: true,
          });
        }
      }
      for (const ing of state.ingredients) {
        if (touchedIngIds.has(ing.id)) {
          batch.set(doc(this.db, 'ingredients', ing.id), ing, { merge: true });
        }
      }
    }

    this.commitNonBlocking(batch.commit());
    return result;
  }

  async syncOfflineQueue(): Promise<void> {
    const prevState = this.local.getState();
    const pendingComandaIds = this.getPendingComandaIds(prevState);
    const pendingLocationIds = new Set(
      prevState.locations
        .filter((loc) => loc.pendingSync === true)
        .map((loc) => loc.id),
    );
    const prevMovIds = new Set(prevState.movements.map((m) => m.id));

    await this.local.syncOfflineQueue();
    const nextState = this.local.getState();

    const batch = writeBatch(this.db);
    const touchedOrderIds = new Set<string>();

    for (const loc of nextState.locations) {
      if (pendingLocationIds.has(loc.id)) {
        batch.set(doc(this.db, 'locations', loc.id), loc, { merge: true });
        if (loc.activeOrderId) {
          touchedOrderIds.add(loc.activeOrderId);
        }
      }
    }

    for (const comanda of nextState.comandas) {
      if (pendingComandaIds.has(comanda.id)) {
        batch.set(doc(this.db, 'comandas', comanda.id), comanda, { merge: true });
        touchedOrderIds.add(comanda.orderId);
      }
    }

    for (const order of nextState.orders) {
      if (
        touchedOrderIds.has(order.id) ||
        order.items.some((item) => pendingComandaIds.has(item.comandaId))
      ) {
        batch.set(doc(this.db, 'orders', order.id), order, { merge: true });
      }
    }

    for (const job of nextState.printJobs) {
      if (pendingComandaIds.has(job.referenceId)) {
        batch.set(doc(this.db, 'printJobs', job.id), job, { merge: true });
      }
    }

    if (this.isAdminWriter()) {
      const touchedIngIds = new Set<string>();
      for (const movement of nextState.movements) {
        const isPendingMovement =
          !prevMovIds.has(movement.id) ||
          (movement.referenceId !== undefined &&
            pendingComandaIds.has(movement.referenceId));
        if (isPendingMovement) {
          touchedIngIds.add(movement.ingredientId);
          batch.set(doc(this.db, 'inventoryMovements', movement.id), movement, {
            merge: true,
          });
        }
      }
      for (const ing of nextState.ingredients) {
        if (touchedIngIds.has(ing.id)) {
          batch.set(doc(this.db, 'ingredients', ing.id), ing, { merge: true });
        }
      }
    }

    this.commitNonBlocking(batch.commit());
  }

  async updateComandaStatus(comandaId: string, status: ComandaStatus): Promise<void> {
    await this.local.updateComandaStatus(comandaId, status);
    const state = this.local.getState();
    const comanda = state.comandas.find((c) => c.id === comandaId);
    if (!comanda) return;

    const batch = writeBatch(this.db);
    batch.set(doc(this.db, 'comandas', comanda.id), comanda, { merge: true });
    if (status === 'lista') {
      const loc = state.locations.find((l) => l.id === comanda.locationId);
      if (loc) {
        batch.set(doc(this.db, 'locations', loc.id), loc, { merge: true });
      }
    }
    this.commitNonBlocking(batch.commit());
  }

  async acknowledgeKitchenReady(locationId: string): Promise<void> {
    await this.local.acknowledgeKitchenReady(locationId);
    const loc = this.local.getState().locations.find((l) => l.id === locationId);
    if (loc) {
      this.commitNonBlocking(
        setDoc(doc(this.db, 'locations', loc.id), loc, { merge: true }),
      );
    }
  }

  async requestCheck(locationId: string): Promise<void> {
    await this.local.requestCheck(locationId);
    const loc = this.local.getState().locations.find((l) => l.id === locationId);
    if (loc) {
      this.commitNonBlocking(
        setDoc(doc(this.db, 'locations', loc.id), loc, { merge: true }),
      );
    }
  }

  async voidOrderItem(
    orderId: string,
    itemId: string,
    disposition: VoidDisposition,
    reason: string,
    adminUser: Pick<UserProfile, 'id' | 'name'>,
  ): Promise<void> {
    const prevState = this.local.getState();
    const prevComandaIds = new Set(prevState.comandas.map((c) => c.id));
    const prevJobIds = new Set(prevState.printJobs.map((j) => j.id));
    const prevMovIds = new Set(prevState.movements.map((m) => m.id));

    await this.local.voidOrderItem(orderId, itemId, disposition, reason, adminUser);
    const state = this.local.getState();
    const order = state.orders.find((o) => o.id === orderId);

    const batch = writeBatch(this.db);
    if (order) {
      batch.set(doc(this.db, 'orders', order.id), order, { merge: true });
    }
    for (const comanda of state.comandas) {
      if (!prevComandaIds.has(comanda.id)) {
        batch.set(doc(this.db, 'comandas', comanda.id), comanda, { merge: true });
      }
    }
    for (const job of state.printJobs) {
      if (!prevJobIds.has(job.id)) {
        batch.set(doc(this.db, 'printJobs', job.id), job, { merge: true });
      }
    }

    if (this.isAdminWriter()) {
      const touchedIngIds = new Set<string>();
      for (const movement of state.movements) {
        if (!prevMovIds.has(movement.id)) {
          touchedIngIds.add(movement.ingredientId);
          batch.set(doc(this.db, 'inventoryMovements', movement.id), movement, {
            merge: true,
          });
        }
      }
      for (const ing of state.ingredients) {
        if (touchedIngIds.has(ing.id)) {
          batch.set(doc(this.db, 'ingredients', ing.id), ing, { merge: true });
        }
      }
    }

    this.commitNonBlocking(batch.commit());
  }

  async settleOrder(orderId: string, payments: PaymentEntry[]): Promise<Order> {
    const settled = await this.local.settleOrder(orderId, payments);
    const state = this.local.getState();
    const loc = state.locations.find((l) => l.id === settled.locationId);
    const shift = state.shifts.find((s) => s.id === settled.shiftId);

    const batch = writeBatch(this.db);
    batch.set(doc(this.db, 'orders', settled.id), settled, { merge: true });
    if (loc) {
      batch.set(doc(this.db, 'locations', loc.id), loc, { merge: true });
    }
    if (shift) {
      batch.set(doc(this.db, 'shifts', shift.id), shift, { merge: true });
    }
    this.commitNonBlocking(batch.commit());
    return settled;
  }

  async openShift(userId: string): Promise<Shift> {
    const shift = await this.local.openShift(userId);
    this.commitNonBlocking(
      setDoc(doc(this.db, 'shifts', shift.id), shift, { merge: true }),
    );
    return shift;
  }

  async closeShift(userId: string, notes?: string): Promise<CloseShiftResult> {
    const res = await this.local.closeShift(userId, notes);
    const batch = writeBatch(this.db);
    batch.set(doc(this.db, 'shifts', res.shift.id), res.shift, { merge: true });
    batch.set(doc(this.db, 'printJobs', res.printJob.id), res.printJob, {
      merge: true,
    });
    this.commitNonBlocking(batch.commit());
    return res;
  }

  async adjustIngredientStock(
    ingredientId: string,
    delta: number,
    type: 'reposicion' | 'merma' | 'ajuste',
    reason: string,
    userId: string,
  ): Promise<Ingredient> {
    const prevMovIds = new Set(this.local.getState().movements.map((m) => m.id));
    const ing = await this.local.adjustIngredientStock(
      ingredientId,
      delta,
      type,
      reason,
      userId,
    );

    const state = this.local.getState();
    const batch = writeBatch(this.db);
    batch.set(doc(this.db, 'ingredients', ing.id), ing, { merge: true });
    for (const movement of state.movements) {
      if (!prevMovIds.has(movement.id)) {
        batch.set(doc(this.db, 'inventoryMovements', movement.id), movement, {
          merge: true,
        });
      }
    }
    this.commitNonBlocking(batch.commit());
    return ing;
  }

  async saveIngredient(
    ingredient: Omit<Ingredient, 'id'> & { id?: string },
  ): Promise<Ingredient> {
    const saved = await this.local.saveIngredient(ingredient);
    this.commitNonBlocking(
      setDoc(doc(this.db, 'ingredients', saved.id), saved, { merge: true }),
    );
    return saved;
  }

  async saveMenuItem(
    item: Omit<MenuItem, 'id'> & { id?: string },
  ): Promise<MenuItem> {
    const saved = await this.local.saveMenuItem(item);
    this.commitNonBlocking(
      setDoc(doc(this.db, 'menu', saved.id), saved, { merge: true }),
    );
    return saved;
  }

  async toggleMenuOutOfStock(
    menuItemId: string,
    outOfStock?: boolean,
  ): Promise<MenuItem> {
    const updated = await this.local.toggleMenuOutOfStock(menuItemId, outOfStock);
    this.commitNonBlocking(
      setDoc(doc(this.db, 'menu', updated.id), updated, { merge: true }),
    );
    return updated;
  }

  async updateExchangeRate(rate: number, source = 'Manual'): Promise<void> {
    await this.local.updateExchangeRate(rate, source);
    const state = this.local.getState();
    const batch = writeBatch(this.db);
    batch.set(doc(this.db, 'settings', 'app'), state.settings, { merge: true });
    for (const order of state.orders) {
      if (order.status === 'abierta') {
        batch.set(doc(this.db, 'orders', order.id), order, { merge: true });
      }
    }
    this.commitNonBlocking(batch.commit());
  }

  async saveUser(
    user: Omit<UserProfile, 'id'> & { id?: string },
  ): Promise<UserProfile> {
    const saved = await this.local.saveUser(user);
    this.commitNonBlocking(
      setDoc(doc(this.db, 'users', saved.id), saved, { merge: true }),
    );
    return saved;
  }

  async savePrinterConfig(printer: PrinterConfig): Promise<void> {
    await this.local.savePrinterConfig(printer);
    const normalizedPrinter: PrinterConfig = {
      restaurantName: printer.restaurantName,
      ip: printer.ip,
      port: printer.port,
      autoPrintFromKitchen: printer.autoPrintFromKitchen,
      lanFallbackEnabled: printer.lanFallbackEnabled,
    };
    const batch = writeBatch(this.db);
    batch.set(
      doc(this.db, 'settings', 'public'),
      {
        restaurantName: normalizedPrinter.restaurantName,
        printer: normalizedPrinter,
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );
    if (this.isAdminWriter()) {
      batch.set(doc(this.db, 'settings', 'app'), this.local.getState().settings, {
        merge: true,
      });
    }
    this.commitNonBlocking(batch.commit());
  }

  async createPreCuentaPrintJob(orderId: string): Promise<PrintJob> {
    const job = await this.local.createPreCuentaPrintJob(orderId);
    this.commitNonBlocking(
      setDoc(doc(this.db, 'printJobs', job.id), job, { merge: true }),
    );
    return job;
  }

  async createTestPrintJob(): Promise<PrintJob> {
    const job = await this.local.createTestPrintJob();
    this.commitNonBlocking(
      setDoc(doc(this.db, 'printJobs', job.id), job, { merge: true }),
    );
    return job;
  }

  async updatePrintJobStatus(
    printJobId: string,
    status: PrintStatus,
    meta?: { printedAt?: string; error?: string },
  ): Promise<void> {
    await this.local.updatePrintJobStatus(printJobId, status, meta);
    const state = this.local.getState();
    const job = state.printJobs.find((j) => j.id === printJobId);
    if (!job) return;

    const batch = writeBatch(this.db);
    batch.set(doc(this.db, 'printJobs', job.id), job, { merge: true });
    if (job.type === 'comanda') {
      const comanda = state.comandas.find((c) => c.id === job.referenceId);
      if (comanda) {
        batch.set(doc(this.db, 'comandas', comanda.id), comanda, { merge: true });
      }
    }
    this.commitNonBlocking(batch.commit());
  }

  async resetDemoData(): Promise<void> {
    await this.local.resetDemoData();
    const state = this.local.getState();
    const batch = writeBatch(this.db);
    for (const loc of state.locations) {
      batch.set(doc(this.db, 'locations', loc.id), loc);
    }
    for (const item of state.menu) {
      batch.set(doc(this.db, 'menu', item.id), item);
    }
    for (const ing of state.ingredients) {
      batch.set(doc(this.db, 'ingredients', ing.id), ing);
    }
    for (const user of state.users) {
      batch.set(doc(this.db, 'users', user.id), user);
    }
    for (const shift of state.shifts) {
      batch.set(doc(this.db, 'shifts', shift.id), shift);
    }
    this.commitNonBlocking(batch.commit());
  }
}

export function createPosRepository(options?: {
  stationRole?: Role | null;
}): PosRepository {
  const firebaseConfig = getFirebaseEnvConfig();
  if (!firebaseConfig) {
    return new LocalPosRepository();
  }
  return new FirebasePosRepository(firebaseConfig, options?.stationRole ?? null);
}
