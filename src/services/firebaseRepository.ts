import { getApp, getApps, initializeApp, type FirebaseOptions } from 'firebase/app';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  initializeFirestore,
  memoryLocalCache,
  onSnapshot,
  persistentLocalCache,
  persistentMultipleTabManager,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
  type Unsubscribe,
  type WriteBatch,
} from 'firebase/firestore';
import type {
  ComandaStatus,
  Ingredient,
  InventoryMovement,
  Location,
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
import { createInitialPosState } from './seedData';

/**
 * Recursively removes `undefined` properties before writing to Firestore
 * (Firestore rejects objects containing explicit `undefined` values).
 */
export function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const cleaned: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (entry !== undefined) {
        cleaned[key] = stripUndefined(entry);
      }
    }
    return cleaned as T;
  }
  return value;
}

/**
 * Merges incoming Firestore locations over the canonical 10 mesas + 18 toldos baseline
 * so a partial cloud snapshot can never hide the rest of the floor grid, while keeping
 * unsynced local offline edits intact.
 */
export function mergeLocationsWithBaseline(
  remoteLocations: Location[],
  currentLocations: Location[],
): Location[] {
  const baseline = createInitialPosState().locations;
  const pendingLocalById = new Map(
    currentLocations
      .filter((loc) => loc.pendingSync === true)
      .map((loc) => [loc.id, loc]),
  );

  const merged = new Map<string, Location>();
  for (const loc of baseline) {
    merged.set(loc.id, loc);
  }
  for (const loc of currentLocations) {
    merged.set(loc.id, loc);
  }
  for (const loc of remoteLocations) {
    merged.set(loc.id, pendingLocalById.get(loc.id) ?? loc);
  }

  return Array.from(merged.values()).sort(
    (a, b) => a.zone.localeCompare(b.zone) || a.number - b.number,
  );
}

interface ImportMetaWithEnv {
  env?: Record<string, string | undefined>;
}

