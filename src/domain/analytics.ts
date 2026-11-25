import type {
  Ingredient,
  InventoryMovement,
  Order,
  PaymentMethod,
  Unit,
  UserProfile,
} from '../types/pos';
import { roundMoney, summarizePaymentsByMethod } from './currency';

export interface DishStat {
  menuItemId: string;
  name: string;
  quantitySold: number;
  revenueUsd: number;
}

export interface ZoneStat {
  ordersCount: number;
  revenueUsd: number;
  averageTicketUsd: number;
}

export interface HourStat {
  hour: number;
  label: string;
  ordersCount: number;
  revenueUsd: number;
}

export interface WaiterStat {
  waiterId: string;
  waiterName: string;
  ordersCount: number;
  revenueUsd: number;
}

export interface IngredientUsageStat {
  ingredientId: string;
  ingredientName: string;
  unit: Unit;
  consumedQuantity: number;
  currentStock: number;
  minStock: number;
  needsRestock: boolean;
}

export interface AnalyticsReport {
  totalRevenueUsd: number;
  totalRevenueBs: number;
  ordersCount: number;
  averageTicketUsd: number;
  topDishes: DishStat[];
  bottomDishes: DishStat[];
  byZone: {
    mesas: ZoneStat;
    toldos: ZoneStat;
  };
  byHour: HourStat[];
  byPaymentMethod: Record<PaymentMethod, { count: number; totalUsd: number; totalBs: number }>;
  byWaiter: WaiterStat[];
  ingredientUsage: IngredientUsageStat[];
}

function roundQuantity(value: number): number {
  return Math.round((value + 1e-9) * 1000) / 1000;
}

function isWithinRange(iso: string | undefined, fromMs: number, toMs: number): boolean {
  if (!iso) {
    return false;
  }
  const ts = Date.parse(iso);
  return Number.isFinite(ts) && ts >= fromMs && ts <= toMs;
}

/**
 * Computes management analytics for Caja/Admin over an inclusive ISO date range.
 */
