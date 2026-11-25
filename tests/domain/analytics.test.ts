import { describe, expect, it } from 'vitest';
import { computeAnalytics } from '../../src/domain/analytics';
import { createPaymentEntry } from '../../src/domain/currency';
import type {
  Ingredient,
  InventoryMovement,
  Order,
  UserProfile,
} from '../../src/types/pos';

function localIso(year: number, month: number, day: number, hour: number, minute = 0): string {
  return new Date(year, month - 1, day, hour, minute, 0).toISOString();
}

describe('computeAnalytics', () => {
  const users: UserProfile[] = [
    { id: 'u-1', name: 'Carlos Perez', role: 'mesonero', pin: '1111', active: true },
    { id: 'u-2', name: 'Maria Gomez', role: 'mesonero', pin: '2222', active: true },
  ];

  const ingredients: Ingredient[] = [
    { id: 'ing-1', name: 'Pargo Fresco', unit: 'kg', stock: 1.5, minStock: 2 },
    { id: 'ing-2', name: 'Limon', unit: 'kg', stock: 5, minStock: 1 },
  ];

  const orders: Order[] = [
    {
      id: 'ord-1',
      locationId: 'mesa-1',
      locationLabel: 'Mesa 1',
      zone: 'mesas',
      waiterId: 'u-1',
      waiterName: 'Carlos',
      shiftId: 'shift-1',
      status: 'cerrada',
      items: [
        {
          id: 'i-1',
          menuItemId: 'm-pargo',
          name: 'Pargo Frito',
          quantity: 2,
          unitPriceUsd: 18,
          notes: '',
          sendsToKitchen: true,
          comandaId: 'c-1',
        },
        {
          id: 'i-2',
          menuItemId: 'm-cerveza',
          name: 'Cerveza',
          quantity: 4,
          unitPriceUsd: 2.5,
          notes: '',
          sendsToKitchen: false,
          comandaId: 'c-1',
        },
        {
          id: 'i-void',
          menuItemId: 'm-tostones',
          name: 'Tostones',
          quantity: 3,
          unitPriceUsd: 5,
          notes: '',
          sendsToKitchen: true,
          comandaId: 'c-1',
          voided: true,
        },
      ],
      totalUsd: 46,
      totalBs: 1840,
      exchangeRate: 40,
      payments: [
        createPaymentEntry({
          id: 'p-1',
          method: 'zelle',
          amountNative: 26,
          exchangeRate: 40,
          paidAt: localIso(2026, 11, 25, 13, 15),
        }),
        createPaymentEntry({
          id: 'p-2',
          method: 'debito_punto',
          amountNative: 800,
          exchangeRate: 40,
          paidAt: localIso(2026, 11, 25, 13, 16),
        }),
      ],
      openedAt: localIso(2026, 11, 25, 12, 30),
      closedAt: localIso(2026, 11, 25, 13, 16),
    },
    {
      id: 'ord-2',
      locationId: 'toldo-5',
      locationLabel: 'Toldo 5',
      zone: 'toldos',
      waiterId: 'u-2',
      waiterName: 'Maria',
      shiftId: 'shift-1',
      status: 'cerrada',
      items: [
        {
          id: 'i-3',
          menuItemId: 'm-pargo',
          name: 'Pargo Frito',
          quantity: 1,
          unitPriceUsd: 18,
          notes: '',
          sendsToKitchen: true,
          comandaId: 'c-2',
        },
        {
          id: 'i-4',
          menuItemId: 'm-ceviche',
          name: 'Ceviche Mixto',
          quantity: 1,
          unitPriceUsd: 12,
          notes: '',
          sendsToKitchen: true,
          comandaId: 'c-2',
        },
      ],
      totalUsd: 30,
      totalBs: 1500,
      exchangeRate: 50,
      payments: [
        createPaymentEntry({
          id: 'p-3',
          method: 'efectivo_usd',
          amountNative: 30,
          exchangeRate: 50,
          paidAt: localIso(2026, 11, 25, 13, 45),
        }),
      ],
      openedAt: localIso(2026, 11, 25, 13, 0),
      closedAt: localIso(2026, 11, 25, 13, 45),
    },
    {
      id: 'ord-3',
      locationId: 'toldo-8',
      locationLabel: 'Toldo 8',
      zone: 'toldos',
      waiterId: 'u-2',
      waiterName: 'Maria',
      shiftId: 'shift-1',
      status: 'cerrada',
      items: [
        {
          id: 'i-5',
          menuItemId: 'm-cerveza',
          name: 'Cerveza',
          quantity: 2,
          unitPriceUsd: 2.5,
          notes: '',
          sendsToKitchen: false,
          comandaId: 'c-3',
        },
      ],
      totalUsd: 5,
      totalBs: 250,
      exchangeRate: 50,
      payments: [
        createPaymentEntry({
          id: 'p-4',
          method: 'efectivo_bs',
          amountNative: 250,
          exchangeRate: 50,
          paidAt: localIso(2026, 11, 25, 16, 10),
        }),
      ],
      openedAt: localIso(2026, 11, 25, 15, 45),
      closedAt: localIso(2026, 11, 25, 16, 10),
    },
    // Excluded: open order
    {
      id: 'ord-open',
      locationId: 'mesa-2',
      locationLabel: 'Mesa 2',
      zone: 'mesas',
      waiterId: 'u-1',
      waiterName: 'Carlos',
      shiftId: 'shift-1',
      status: 'abierta',
      items: [
        {
          id: 'i-open',
          menuItemId: 'm-pargo',
          name: 'Pargo Frito',
          quantity: 5,
          unitPriceUsd: 18,
          notes: '',
          sendsToKitchen: true,
          comandaId: 'c-4',
        },
      ],
      totalUsd: 90,
      totalBs: 4500,
      exchangeRate: 50,
      payments: [],
      openedAt: localIso(2026, 11, 25, 16, 30),
    },
    // Excluded: outside range
    {
      id: 'ord-old',
      locationId: 'mesa-3',
      locationLabel: 'Mesa 3',
      zone: 'mesas',
      waiterId: 'u-1',
      waiterName: 'Carlos',
      shiftId: 'shift-0',
      status: 'cerrada',
      items: [],
      totalUsd: 100,
      totalBs: 4000,
      exchangeRate: 40,
      payments: [],
      openedAt: localIso(2026, 11, 24, 12, 0),
      closedAt: localIso(2026, 11, 24, 13, 0),
    },
  ];

  const movements: InventoryMovement[] = [
    {
      id: 'mov-1',
      ingredientId: 'ing-1',
      ingredientName: 'Pargo Fresco',
      type: 'venta',
      delta: -1.2,
      unit: 'kg',
      reason: 'Venta Mesa 1',
      referenceId: 'c-1',
      userId: 'u-1',
      createdAt: localIso(2026, 11, 25, 13, 0),
    },
    {
      id: 'mov-2',
      ingredientId: 'ing-1',
      ingredientName: 'Pargo Fresco',
      type: 'venta',
      delta: -0.6,
      unit: 'kg',
      reason: 'Venta Toldo 5',
      referenceId: 'c-2',
      userId: 'u-2',
      createdAt: localIso(2026, 11, 25, 13, 30),
    },
    {
      id: 'mov-3',
      ingredientId: 'ing-2',
      ingredientName: 'Limon',
      type: 'venta',
      delta: -0.3,
      unit: 'kg',
      reason: 'Venta Toldo 5',
      referenceId: 'c-2',
      userId: 'u-2',
      createdAt: localIso(2026, 11, 25, 13, 30),
    },
    // Non-venta or out-of-range movements should be ignored
    {
      id: 'mov-repos',
      ingredientId: 'ing-1',
      ingredientName: 'Pargo Fresco',
      type: 'reposicion',
      delta: 5,
      unit: 'kg',
      reason: 'Compra',
      userId: 'u-1',
      createdAt: localIso(2026, 11, 25, 10, 0),
    },
    {
      id: 'mov-old',
      ingredientId: 'ing-2',
      ingredientName: 'Limon',
      type: 'venta',
      delta: -2,
      unit: 'kg',
      reason: 'Ayer',
      userId: 'u-1',
      createdAt: localIso(2026, 11, 24, 15, 0),
    },
  ];

  it('computes revenue, top/bottom dishes, zones, peak hours, waiters, payments and ingredient usage', () => {
    const report = computeAnalytics(orders, movements, ingredients, users, {
      fromIso: localIso(2026, 11, 25, 0, 0),
      toIso: localIso(2026, 11, 25, 23, 59),
    });

    expect(report.ordersCount).toBe(3);
    expect(report.totalRevenueUsd).toBe(81);
    expect(report.totalRevenueBs).toBe(3590);
    expect(report.averageTicketUsd).toBe(27);

    // Top dishes: Cerveza (6 sold, $15), Pargo Frito (3 sold, $54), Ceviche Mixto (1 sold, $12)
    expect(report.topDishes.map((d) => [d.menuItemId, d.quantitySold, d.revenueUsd])).toEqual([
      ['m-cerveza', 6, 15],
      ['m-pargo', 3, 54],
      ['m-ceviche', 1, 12],
    ]);
    expect(report.bottomDishes.map((d) => d.menuItemId)).toEqual([
      'm-ceviche',
      'm-pargo',
      'm-cerveza',
    ]);

    // Zones
    expect(report.byZone.mesas).toEqual({
      ordersCount: 1,
      revenueUsd: 46,
      averageTicketUsd: 46,
    });
    expect(report.byZone.toldos).toEqual({
      ordersCount: 2,
      revenueUsd: 35,
      averageTicketUsd: 17.5,
    });

    // Peak hours
    const hour13 = report.byHour.find((h) => h.hour === 13);
    const hour16 = report.byHour.find((h) => h.hour === 16);
    expect(hour13).toEqual({ hour: 13, label: '13:00', ordersCount: 2, revenueUsd: 76 });
    expect(hour16).toEqual({ hour: 16, label: '16:00', ordersCount: 1, revenueUsd: 5 });

    // Payment breakdown preserving frozen rates (40 vs 50)
    expect(report.byPaymentMethod).toEqual({
      zelle: { count: 1, totalUsd: 26, totalBs: 1040 },
      efectivo_usd: { count: 1, totalUsd: 30, totalBs: 1500 },
      debito_punto: { count: 1, totalUsd: 20, totalBs: 800 },
      efectivo_bs: { count: 1, totalUsd: 5, totalBs: 250 },
    });

    // Waiters
    expect(report.byWaiter).toEqual([
      { waiterId: 'u-1', waiterName: 'Carlos Perez', ordersCount: 1, revenueUsd: 46 },
      { waiterId: 'u-2', waiterName: 'Maria Gomez', ordersCount: 2, revenueUsd: 35 },
    ]);

    // Ingredient consumption within range
    expect(report.ingredientUsage).toEqual([
      {
        ingredientId: 'ing-1',
        ingredientName: 'Pargo Fresco',
        unit: 'kg',
        consumedQuantity: 1.8,
        currentStock: 1.5,
        minStock: 2,
        needsRestock: true,
      },
      {
        ingredientId: 'ing-2',
        ingredientName: 'Limon',
        unit: 'kg',
        consumedQuantity: 0.3,
        currentStock: 5,
        minStock: 1,
        needsRestock: false,
      },
    ]);
  });
});
