import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { TicketPayload } from '../domain/escpos';
import { createPosRepository } from '../services/firebaseRepository';
import type {
  CloseShiftResult,
  PosRepository,
  SubmitComandaInput,
  SubmitComandaResult,
} from '../services/posRepository';
import { PrintCoordinator } from '../services/printerService';
import type {
  ComandaStatus,
  Ingredient,
  MenuItem,
  Order,
  PaymentEntry,
  PosState,
  PrintJob,
  PrinterConfig,
  Role,
  Shift,
  UserProfile,
  VoidDisposition,
} from '../types/pos';

const STATION_LOCK_KEY = 'brisa_pos_station_lock_v1';
const CURRENT_USER_KEY = 'brisa_pos_current_user_v1';

export interface PosContextValue {
  state: PosState;
  currentUser: UserProfile | null;
  lockedStationRole: Role | null;
  isOnline: boolean;
  isOfflineSimulated: boolean;
  pendingSyncCount: number;
  activeTicketPreview: PrintJob | null;
  setLockedStationRole: (role: Role | null) => void;
  setOfflineSimulation: (offline: boolean) => void;
  dismissTicketPreview: () => void;
  openTicketPreview: (job: PrintJob) => void;
  loginWithPin: (pin: string) => UserProfile | null;
  logout: () => void;
  submitComanda: (input: SubmitComandaInput) => Promise<SubmitComandaResult>;
  syncOfflineQueue: () => Promise<void>;
  updateComandaStatus: (comandaId: string, status: ComandaStatus) => Promise<void>;
  acknowledgeKitchenReady: (locationId: string) => Promise<void>;
  requestCheck: (locationId: string) => Promise<void>;
  voidOrderItem: (
    orderId: string,
    itemId: string,
    disposition: VoidDisposition,
    reason: string,
  ) => Promise<void>;
  settleOrder: (orderId: string, payments: PaymentEntry[]) => Promise<Order>;
  openShift: () => Promise<Shift>;
  closeShift: (notes?: string) => Promise<CloseShiftResult>;
  adjustIngredientStock: (
    ingredientId: string,
    delta: number,
    type: 'reposicion' | 'merma' | 'ajuste',
    reason: string,
  ) => Promise<Ingredient>;
  saveIngredient: (
    ingredient: Omit<Ingredient, 'id'> & { id?: string },
  ) => Promise<Ingredient>;
  saveMenuItem: (item: Omit<MenuItem, 'id'> & { id?: string }) => Promise<MenuItem>;
  toggleMenuOutOfStock: (menuItemId: string, outOfStock?: boolean) => Promise<MenuItem>;
  updateExchangeRate: (rate: number) => Promise<void>;
  saveUser: (user: Omit<UserProfile, 'id'> & { id?: string }) => Promise<UserProfile>;
  savePrinterConfig: (printer: PrinterConfig) => Promise<void>;
  createPreCuentaPrintJob: (orderId: string) => Promise<PrintJob>;
  createTestPrintJob: () => Promise<PrintJob>;
  reprintJob: (job: PrintJob) => Promise<void>;
  resetDemoData: () => Promise<void>;
}

const PosContext = createContext<PosContextValue | null>(null);

function readSessionValue(key: string): string | null {
  if (typeof sessionStorage === 'undefined') {
    return null;
  }
  return sessionStorage.getItem(key);
}

function writeSessionValue(key: string, value: string | null): void {
  if (typeof sessionStorage === 'undefined') {
    return;
  }
  if (value === null) {
    sessionStorage.removeItem(key);
  } else {
    sessionStorage.setItem(key, value);
  }
}

function readStoredStationRole(): Role | null {
  if (typeof localStorage === 'undefined') {
    return null;
  }
  const stored = localStorage.getItem(STATION_LOCK_KEY);
  if (stored === 'mesonero' || stored === 'cocina' || stored === 'caja_admin') {
    return stored;
  }
  return null;
}

