export type Role = 'mesonero' | 'cocina' | 'caja_admin';

export type Zone = 'mesas' | 'toldos';

export type LocationStatus = 'libre' | 'ocupada' | 'por_cobrar';

export interface Location {
  id: string;
  zone: Zone;
  number: number;
  label: string;
  status: LocationStatus;
  activeOrderId: string | null;
  pendingSync?: boolean;
  kitchenReadyAlert?: boolean;
}

export type Unit = 'g' | 'kg' | 'ml' | 'L' | 'unidad';

export interface Ingredient {
  id: string;
  name: string;
  unit: Unit;
  stock: number;
  minStock: number;
  unitCostUsd?: number;
}

export interface RecipeLine {
  ingredientId: string;
  quantity: number;
  unit: Unit;
}

export type MenuCategory = 'Platos' | 'Entradas' | 'Bebidas' | 'Cócteles' | 'Extras';

export interface MenuItem {
  id: string;
  name: string;
  category: MenuCategory;
  priceUsd: number;
  sendsToKitchen: boolean;
  outOfStock: boolean;
  recipe: RecipeLine[];
}

export type VoidDisposition = 'restock' | 'merma';

export interface OrderItem {
  id: string;
  menuItemId: string;
  name: string;
  quantity: number;
  unitPriceUsd: number;
  notes: string;
  sendsToKitchen: boolean;
  comandaId: string;
  voided?: boolean;
  voidReason?: string;
  voidDisposition?: VoidDisposition;
  voidedBy?: string;
  voidedAt?: string;
}

export type ComandaStatus = 'pendiente' | 'en_preparacion' | 'lista';

export type PrintStatus = 'pending' | 'printing' | 'printed' | 'printed_locally' | 'failed';

export interface Comanda {
  id: string;
  sequenceNumber: number;
  orderId: string;
  locationId: string;
  locationLabel: string;
  zone: Zone;
  roundNumber: number;
  waiterId: string;
  waiterName: string;
  items: OrderItem[];
  status: ComandaStatus;
  printStatus: PrintStatus;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  pendingSync?: boolean;
  isVoidAlert?: boolean;
  voidReason?: string;
}

export type PaymentMethod = 'zelle' | 'efectivo_usd' | 'debito_punto' | 'efectivo_bs';

export type PaymentCurrency = 'USD' | 'VES';

export interface PaymentEntry {
  id: string;
  method: PaymentMethod;
  currency: PaymentCurrency;
  amountNative: number;
  amountUsd: number;
  amountBs: number;
  exchangeRate: number;
  reference?: string;
  paidAt: string;
}

export interface Order {
  id: string;
  locationId: string;
  locationLabel: string;
  zone: Zone;
  waiterId: string;
  waiterName: string;
  shiftId: string;
  status: 'abierta' | 'cerrada';
  items: OrderItem[];
  totalUsd: number;
  totalBs: number;
  exchangeRate: number;
  payments: PaymentEntry[];
  openedAt: string;
  closedAt?: string;
}

export type InventoryMovementType =
  | 'venta'
  | 'reposicion'
  | 'merma'
  | 'ajuste'
  | 'anulacion_devolucion';

export interface InventoryMovement {
  id: string;
  ingredientId: string;
  ingredientName: string;
  type: InventoryMovementType;
  delta: number;
  unit: Unit;
  reason: string;
  referenceId?: string;
  userId: string;
  createdAt: string;
}

export interface Shift {
  id: string;
  openedAt: string;
  openedBy: string;
  closedAt?: string;
  closedBy?: string;
  status: 'abierto' | 'cerrado';
  notes?: string;
  totalSalesUsd: number;
  totalSalesBs: number;
  ordersCount: number;
  totalsByMethod: Record<PaymentMethod, { count: number; totalUsd: number; totalBs: number }>;
}

export interface UserProfile {
  id: string;
  name: string;
  role: Role;
  pin: string;
  active: boolean;
}

export interface PrinterConfig {
  restaurantName: string;
  ip: string;
  port: number;
  autoPrintFromKitchen: boolean;
  lanFallbackEnabled: boolean;
}

export interface PrintJob {
  id: string;
  type: 'comanda' | 'anulacion' | 'precuenta' | 'cierre' | 'prueba';
  referenceId: string;
  title: string;
  textPreview: string;
  status: PrintStatus;
  createdAt: string;
  printedAt?: string;
  error?: string;
}

export interface AppSettings {
  exchangeRate: number;
  exchangeRateUpdatedAt: string;
  exchangeRateSource?: string;
  printer: PrinterConfig;
}

export interface PosState {
  locations: Location[];
  menu: MenuItem[];
  ingredients: Ingredient[];
  orders: Order[];
  comandas: Comanda[];
  movements: InventoryMovement[];
  shifts: Shift[];
  users: UserProfile[];
  settings: AppSettings;
  printJobs: PrintJob[];
  nextComandaSeq: number;
}