export function getFirebaseEnvConfig(): FirebaseOptions | null {
  const env = (import.meta as unknown as ImportMetaWithEnv).env;
  if (!env || env.MODE === 'test') {
    return null;
  }
  const apiKey = env.VITE_FIREBASE_API_KEY?.trim();
  if (!apiKey) {
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

function withTimeout<T>(operation: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Tiempo de espera agotado (${label})`)),
      ms,
    );
    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export function initFirestoreClient(config: FirebaseOptions): Firestore {
  const app = getApps().length > 0 ? getApp() : initializeApp(config);
  const tabSessionOnly =
    typeof sessionStorage !== 'undefined' &&
    sessionStorage.getItem('eltimon_tab_session_only') === '1';
  try {
    return initializeFirestore(app, {
      localCache: tabSessionOnly
        ? memoryLocalCache()
        : persistentLocalCache({
            tabManager: persistentMultipleTabManager(),
          }),
      experimentalAutoDetectLongPolling: true,
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
  private readonly local: LocalPosRepository;
  private readonly db: Firestore;
  private readonly stationRole: Role | null;
  private readonly unsubscribes: Unsubscribe[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isDisposed = false;

  constructor(config: FirebaseOptions, stationRole: Role | null = null) {
    this.db = initFirestoreClient(config);
    this.stationRole = stationRole;
    // Isolate local cache per station role and disable BroadcastChannel so role-scoped
    // stations (e.g. Cocina with orders: []) can NEVER overwrite Caja/Mesonero state in the same browser.
    this.local = new LocalPosRepository({
      storageKeySuffix: stationRole ?? 'cloud',
      enableBroadcastChannel: false,
    });
    this.attachListeners();
    if (this.isAdminWriter()) {
      void this.ensureInitialCloudSeed();
    }
  }

  private async ensureInitialCloudSeed(): Promise<void> {
    try {
      const [
        existingLocations,
        existingOrders,
        existingMenu,
        existingIngredients,
        existingUsers,
        existingShifts,
        existingAppSettings,
        existingPublicSettings,
      ] = await Promise.all([
        getDocs(collection(this.db, 'locations')),
        getDocs(collection(this.db, 'orders')),
        getDocs(collection(this.db, 'menu')),
        getDocs(collection(this.db, 'ingredients')),
        getDocs(collection(this.db, 'users')),
        getDocs(collection(this.db, 'shifts')),
        getDoc(doc(this.db, 'settings', 'app')),
        getDoc(doc(this.db, 'settings', 'public')),
      ]);

      const baseline = createInitialPosState();
      const localState = this.local.getState();
      const existingLocationIds = new Set(existingLocations.docs.map((d) => d.id));
      const batch = writeBatch(this.db);
      let hasWrites = false;

      // Seed any missing canonical locations (10 mesas + 18 toldos) without overwriting existing ones
      for (const loc of baseline.locations) {
        if (!existingLocationIds.has(loc.id)) {
          batch.set(doc(this.db, 'locations', loc.id), stripUndefined(loc), { merge: true });
          hasWrites = true;
        }
      }

      // Heal any orphaned occupied location that has no matching open order in Firestore
      const openOrders = existingOrders.docs
        .map((d) => d.data() as Partial<Order>)
        .filter((o) => o.status === 'abierta');
      const openOrderIds = new Set(
        openOrders.map((o) => o.id).filter((id): id is string => Boolean(id)),
      );
      const openOrderLocationIds = new Set(
        openOrders
          .map((o) => o.locationId)
          .filter((id): id is string => Boolean(id)),
      );

      const orphanLocationIds: string[] = [];
      for (const locDoc of existingLocations.docs) {
        const data = locDoc.data() as Partial<Location>;
        const hasOpenOrder =
          openOrderLocationIds.has(locDoc.id) ||
          (typeof data.activeOrderId === 'string' && openOrderIds.has(data.activeOrderId));
        if (data.status && data.status !== 'libre' && !hasOpenOrder) {
          orphanLocationIds.push(locDoc.id);
        }
      }

      // Also heal local-only orphan locations that never reached Firestore
      for (const loc of localState.locations) {
        const hasOpenOrder =
          openOrderLocationIds.has(loc.id) ||
          (typeof loc.activeOrderId === 'string' && openOrderIds.has(loc.activeOrderId));
        if (loc.status !== 'libre' && !hasOpenOrder && !orphanLocationIds.includes(loc.id)) {
          orphanLocationIds.push(loc.id);
        }
      }

      for (const orphanId of orphanLocationIds) {
        await this.releaseLocation(orphanId);
      }

      if (existingMenu.empty) {
        const seedMenu = localState.menu.length > 0 ? localState.menu : baseline.menu;
        for (const item of seedMenu) {
          batch.set(doc(this.db, 'menu', item.id), stripUndefined(item), { merge: true });
        }
        hasWrites = true;
      }

      if (existingIngredients.empty) {
        const seedIngredients =
          localState.ingredients.length > 0 ? localState.ingredients : baseline.ingredients;
        for (const ing of seedIngredients) {
          batch.set(doc(this.db, 'ingredients', ing.id), stripUndefined(ing), { merge: true });
        }
        hasWrites = true;
      }

      if (existingUsers.empty) {
        const seedUsers = localState.users.length > 0 ? localState.users : baseline.users;
        for (const user of seedUsers) {
          batch.set(doc(this.db, 'users', user.id), stripUndefined(user), { merge: true });
        }
        hasWrites = true;
      }

      if (existingShifts.empty) {
        const seedShifts = localState.shifts.length > 0 ? localState.shifts : baseline.shifts;
        for (const shift of seedShifts) {
          batch.set(doc(this.db, 'shifts', shift.id), stripUndefined(shift), { merge: true });
        }
        hasWrites = true;
      }

      const seedSettings = localState.settings ?? baseline.settings;
      if (!existingAppSettings.exists()) {
        batch.set(doc(this.db, 'settings', 'app'), stripUndefined(seedSettings), {
          merge: true,
        });
        hasWrites = true;
      }

      if (!existingPublicSettings.exists()) {
        batch.set(
          doc(this.db, 'settings', 'public'),
          stripUndefined({
            restaurantName: seedSettings.printer.restaurantName,
            printer: seedSettings.printer,
            exchangeRate: seedSettings.exchangeRate,
            exchangeRateUpdatedAt: seedSettings.exchangeRateUpdatedAt,
            exchangeRateSource: seedSettings.exchangeRateSource,
            updatedAt: new Date().toISOString(),
          }),
          { merge: true },
        );
        hasWrites = true;
      }

      if (hasWrites) {
        this.commitNonBlocking(batch.commit());
      }
    } catch {
      // Offline or rules not provisioned yet — local state remains usable
    }
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

  private handleSnapshotError(label: string, err: unknown): void {
    if (typeof console !== 'undefined') {
      console.warn(`[FirebasePosRepository] onSnapshot(${label}) error:`, err);
    }
    if (this.isDisposed || this.reconnectTimer !== null) {
      return;
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.isDisposed) return;
      for (const unsub of this.unsubscribes) {
        unsub();
      }
      this.unsubscribes.length = 0;
      this.attachListeners();
      void this.refreshFromCloud();
    }, 3000);
  }

  private applyRemoteComandas(
    remoteComandas: PosState['comandas'],
    skipIfEmpty = false,
  ): void {
    const role = this.stationRole;
    const current = this.local.getState();
    const pendingLocal = current.comandas.filter((c) => c.pendingSync === true);
    if (
      remoteComandas.length === 0 &&
      pendingLocal.length === 0 &&
      (skipIfEmpty || current.comandas.length === 0)
    ) {
      return;
    }

    const prevStatusById = new Map(current.comandas.map((c) => [c.id, c.status]));
    const newlyReadyLocationIds = new Set<string>();
    for (const comanda of remoteComandas) {
      const prevStatus = prevStatusById.get(comanda.id);
      if (
        comanda.status === 'lista' &&
        comanda.isVoidAlert !== true &&
        prevStatus !== undefined &&
        prevStatus !== 'lista'
      ) {
        newlyReadyLocationIds.add(comanda.locationId);
      }
    }

    const pendingMap = new Map(pendingLocal.map((c) => [c.id, c]));
    const remoteIds = new Set(remoteComandas.map((c) => c.id));
    const merged = [
      ...remoteComandas.map((c) => pendingMap.get(c.id) ?? c),
      ...pendingLocal.filter((c) => !remoteIds.has(c.id)),
    ].sort((a, b) => a.sequenceNumber - b.sequenceNumber);

    const nextLocations =
      newlyReadyLocationIds.size > 0 && role !== 'cocina'
        ? current.locations.map((loc) =>
            newlyReadyLocationIds.has(loc.id) && loc.status !== 'libre'
              ? { ...loc, kitchenReadyAlert: true }
              : loc,
          )
        : current.locations;

    this.local.replaceState({
      ...current,
      locations: nextLocations,
      comandas: merged,
    });
  }

  private applyRemotePrintJobs(remoteJobs: PrintJob[], skipIfEmpty = false): void {
    const current = this.local.getState();
    const pendingComandaIds = this.getPendingComandaIds(current);
    const pendingLocalJobs = current.printJobs.filter((job) =>
      pendingComandaIds.has(job.referenceId),
    );
    if (
      remoteJobs.length === 0 &&
      pendingLocalJobs.length === 0 &&
      (skipIfEmpty || current.printJobs.length === 0)
    ) {
      return;
    }

    const pendingJobMap = new Map(pendingLocalJobs.map((j) => [j.id, j]));
    const remoteIds = new Set(remoteJobs.map((j) => j.id));
    const merged = [
      ...remoteJobs.map((j) => pendingJobMap.get(j.id) ?? j),
      ...pendingLocalJobs.filter((j) => !remoteIds.has(j.id)),
    ];

    this.local.replaceState({ ...current, printJobs: merged });
  }

  private attachListeners(): void {
    this.isDisposed = false;
    const role = this.stationRole;

    if (role !== 'cocina') {
      this.unsubscribes.push(
        onSnapshot(
          collection(this.db, 'locations'),
          (snap) => {
            if (snap.empty) return;
            const current = this.local.getState();
            const remoteLocations = snap.docs.map((d) => d.data() as Location);
            const mergedLocations = mergeLocationsWithBaseline(
              remoteLocations,
              current.locations,
            );
            this.local.replaceState({ ...current, locations: mergedLocations });
          },
          (err) => this.handleSnapshotError('locations', err),
        ),
      );

      this.unsubscribes.push(
        onSnapshot(
          collection(this.db, 'menu'),
          (snap) => {
            if (snap.empty) return;
            const current = this.local.getState();
            const menu = snap.docs.map((d) => d.data() as MenuItem);
            this.local.replaceState({ ...current, menu });
          },
          (err) => this.handleSnapshotError('menu', err),
        ),
      );

      // Mesonero queries MUST filter status == 'abierta' per firestore.rules
      const ordersQuery =
        role === 'mesonero'
          ? query(collection(this.db, 'orders'), where('status', '==', 'abierta'))
          : collection(this.db, 'orders');

      this.unsubscribes.push(
        onSnapshot(
          ordersQuery,
          (snap) => {
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

            if (snap.empty && snap.metadata.fromCache && unsyncedLocal.length === 0) return;
            const mergedOrders = [
              ...incoming.map((o) => unsyncedMap.get(o.id) ?? o),
              ...unsyncedLocal.filter((o) => !remoteIds.has(o.id)),
            ];
            this.local.replaceState({ ...current, orders: mergedOrders });
          },
          (err) => this.handleSnapshotError('orders', err),
        ),
      );
    }

    this.unsubscribes.push(
      onSnapshot(
        collection(this.db, 'comandas'),
        (snap) => {
          this.applyRemoteComandas(
            snap.docs.map((d) => d.data() as PosState['comandas'][number]),
            snap.metadata.fromCache,
          );
        },
        (err) => this.handleSnapshotError('comandas', err),
      ),
    );

    this.unsubscribes.push(
      onSnapshot(
        collection(this.db, 'printJobs'),
        (snap) => {
          this.applyRemotePrintJobs(
            snap.docs.map((d) => d.data() as PrintJob),
            snap.metadata.fromCache,
          );
        },
        (err) => this.handleSnapshotError('printJobs', err),
      ),
    );

    this.unsubscribes.push(
      onSnapshot(
        doc(this.db, 'settings', 'public'),
        (snap) => {
          if (!snap.exists()) return;
          const data = snap.data() as Partial<{
            restaurantName: string;
            printer: PrinterConfig;
            exchangeRate: number;
            exchangeRateUpdatedAt: string;
            exchangeRateSource: string;
          }>;
          const current = this.local.getState();
          this.local.replaceState({
            ...current,
            settings: {
              ...current.settings,
              ...(typeof data.exchangeRate === 'number' && data.exchangeRate > 0
                ? { exchangeRate: data.exchangeRate }
                : {}),
              ...(data.exchangeRateUpdatedAt
                ? { exchangeRateUpdatedAt: data.exchangeRateUpdatedAt }
                : {}),
              ...(data.exchangeRateSource !== undefined
                ? { exchangeRateSource: data.exchangeRateSource }
                : {}),
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
        },
        (err) => this.handleSnapshotError('settings/public', err),
      ),
    );

    if (this.isAdminWriter()) {
      this.unsubscribes.push(
        onSnapshot(
          collection(this.db, 'ingredients'),
          (snap) => {
            if (snap.empty) return;
            const current = this.local.getState();
            this.local.replaceState({
              ...current,
              ingredients: snap.docs.map((d) => d.data() as Ingredient),
            });
          },
          (err) => this.handleSnapshotError('ingredients', err),
        ),
      );

      this.unsubscribes.push(
        onSnapshot(
          collection(this.db, 'inventoryMovements'),
          (snap) => {
            if (snap.empty) return;
            const current = this.local.getState();
            this.local.replaceState({
              ...current,
              movements: snap.docs.map((d) => d.data() as InventoryMovement),
            });
          },
          (err) => this.handleSnapshotError('inventoryMovements', err),
        ),
      );

      this.unsubscribes.push(
        onSnapshot(
          collection(this.db, 'shifts'),
          (snap) => {
            if (snap.empty) return;
            const current = this.local.getState();
            this.local.replaceState({
              ...current,
              shifts: snap.docs.map((d) => d.data() as Shift),
            });
          },
          (err) => this.handleSnapshotError('shifts', err),
        ),
      );

      this.unsubscribes.push(
        onSnapshot(
          collection(this.db, 'users'),
          (snap) => {
            if (snap.empty) return;
            const current = this.local.getState();
            this.local.replaceState({
              ...current,
              users: snap.docs.map((d) => d.data() as UserProfile),
            });
          },
          (err) => this.handleSnapshotError('users', err),
        ),
      );

      this.unsubscribes.push(
        onSnapshot(
          doc(this.db, 'settings', 'app'),
          (snap) => {
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
          },
          (err) => this.handleSnapshotError('settings/app', err),
        ),
      );
    }
  }

  async refreshFromCloud(): Promise<void> {
    try {
      const [comandasSnap, printJobsSnap] = await Promise.all([
        getDocs(collection(this.db, 'comandas')),
        getDocs(collection(this.db, 'printJobs')),
      ]);
      this.applyRemoteComandas(
        comandasSnap.docs.map((d) => d.data() as PosState['comandas'][number]),
        comandasSnap.metadata.fromCache,
      );
      this.applyRemotePrintJobs(
        printJobsSnap.docs.map((d) => d.data() as PrintJob),
        printJobsSnap.metadata.fromCache,
      );

      if (this.stationRole !== 'cocina') {
        const ordersQuery =
          this.stationRole === 'mesonero'
            ? query(collection(this.db, 'orders'), where('status', '==', 'abierta'))
            : collection(this.db, 'orders');
        const [locationsSnap, ordersSnap] = await Promise.all([
          getDocs(collection(this.db, 'locations')),
          getDocs(ordersQuery),
        ]);
        const current = this.local.getState();
        const mergedLocations = locationsSnap.empty
          ? current.locations
          : mergeLocationsWithBaseline(
              locationsSnap.docs.map((d) => d.data() as Location),
              current.locations,
            );
        const incomingOrders = ordersSnap.docs.map((d) => d.data() as Order);
        const pendingComandaIds = this.getPendingComandaIds(current);
        const remoteOrderIds = new Set(incomingOrders.map((o) => o.id));
        const unsyncedLocalOrders = current.orders.filter(
          (o) =>
            !remoteOrderIds.has(o.id) &&
            o.items.some((item) => pendingComandaIds.has(item.comandaId)),
        );
        const ordersAuthoritative =
          this.stationRole !== 'mesonero' && !ordersSnap.metadata.fromCache;
        if (ordersAuthoritative || !locationsSnap.empty) {
          this.local.replaceState({
            ...current,
            locations: mergedLocations,
            ...(ordersAuthoritative
              ? { orders: [...incomingOrders, ...unsyncedLocalOrders] }
              : {}),
          });
        }
      }
    } catch (err) {
      if (typeof console !== 'undefined') {
        console.warn('[FirebasePosRepository] refreshFromCloud failed:', err);
      }
    }
  }

  dispose(): void {
    this.isDisposed = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
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

    batch.set(doc(this.db, 'orders', result.order.id), stripUndefined(result.order), {
      merge: true,
    });
    if (location) {
      batch.set(doc(this.db, 'locations', location.id), stripUndefined(location), {
        merge: true,
      });
    }
    if (result.comanda) {
      batch.set(
        doc(this.db, 'comandas', result.comanda.id),
        stripUndefined(result.comanda),
        { merge: true },
      );
    }
    if (result.printJob) {
      batch.set(
        doc(this.db, 'printJobs', result.printJob.id),
        stripUndefined(result.printJob),
        { merge: true },
      );
    }

    if (this.isAdminWriter()) {
      const touchedIngIds = new Set<string>();
      for (const movement of state.movements) {
        if (!prevMovIds.has(movement.id)) {
          touchedIngIds.add(movement.ingredientId);
          batch.set(
            doc(this.db, 'inventoryMovements', movement.id),
            stripUndefined(movement),
            { merge: true },
          );
        }
      }
      for (const ing of state.ingredients) {
        if (touchedIngIds.has(ing.id)) {
          batch.set(doc(this.db, 'ingredients', ing.id), stripUndefined(ing), {
            merge: true,
          });
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
        batch.set(doc(this.db, 'locations', loc.id), stripUndefined(loc), { merge: true });
        if (loc.activeOrderId) {
          touchedOrderIds.add(loc.activeOrderId);
        }
      }
    }

    for (const comanda of nextState.comandas) {
      if (pendingComandaIds.has(comanda.id)) {
        batch.set(doc(this.db, 'comandas', comanda.id), stripUndefined(comanda), {
          merge: true,
        });
        touchedOrderIds.add(comanda.orderId);
      }
    }

    for (const order of nextState.orders) {
      if (
        touchedOrderIds.has(order.id) ||
        order.items.some((item) => pendingComandaIds.has(item.comandaId))
      ) {
        batch.set(doc(this.db, 'orders', order.id), stripUndefined(order), {
          merge: true,
        });
      }
    }

    for (const job of nextState.printJobs) {
      if (pendingComandaIds.has(job.referenceId)) {
        batch.set(doc(this.db, 'printJobs', job.id), stripUndefined(job), {
          merge: true,
        });
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
          batch.set(
            doc(this.db, 'inventoryMovements', movement.id),
            stripUndefined(movement),
            { merge: true },
          );
        }
      }
      for (const ing of nextState.ingredients) {
        if (touchedIngIds.has(ing.id)) {
          batch.set(doc(this.db, 'ingredients', ing.id), stripUndefined(ing), {
            merge: true,
          });
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

    // Send ONLY the mutated KDS fields via updateDoc so Firestore evaluates strictly as update
    const comandaPatch: Record<string, unknown> = {
      status: comanda.status,
      updatedAt: comanda.updatedAt,
    };
    if (comanda.completedAt) {
      comandaPatch.completedAt = comanda.completedAt;
    }

    if (this.stationRole === 'cocina') {
      // Throw Firestore errors directly on Cocina so the UI displays any rejection instead of silently rolling back
      await updateDoc(doc(this.db, 'comandas', comanda.id), comandaPatch);
      return;
    }

    const batch = writeBatch(this.db);
    batch.set(doc(this.db, 'comandas', comanda.id), comandaPatch, { merge: true });

    if (status === 'lista') {
      const loc = state.locations.find((l) => l.id === comanda.locationId);
      if (loc) {
        batch.set(
          doc(this.db, 'locations', loc.id),
          { kitchenReadyAlert: true },
          { merge: true },
        );
      }
    }
    this.commitNonBlocking(batch.commit());
  }

  async acknowledgeKitchenReady(locationId: string): Promise<void> {
    await this.local.acknowledgeKitchenReady(locationId);
    const loc = this.local.getState().locations.find((l) => l.id === locationId);
    if (loc) {
      this.commitNonBlocking(
        setDoc(doc(this.db, 'locations', loc.id), stripUndefined(loc), { merge: true }),
      );
    }
  }

  async requestCheck(locationId: string): Promise<void> {
    await this.local.requestCheck(locationId);
    const loc = this.local.getState().locations.find((l) => l.id === locationId);
    if (loc) {
      this.commitNonBlocking(
        setDoc(doc(this.db, 'locations', loc.id), stripUndefined(loc), { merge: true }),
      );
    }
  }

  async releaseLocation(locationId: string): Promise<void> {
    await this.local.releaseLocation(locationId);
    const loc = this.local.getState().locations.find((l) => l.id === locationId);
    if (loc) {
      this.commitNonBlocking(
        setDoc(doc(this.db, 'locations', loc.id), stripUndefined(loc), { merge: true }),
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
      batch.set(doc(this.db, 'orders', order.id), stripUndefined(order), { merge: true });
    }
    for (const comanda of state.comandas) {
      if (!prevComandaIds.has(comanda.id)) {
        batch.set(doc(this.db, 'comandas', comanda.id), stripUndefined(comanda), {
          merge: true,
        });
      }
    }
    for (const job of state.printJobs) {
      if (!prevJobIds.has(job.id)) {
        batch.set(doc(this.db, 'printJobs', job.id), stripUndefined(job), {
          merge: true,
        });
      }
    }

    if (this.isAdminWriter()) {
      const touchedIngIds = new Set<string>();
      for (const movement of state.movements) {
        if (!prevMovIds.has(movement.id)) {
          touchedIngIds.add(movement.ingredientId);
          batch.set(
            doc(this.db, 'inventoryMovements', movement.id),
            stripUndefined(movement),
            { merge: true },
          );
        }
      }
      for (const ing of state.ingredients) {
        if (touchedIngIds.has(ing.id)) {
          batch.set(doc(this.db, 'ingredients', ing.id), stripUndefined(ing), {
            merge: true,
          });
        }
      }
    }

    this.commitNonBlocking(batch.commit());
  }

  async settleOrder(orderId: string, payments: PaymentEntry[]): Promise<Order> {
    const prevPendingComandaIds = new Set(
      this.local
        .getState()
        .comandas.filter((c) => c.orderId === orderId && c.status !== 'lista')
        .map((c) => c.id),
    );
    const settled = await this.local.settleOrder(orderId, payments);
    const state = this.local.getState();
    const loc = state.locations.find((l) => l.id === settled.locationId);
    const shift = state.shifts.find((s) => s.id === settled.shiftId);

    const batch = writeBatch(this.db);
    batch.set(doc(this.db, 'orders', settled.id), stripUndefined(settled), {
      merge: true,
    });
    if (loc) {
      batch.set(doc(this.db, 'locations', loc.id), stripUndefined(loc), { merge: true });
    }
    if (shift) {
      batch.set(doc(this.db, 'shifts', shift.id), stripUndefined(shift), { merge: true });
    }
    for (const comanda of state.comandas) {
      if (prevPendingComandaIds.has(comanda.id)) {
        batch.set(
          doc(this.db, 'comandas', comanda.id),
          {
            status: comanda.status,
            updatedAt: comanda.updatedAt,
            ...(comanda.completedAt ? { completedAt: comanda.completedAt } : {}),
          },
          { merge: true },
        );
      }
    }
    this.commitNonBlocking(batch.commit());
    return settled;
  }

  async openShift(userId: string): Promise<Shift> {
    const shift = await this.local.openShift(userId);
    this.commitNonBlocking(
      setDoc(doc(this.db, 'shifts', shift.id), stripUndefined(shift), { merge: true }),
    );
    return shift;
  }

  async closeShift(userId: string, notes?: string): Promise<CloseShiftResult> {
    const res = await this.local.closeShift(userId, notes);
    const batch = writeBatch(this.db);
    batch.set(doc(this.db, 'shifts', res.shift.id), stripUndefined(res.shift), {
      merge: true,
    });
    batch.set(doc(this.db, 'printJobs', res.printJob.id), stripUndefined(res.printJob), {
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
    batch.set(doc(this.db, 'ingredients', ing.id), stripUndefined(ing), { merge: true });
    for (const movement of state.movements) {
      if (!prevMovIds.has(movement.id)) {
        batch.set(
          doc(this.db, 'inventoryMovements', movement.id),
          stripUndefined(movement),
          { merge: true },
        );
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
      setDoc(doc(this.db, 'ingredients', saved.id), stripUndefined(saved), {
        merge: true,
      }),
    );
    return saved;
  }

  async saveMenuItem(
    item: Omit<MenuItem, 'id'> & { id?: string },
  ): Promise<MenuItem> {
    const saved = await this.local.saveMenuItem(item);
    this.commitNonBlocking(
      setDoc(doc(this.db, 'menu', saved.id), stripUndefined(saved), { merge: true }),
    );
    return saved;
  }

  async toggleMenuOutOfStock(
    menuItemId: string,
    outOfStock?: boolean,
  ): Promise<MenuItem> {
    const updated = await this.local.toggleMenuOutOfStock(menuItemId, outOfStock);
    this.commitNonBlocking(
      setDoc(doc(this.db, 'menu', updated.id), stripUndefined(updated), { merge: true }),
    );
    return updated;
  }

  async updateExchangeRate(rate: number, source = 'Manual'): Promise<void> {
    await this.local.updateExchangeRate(rate, source);
    if (!this.isAdminWriter()) {
      return;
    }
    const state = this.local.getState();
    const batch = writeBatch(this.db);
    batch.set(doc(this.db, 'settings', 'app'), stripUndefined(state.settings), {
      merge: true,
    });
    batch.set(
      doc(this.db, 'settings', 'public'),
      stripUndefined({
        restaurantName: state.settings.printer.restaurantName,
        printer: state.settings.printer,
        exchangeRate: state.settings.exchangeRate,
        exchangeRateUpdatedAt: state.settings.exchangeRateUpdatedAt,
        exchangeRateSource: state.settings.exchangeRateSource,
        updatedAt: new Date().toISOString(),
      }),
      { merge: true },
    );
    for (const order of state.orders) {
      if (order.status === 'abierta') {
        batch.set(doc(this.db, 'orders', order.id), stripUndefined(order), {
          merge: true,
        });
      }
    }
    this.commitNonBlocking(batch.commit());
  }

  async saveUser(
    user: Omit<UserProfile, 'id'> & { id?: string },
  ): Promise<UserProfile> {
    const saved = await this.local.saveUser(user);
    this.commitNonBlocking(
      setDoc(doc(this.db, 'users', saved.id), stripUndefined(saved), { merge: true }),
    );
    return saved;
  }

  async savePrinterConfig(printer: PrinterConfig): Promise<void> {
    await this.local.savePrinterConfig(printer);
    const state = this.local.getState();
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
      stripUndefined({
        restaurantName: normalizedPrinter.restaurantName,
        printer: normalizedPrinter,
        exchangeRate: state.settings.exchangeRate,
        exchangeRateUpdatedAt: state.settings.exchangeRateUpdatedAt,
        exchangeRateSource: state.settings.exchangeRateSource,
        updatedAt: new Date().toISOString(),
      }),
      { merge: true },
    );
    if (this.isAdminWriter()) {
      batch.set(doc(this.db, 'settings', 'app'), stripUndefined(state.settings), {
        merge: true,
      });
    }
    this.commitNonBlocking(batch.commit());
  }

  async createPreCuentaPrintJob(orderId: string): Promise<PrintJob> {
    const job = await this.local.createPreCuentaPrintJob(orderId);
    const state = this.local.getState();
    const order = state.orders.find((o) => o.id === orderId);
    const location = order
      ? state.locations.find((l) => l.id === order.locationId)
      : undefined;

    const batch = writeBatch(this.db);
    batch.set(doc(this.db, 'printJobs', job.id), stripUndefined(job), { merge: true });
    if (order) {
      batch.set(doc(this.db, 'orders', order.id), stripUndefined(order), { merge: true });
    }
    if (location) {
      batch.set(doc(this.db, 'locations', location.id), stripUndefined(location), {
        merge: true,
      });
    }
    this.commitNonBlocking(batch.commit());
    return job;
  }

  async createTestPrintJob(): Promise<PrintJob> {
    const job = await this.local.createTestPrintJob();
    this.commitNonBlocking(
      setDoc(doc(this.db, 'printJobs', job.id), stripUndefined(job), { merge: true }),
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
    // Send ONLY mutated print-state fields so role-scoped rules (Cocina/Mesonero) see exact affectedKeys()
    const jobPatch: Record<string, unknown> = {
      status: job.status,
    };
    if (job.printedAt) {
      jobPatch.printedAt = job.printedAt;
    }
    if (job.error !== undefined) {
      jobPatch.error = job.error;
    }
    batch.set(doc(this.db, 'printJobs', job.id), jobPatch, { merge: true });
    if (job.type === 'comanda') {
      const comanda = state.comandas.find((c) => c.id === job.referenceId);
      if (comanda) {
        batch.set(
          doc(this.db, 'comandas', comanda.id),
          { printStatus: comanda.printStatus },
          { merge: true },
        );
      }
    }
    this.commitNonBlocking(batch.commit());
  }

  async resetDemoData(): Promise<void> {
    if (!this.isAdminWriter()) {
      throw new Error('Solo Caja / Admin puede reiniciar los datos.');
    }
    // Preserve real printer config + BCV exchange rate across resets
    const preservedSettings = this.local.getState().settings;
    const failures: string[] = [];

    const runStep = async (label: string, fn: () => Promise<void>): Promise<void> => {
      try {
        await withTimeout(fn(), 20000, label);
      } catch (err) {
        failures.push(label);
        if (typeof console !== 'undefined') {
          console.warn(`[FirebasePosRepository] reset step failed: ${label}`, err);
        }
      }
    };

    // 1. Delete all transactional history in the cloud (orders, comandas, print jobs, kardex, shifts)
    for (const name of ['orders', 'comandas', 'printJobs', 'inventoryMovements', 'shifts']) {
      await runStep(`borrar ${name}`, async () => {
        const snap = await getDocs(collection(this.db, name));
        await this.commitInChunks(snap.docs.map((d) => (b: WriteBatch) => b.delete(d.ref)));
      });
    }

    // 2. Reset local state, keeping the real printer + exchange rate settings
    await this.local.resetDemoData();
    const fresh = this.local.getState();
    this.local.replaceState({ ...fresh, settings: preservedSettings });
    const state = this.local.getState();

    // 3. Re-seed catalogs and a fresh open shift in independent batches
    await runStep('mesas y toldos', () =>
      this.commitInChunks(
        state.locations.map((loc) => (b: WriteBatch) =>
          b.set(doc(this.db, 'locations', loc.id), stripUndefined(loc)),
        ),
      ),
    );
    await runStep('menú', () =>
      this.commitInChunks(
        state.menu.map((item) => (b: WriteBatch) =>
          b.set(doc(this.db, 'menu', item.id), stripUndefined(item), { merge: true }),
        ),
      ),
    );
    await runStep('inventario', () =>
      this.commitInChunks(
        state.ingredients.map((ing) => (b: WriteBatch) =>
          b.set(doc(this.db, 'ingredients', ing.id), stripUndefined(ing), { merge: true }),
        ),
      ),
    );
    await runStep('usuarios', () =>
      this.commitInChunks(
        state.users.map((user) => (b: WriteBatch) =>
          b.set(doc(this.db, 'users', user.id), stripUndefined(user), { merge: true }),
        ),
      ),
    );
    await runStep('turno', () =>
      this.commitInChunks(
        state.shifts.map((shift) => (b: WriteBatch) =>
          b.set(doc(this.db, 'shifts', shift.id), stripUndefined(shift)),
        ),
      ),
    );

    if (failures.length > 0) {
      throw new Error(
        `Reinicio incompleto en la nube (falló: ${failures.join(', ')}). Revisa la conexión e intenta de nuevo.`,
      );
    }
  }

  private async commitInChunks(ops: Array<(batch: WriteBatch) => void>): Promise<void> {
    for (let i = 0; i < ops.length; i += 400) {
      const batch = writeBatch(this.db);
      for (const op of ops.slice(i, i + 400)) {
        op(batch);
      }
      await batch.commit();
    }
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