function resolveTicketPayload(
  job: PrintJob,
  posState: PosState,
): TicketPayload | undefined {
  const { printer, exchangeRate } = posState.settings;
  const restaurantName = printer.restaurantName;

  switch (job.type) {
    case 'comanda': {
      const comanda = posState.comandas.find((c) => c.id === job.referenceId);
      return comanda ? { type: 'comanda', restaurantName, comanda } : undefined;
    }
    case 'anulacion': {
      const voidComanda = posState.comandas.find((c) => c.id === job.referenceId);
      const item = voidComanda?.items[0];
      if (!voidComanda || !item) return undefined;
      return {
        type: 'anulacion',
        restaurantName,
        locationLabel: voidComanda.locationLabel,
        waiterName: voidComanda.waiterName,
        item,
        reason: voidComanda.voidReason ?? item.voidReason ?? '',
        timestampIso: job.createdAt,
      };
    }
    case 'precuenta': {
      const order = posState.orders.find((o) => o.id === job.referenceId);
      if (!order) return undefined;
      return {
        type: 'precuenta',
        restaurantName,
        order,
        exchangeRate: order.status === 'cerrada' ? order.exchangeRate : exchangeRate,
        timestampIso: job.createdAt,
      };
    }
    case 'cierre': {
      const shift = posState.shifts.find((s) => s.id === job.referenceId);
      if (!shift) return undefined;
      const closedByName =
        posState.users.find((u) => u.id === shift.closedBy)?.name ??
        shift.closedBy ??
        '';
      return {
        type: 'cierre',
        restaurantName,
        shift,
        closedByName,
        timestampIso: job.createdAt,
      };
    }
    case 'prueba':
      return {
        type: 'prueba',
        restaurantName,
        ip: printer.ip,
        port: printer.port,
        timestampIso: job.createdAt,
      };
  }
}

