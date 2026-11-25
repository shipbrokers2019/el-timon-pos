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
 * Firestore-backed repository with persistent local cache, optimistic offline continuity,
 * and station-scoped queries compliant with firestore.rules.
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

  private attachListeners(): void {
    const role = this.stationRole;

    if (role !== 'cocina') {
      this.unsubscribes.push(
        onSnapshot(collection(this.db, 'locations'), (snap) => {
          if (snap.empty) return;
          const current = this.local.getState();
          const locations = snap.docs
            .map((d) => d.data() as PosState['locations'][number])
            .sort((a, b) => a.zone.localeCompare(b.zone) || a.number - b.number);
          this.local.replaceState({ ...current, locations });
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
          if (role === 'mesonero') {
            const incomingIds = new Set(incoming.map((o) => o.id));
            const preservedClosed = current.orders.filter(
              (o) => o.status === 'cerrada' && !incomingIds.has(o.id),
            );
            this.local.replaceState({
              ...current,
              orders: [...preservedClosed, ...incoming],
            });
            return;
          }
          if (!snap.empty) {
            this.local.replaceState({ ...current, orders: incoming });
          }
        }),
      );
    }

    this.unsubscribes.push(
      onSnapshot(collection(this.db, 'comandas'), (snap) => {
        if (snap.empty) return;
        const current = this.local.getState();
        const comandas = snap.docs
          .map((d) => d.data() as PosState['comandas'][number])
          .sort((a, b) => a.sequenceNumber - b.sequenceNumber);
        this.local.replaceState({ ...current, comandas });
      }),
    );

    this.unsubscribes.push(
      onSnapshot(collection(this.db, 'printJobs'), (snap) => {
        if (snap.empty) return;
        const current = this.local.getState();
        const printJobs = snap.docs.map((d) => d.data() as PrintJob);
        this.local.replaceState({ ...current, printJobs });
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
                data.restaurantName ?? current.settings.printer.restaurantName,
            },
          },
        });
      }),
    );

    if (role === 'caja_admin' || role === null) {
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
    return this.local.subscribe(listener);
  }

  async submitComanda(input: SubmitComandaInput): Promise<SubmitComandaResult> {
    const result = await this.local.submitComanda(input);
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
    await batch.commit().catch(() => undefined);
    return result;
  }

  async syncOfflineQueue(): Promise<void> {
    await this.local.syncOfflineQueue();
    const state = this.local.getState();
    const batch = writeBatch(this.db);
    for (const loc of state.locations) {
      batch.set(doc(this.db, 'locations', loc.id), loc, { merge: true });
    }
    for (const comanda of state.comandas) {
      batch.set(doc(this.db, 'comandas', comanda.id), comanda, { merge: true });
    }
    await batch.commit().catch(() => undefined);
  }

  async updateComandaStatus(comandaId: string, status: ComandaStatus): Promise<void> {
    await this.local.updateComandaStatus(comandaId, status);
    const state = this.local.getState();
    const comanda = state.comandas.find((c) => c.id === comandaId);
    if (comanda) {
      await setDoc(doc(this.db, 'comandas', comanda.id), comanda, {
        merge: true,
      }).catch(() => undefined);
      const loc = state.locations.find((l) => l.id === comanda.locationId);
      if (loc && status === 'lista') {
        await setDoc(doc(this.db, 'locations', loc.id), loc, {
          merge: true,
        }).catch(() => undefined);
      }
    }
  }

  async acknowledgeKitchenReady(locationId: string): Promise<void> {
    await this.local.acknowledgeKitchenReady(locationId);
    const loc = this.local.getState().locations.find((l) => l.id === locationId);
    if (loc) {
      await setDoc(doc(this.db, 'locations', loc.id), loc, { merge: true }).catch(
        () => undefined,
      );
    }
  }

  async requestCheck(locationId: string): Promise<void> {
    await this.local.requestCheck(locationId);
    const loc = this.local.getState().locations.find((l) => l.id === locationId);
    if (loc) {
      await setDoc(doc(this.db, 'locations', loc.id), loc, { merge: true }).catch(
        () => undefined,
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
    const prevComandaIds = new Set(this.local.getState().comandas.map((c) => c.id));
    const prevJobIds = new Set(this.local.getState().printJobs.map((j) => j.id));
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
    await batch.commit().catch(() => undefined);
  }

  async settleOrder(orderId: string, payments: PaymentEntry[]): Promise<Order> {
    const settled = await this.local.settleOrder(orderId, payments);
    const state = this.local.getState();
    const loc = state.locations.find((l) => l.id === settled.locationId);

    const batch = writeBatch(this.db);
    batch.set(doc(this.db, 'orders', settled.id), settled, { merge: true });
    if (loc) {
      batch.set(doc(this.db, 'locations', loc.id), loc, { merge: true });
    }
    await batch.commit().catch(() => undefined);
    return settled;
  }

  async openShift(userId: string): Promise<Shift> {
    const shift = await this.local.openShift(userId);
    await setDoc(doc(this.db, 'shifts', shift.id), shift, { merge: true }).catch(
      () => undefined,
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
    await batch.commit().catch(() => undefined);
    return res;
  }

  async adjustIngredientStock(
    ingredientId: string,
    delta: number,
    type: 'reposicion' | 'merma' | 'ajuste',
    reason: string,
    userId: string,
  ): Promise<Ingredient> {
    const ing = await this.local.adjustIngredientStock(
      ingredientId,
      delta,
      type,
      reason,
      userId,
    );
    await setDoc(doc(this.db, 'ingredients', ing.id), ing, { merge: true }).catch(
      () => undefined,
    );
    return ing;
  }

  async saveIngredient(
    ingredient: Omit<Ingredient, 'id'> & { id?: string },
  ): Promise<Ingredient> {
    const saved = await this.local.saveIngredient(ingredient);
    await setDoc(doc(this.db, 'ingredients', saved.id), saved, {
      merge: true,
    }).catch(() => undefined);
    return saved;
  }

  async saveMenuItem(
    item: Omit<MenuItem, 'id'> & { id?: string },
  ): Promise<MenuItem> {
    const saved = await this.local.saveMenuItem(item);
    await setDoc(doc(this.db, 'menu', saved.id), saved, { merge: true }).catch(
      () => undefined,
    );
    return saved;
  }

  async toggleMenuOutOfStock(
    menuItemId: string,
    outOfStock?: boolean,
  ): Promise<MenuItem> {
    const updated = await this.local.toggleMenuOutOfStock(menuItemId, outOfStock);
    await setDoc(doc(this.db, 'menu', updated.id), updated, { merge: true }).catch(
      () => undefined,
    );
    return updated;
  }

  async updateExchangeRate(rate: number): Promise<void> {
    await this.local.updateExchangeRate(rate);
    const { settings } = this.local.getState();
    await setDoc(doc(this.db, 'settings', 'app'), settings, { merge: true }).catch(
      () => undefined,
    );
  }

  async saveUser(
    user: Omit<UserProfile, 'id'> & { id?: string },
  ): Promise<UserProfile> {
    const saved = await this.local.saveUser(user);
    await setDoc(doc(this.db, 'users', saved.id), saved, { merge: true }).catch(
      () => undefined,
    );
    return saved;
  }

  async savePrinterConfig(printer: PrinterConfig): Promise<void> {
    await this.local.savePrinterConfig(printer);
    await setDoc(
      doc(this.db, 'settings', 'public'),
      {
        restaurantName: printer.restaurantName,
        printer: {
          ip: printer.ip,
          port: printer.port,
          enabled: printer.autoPrintFromKitchen,
        },
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    ).catch(() => undefined);
  }

  async createPreCuentaPrintJob(orderId: string): Promise<PrintJob> {
    const job = await this.local.createPreCuentaPrintJob(orderId);
    await setDoc(doc(this.db, 'printJobs', job.id), job, { merge: true }).catch(
      () => undefined,
    );
    return job;
  }

  async createTestPrintJob(): Promise<PrintJob> {
    const job = await this.local.createTestPrintJob();
    await setDoc(doc(this.db, 'printJobs', job.id), job, { merge: true }).catch(
      () => undefined,
    );
    return job;
  }

  async updatePrintJobStatus(
    printJobId: string,
    status: PrintStatus,
    meta?: { printedAt?: string; error?: string },
  ): Promise<void> {
    await this.local.updatePrintJobStatus(printJobId, status, meta);
    const job = this.local.getState().printJobs.find((j) => j.id === printJobId);
    if (job) {
      await setDoc(doc(this.db, 'printJobs', job.id), job, { merge: true }).catch(
        () => undefined,
      );
    }
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
    await batch.commit().catch(() => undefined);
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