export function computeAnalytics(
  orders: Order[],
  movements: InventoryMovement[],
  ingredients: Ingredient[],
  users: UserProfile[],
  range: { fromIso: string; toIso: string },
): AnalyticsReport {
  const fromMs = Date.parse(range.fromIso);
  const toMs = Date.parse(range.toIso);

  const closedOrders = orders.filter(
    (order) => order.status === 'cerrada' && isWithinRange(order.closedAt, fromMs, toMs),
  );

  const totalRevenueUsd = roundMoney(
    closedOrders.reduce((sum, order) => sum + order.totalUsd, 0),
  );
  const totalRevenueBs = roundMoney(
    closedOrders.reduce((sum, order) => sum + order.totalBs, 0),
  );
  const ordersCount = closedOrders.length;
  const averageTicketUsd = ordersCount > 0 ? roundMoney(totalRevenueUsd / ordersCount) : 0;

  const dishMap = new Map<string, DishStat>();
  const zoneAccum = {
    mesas: { ordersCount: 0, revenueUsd: 0 },
    toldos: { ordersCount: 0, revenueUsd: 0 },
  };
  const hours: HourStat[] = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    label: `${String(hour).padStart(2, '0')}:00`,
    ordersCount: 0,
    revenueUsd: 0,
  }));
  const userNameById = new Map(users.map((user) => [user.id, user.name]));
  const waiterMap = new Map<string, WaiterStat>();

  for (const order of closedOrders) {
    // Zone aggregation
    const zoneBucket = zoneAccum[order.zone];
    zoneBucket.ordersCount += 1;
    zoneBucket.revenueUsd += order.totalUsd;

    // Hour aggregation (local hour of closedAt)
    if (order.closedAt) {
      const hour = new Date(order.closedAt).getHours();
      const hourBucket = hours[hour];
      if (hourBucket) {
        hourBucket.ordersCount += 1;
        hourBucket.revenueUsd += order.totalUsd;
      }
    }

    // Waiter aggregation
    const existingWaiter = waiterMap.get(order.waiterId);
    if (existingWaiter) {
      existingWaiter.ordersCount += 1;
      existingWaiter.revenueUsd += order.totalUsd;
    } else {
      waiterMap.set(order.waiterId, {
        waiterId: order.waiterId,
        waiterName: userNameById.get(order.waiterId) ?? order.waiterName,
        ordersCount: 1,
        revenueUsd: order.totalUsd,
      });
    }

    // Dish aggregation (excluding voided items)
    for (const item of order.items) {
      if (item.voided === true) {
        continue;
      }
      const lineRevenue = item.quantity * item.unitPriceUsd;
      const existingDish = dishMap.get(item.menuItemId);
      if (existingDish) {
        existingDish.quantitySold += item.quantity;
        existingDish.revenueUsd += lineRevenue;
      } else {
        dishMap.set(item.menuItemId, {
          menuItemId: item.menuItemId,
          name: item.name,
          quantitySold: item.quantity,
          revenueUsd: lineRevenue,
        });
      }
    }
  }

  const dishes = Array.from(dishMap.values()).map((dish) => ({
    ...dish,
    revenueUsd: roundMoney(dish.revenueUsd),
  }));

  const topDishes = dishes.slice().sort((a, b) => {
    if (b.quantitySold !== a.quantitySold) {
      return b.quantitySold - a.quantitySold;
    }
    if (b.revenueUsd !== a.revenueUsd) {
      return b.revenueUsd - a.revenueUsd;
    }
    return a.name.localeCompare(b.name);
  });

  const bottomDishes = dishes.slice().sort((a, b) => {
    if (a.quantitySold !== b.quantitySold) {
      return a.quantitySold - b.quantitySold;
    }
    if (a.revenueUsd !== b.revenueUsd) {
      return a.revenueUsd - b.revenueUsd;
    }
    return a.name.localeCompare(b.name);
  });

  const mesasRevenue = roundMoney(zoneAccum.mesas.revenueUsd);
  const toldosRevenue = roundMoney(zoneAccum.toldos.revenueUsd);
  const byZone = {
    mesas: {
      ordersCount: zoneAccum.mesas.ordersCount,
      revenueUsd: mesasRevenue,
      averageTicketUsd:
        zoneAccum.mesas.ordersCount > 0
          ? roundMoney(mesasRevenue / zoneAccum.mesas.ordersCount)
          : 0,
    },
    toldos: {
      ordersCount: zoneAccum.toldos.ordersCount,
      revenueUsd: toldosRevenue,
      averageTicketUsd:
        zoneAccum.toldos.ordersCount > 0
          ? roundMoney(toldosRevenue / zoneAccum.toldos.ordersCount)
          : 0,
    },
  };

  const byHour = hours.map((entry) => ({
    ...entry,
    revenueUsd: roundMoney(entry.revenueUsd),
  }));

  const byPaymentMethod = summarizePaymentsByMethod(closedOrders);

  const byWaiter = Array.from(waiterMap.values())
    .map((waiter) => ({
      ...waiter,
      revenueUsd: roundMoney(waiter.revenueUsd),
    }))
    .sort((a, b) => b.revenueUsd - a.revenueUsd || b.ordersCount - a.ordersCount);

  // Ingredient consumption from venta movements within [fromIso, toIso]
  const ingredientById = new Map(ingredients.map((ing) => [ing.id, ing]));
  const usageMap = new Map<string, IngredientUsageStat>();

  for (const movement of movements) {
    if (movement.type !== 'venta' || !isWithinRange(movement.createdAt, fromMs, toMs)) {
      continue;
    }

    const qty = Math.abs(movement.delta);
    const existing = usageMap.get(movement.ingredientId);
    if (existing) {
      existing.consumedQuantity += qty;
    } else {
      const ing = ingredientById.get(movement.ingredientId);
      const currentStock = ing?.stock ?? 0;
      const minStock = ing?.minStock ?? 0;
      usageMap.set(movement.ingredientId, {
        ingredientId: movement.ingredientId,
        ingredientName: ing?.name ?? movement.ingredientName,
        unit: ing?.unit ?? movement.unit,
        consumedQuantity: qty,
        currentStock,
        minStock,
        needsRestock: currentStock <= minStock,
      });
    }
  }

  const ingredientUsage = Array.from(usageMap.values())
    .map((entry) => ({
      ...entry,
      consumedQuantity: roundQuantity(entry.consumedQuantity),
    }))
    .sort((a, b) => b.consumedQuantity - a.consumedQuantity);

  return {
    totalRevenueUsd,
    totalRevenueBs,
    ordersCount,
    averageTicketUsd,
    topDishes,
    bottomDishes,
    byZone,
    byHour,
    byPaymentMethod,
    byWaiter,
    ingredientUsage,
  };
}