export function PosProvider({
  children,
  repository,
}: {
  children: ReactNode;
  repository?: PosRepository;
}) {
  const [lockedStationRole, setLockedStationRoleState] = useState<Role | null>(() =>
    readStoredStationRole(),
  );

  const repo = useMemo(
    () => repository ?? createPosRepository({ stationRole: lockedStationRole }),
    [repository, lockedStationRole],
  );

  const [state, setState] = useState<PosState>(() => repo.getState());
  const [pendingSyncCount, setPendingSyncCount] = useState<number>(() =>
    repo.getPendingSyncCount(),
  );
  const [browserOnline, setBrowserOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const [isOfflineSimulated, setIsOfflineSimulated] = useState<boolean>(false);
  const [activeTicketPreview, setActiveTicketPreview] = useState<PrintJob | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(() =>
    readSessionValue(CURRENT_USER_KEY),
  );

  const isOnline = browserOnline && !isOfflineSimulated;
  const isOnlineRef = useRef(isOnline);
  const previousOnlineRef = useRef(isOnline);

  useEffect(() => {
    isOnlineRef.current = isOnline;
  }, [isOnline]);

  useEffect(() => {
    setState(repo.getState());
    setPendingSyncCount(repo.getPendingSyncCount());
    const unsub = repo.subscribe((nextState) => {
      setState(nextState);
      setPendingSyncCount(repo.getPendingSyncCount());
    });
    return () => {
      unsub();
      if (!repository && 'dispose' in repo && typeof repo.dispose === 'function') {
        (repo as { dispose: () => void }).dispose();
      }
    };
  }, [repo, repository]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const handleOnline = () => setBrowserOnline(true);
    const handleOffline = () => setBrowserOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    const wasOnline = previousOnlineRef.current;
    previousOnlineRef.current = isOnline;
    if (!wasOnline && isOnline && repo.getPendingSyncCount() > 0) {
      void repo.syncOfflineQueue();
    }
  }, [isOnline, repo]);

  const printCoordinator = useMemo(() => {
    const initiallyPrintedIds = repo
      .getState()
      .printJobs.filter(
        (job) => job.status === 'printed' || job.status === 'printed_locally',
      )
      .map((job) => job.id);

    return new PrintCoordinator({
      initiallyPrintedIds,
      onPreviewTicket: (job) => {
        setActiveTicketPreview(job);
      },
      onJobStatusChange: (jobId, status, meta) =>
        repo.updatePrintJobStatus(jobId, status, meta),
    });
  }, [repo]);

  // Auto-print incoming pending kitchen/void jobs when running on Cocina station
  const activeRole = lockedStationRole ?? null;
  const currentUser = useMemo(() => {
    if (!currentUserId) {
      return null;
    }
    return state.users.find((u) => u.id === currentUserId && u.active) ?? null;
  }, [currentUserId, state.users]);

  const effectiveRole = activeRole ?? currentUser?.role ?? null;

  useEffect(() => {
    if (
      effectiveRole !== 'cocina' ||
      !state.settings.printer.autoPrintFromKitchen ||
      !isOnline
    ) {
      return;
    }

    const pendingKitchenJobs = state.printJobs.filter(
      (job) =>
        (job.type === 'comanda' || job.type === 'anulacion') &&
        job.status === 'pending' &&
        !printCoordinator.hasPrinted(job.id),
    );

    for (const job of pendingKitchenJobs) {
      const payload = resolveTicketPayload(job, state);

      void printCoordinator.printJob({
        job,
        payload,
        config: state.settings.printer,
        isCloudOffline: false,
      });
    }
  }, [
    effectiveRole,
    isOnline,
    printCoordinator,
    state,
  ]);

  const setLockedStationRole = useCallback((role: Role | null) => {
    if (typeof localStorage !== 'undefined') {
      if (role === null) {
        localStorage.removeItem(STATION_LOCK_KEY);
      } else {
        localStorage.setItem(STATION_LOCK_KEY, role);
      }
    }
    setLockedStationRoleState(role);
  }, []);

  const loginWithPin = useCallback(
    (pin: string): UserProfile | null => {
      const cleanPin = pin.trim();
      const matched = state.users.find(
        (user) => user.active && user.pin === cleanPin,
      );
      if (!matched) {
        return null;
      }
      if (lockedStationRole && matched.role !== lockedStationRole) {
        return null;
      }
      setCurrentUserId(matched.id);
      writeSessionValue(CURRENT_USER_KEY, matched.id);
      return matched;
    },
    [lockedStationRole, state.users],
  );

  const logout = useCallback(() => {
    setCurrentUserId(null);
    writeSessionValue(CURRENT_USER_KEY, null);
  }, []);

  const requireUser = useCallback((): UserProfile => {
    if (!currentUser) {
      throw new Error('Debe iniciar sesión con su PIN primero');
    }
    return currentUser;
  }, [currentUser]);

  const submitComanda = useCallback(
    async (input: SubmitComandaInput): Promise<SubmitComandaResult> => {
      const cloudOffline = !isOnlineRef.current;
      const result = await repo.submitComanda({
        ...input,
        isOffline: input.isOffline ?? cloudOffline,
      });

      const printerConfig = repo.getState().settings.printer;
      if (result.printJob && result.comanda && cloudOffline && printerConfig.lanFallbackEnabled) {
        await printCoordinator.printJob({
          job: result.printJob,
          config: printerConfig,
          payload: {
            type: 'comanda',
            restaurantName: printerConfig.restaurantName,
            comanda: result.comanda,
          },
          isCloudOffline: true,
        });
      }

      return result;
    },
    [printCoordinator, repo],
  );

  const voidOrderItem = useCallback(
    async (
      orderId: string,
      itemId: string,
      disposition: VoidDisposition,
      reason: string,
    ) => {
      const admin = requireUser();
      const prevIds = new Set(repo.getState().printJobs.map((j) => j.id));
      await repo.voidOrderItem(orderId, itemId, disposition, reason, {
        id: admin.id,
        name: admin.name,
      });
      const latest = repo.getState();
      const newVoidJob = latest.printJobs.find(
        (j) => !prevIds.has(j.id) && j.type === 'anulacion',
      );
      if (newVoidJob && !isOnlineRef.current && latest.settings.printer.lanFallbackEnabled) {
        await printCoordinator.printJob({
          job: newVoidJob,
          config: latest.settings.printer,
          payload: resolveTicketPayload(newVoidJob, latest),
          isCloudOffline: true,
        });
      }
    },
    [printCoordinator, repo, requireUser],
  );

  const closeShift = useCallback(
    async (notes?: string): Promise<CloseShiftResult> => {
      const user = requireUser();
      const res = await repo.closeShift(user.id, notes);
      const latest = repo.getState();
      await printCoordinator.printJob({
        job: res.printJob,
        config: latest.settings.printer,
        payload: {
          type: 'cierre',
          restaurantName: latest.settings.printer.restaurantName,
          shift: res.shift,
          closedByName: user.name,
          timestampIso: res.printJob.createdAt,
        },
        isCloudOffline: !isOnlineRef.current,
      });
      return res;
    },
    [printCoordinator, repo, requireUser],
  );

  const createPreCuentaPrintJob = useCallback(
    async (orderId: string): Promise<PrintJob> => {
      const job = await repo.createPreCuentaPrintJob(orderId);
      const latest = repo.getState();
      const order = latest.orders.find((o) => o.id === orderId);
      await printCoordinator.printJob({
        job,
        config: latest.settings.printer,
        payload: order
          ? {
              type: 'precuenta',
              restaurantName: latest.settings.printer.restaurantName,
              order,
              exchangeRate:
                order.status === 'cerrada'
                  ? order.exchangeRate
                  : latest.settings.exchangeRate,
              timestampIso: job.createdAt,
            }
          : undefined,
        isCloudOffline: !isOnlineRef.current,
      });
      return job;
    },
    [printCoordinator, repo],
  );

  const createTestPrintJob = useCallback(async (): Promise<PrintJob> => {
    const job = await repo.createTestPrintJob();
    const { printer } = repo.getState().settings;
    await printCoordinator.printJob({
      job,
      config: printer,
      payload: {
        type: 'prueba',
        restaurantName: printer.restaurantName,
        ip: printer.ip,
        port: printer.port,
        timestampIso: job.createdAt,
      },
      isCloudOffline: !isOnlineRef.current,
    });
    return job;
  }, [printCoordinator, repo]);

  const reprintJob = useCallback(
    async (job: PrintJob): Promise<void> => {
      const latest = repo.getState();
      await printCoordinator.printJob({
        job,
        config: latest.settings.printer,
        payload: resolveTicketPayload(job, latest),
        isCloudOffline: !isOnlineRef.current,
        forceReprint: true,
      });
    },
    [printCoordinator, repo],
  );

  const value: PosContextValue = {
    state,
    currentUser,
    lockedStationRole,
    isOnline,
    isOfflineSimulated,
    pendingSyncCount,
    activeTicketPreview,
    setLockedStationRole,
    setOfflineSimulation: setIsOfflineSimulated,
    dismissTicketPreview: () => setActiveTicketPreview(null),
    openTicketPreview: (job) => setActiveTicketPreview(job),
    loginWithPin,
    logout,
    submitComanda,
    syncOfflineQueue: () => repo.syncOfflineQueue(),
    updateComandaStatus: (comandaId, status) =>
      repo.updateComandaStatus(comandaId, status),
    acknowledgeKitchenReady: (locationId) =>
      repo.acknowledgeKitchenReady(locationId),
    requestCheck: (locationId) => repo.requestCheck(locationId),
    voidOrderItem,
    settleOrder: (orderId, payments) => repo.settleOrder(orderId, payments),
    openShift: () => repo.openShift(requireUser().id),
    closeShift,
    adjustIngredientStock: (ingredientId, delta, type, reason) =>
      repo.adjustIngredientStock(
        ingredientId,
        delta,
        type,
        reason,
        requireUser().id,
      ),
    saveIngredient: (ingredient) => repo.saveIngredient(ingredient),
    saveMenuItem: (item) => repo.saveMenuItem(item),
    toggleMenuOutOfStock: (menuItemId, outOfStock) =>
      repo.toggleMenuOutOfStock(menuItemId, outOfStock),
    updateExchangeRate: (rate) => repo.updateExchangeRate(rate),
    saveUser: (user) => repo.saveUser(user),
    savePrinterConfig: (printer) => repo.savePrinterConfig(printer),
    createPreCuentaPrintJob,
    createTestPrintJob,
    reprintJob,
    resetDemoData: () => repo.resetDemoData(),
  };

  return <PosContext.Provider value={value}>{children}</PosContext.Provider>;
}

export function usePos(): PosContextValue {
  const ctx = useContext(PosContext);
  if (!ctx) {
    throw new Error('usePos debe usarse dentro de un <PosProvider>');
  }
  return ctx;
}
