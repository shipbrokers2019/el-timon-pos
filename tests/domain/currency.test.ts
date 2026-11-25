import { describe, expect, it } from 'vitest';
import {
  bsToUsd,
  calculateOrderTotalUsd,
  calculatePaymentSummary,
  createPaymentEntry,
  getMethodCurrency,
  roundMoney,
  summarizePaymentsByMethod,
  usdToBs,
} from '../../src/domain/currency';
import type { Order, OrderItem, PaymentEntry } from '../../src/types/pos';

describe('roundMoney', () => {
  it('rounds floating-point edge cases accurately to 2 decimals', () => {
    expect(roundMoney(1.005)).toBe(1.01);
    expect(roundMoney(10.005)).toBe(10.01);
    expect(roundMoney(12.344)).toBe(12.34);
    expect(roundMoney(19.999)).toBe(20);
    expect(roundMoney(-0)).toBe(0);
  });
});

describe('getMethodCurrency', () => {
  it('maps USD-native and VES-native payment methods accurately', () => {
    expect(getMethodCurrency('zelle')).toBe('USD');
    expect(getMethodCurrency('efectivo_usd')).toBe('USD');
    expect(getMethodCurrency('debito_punto')).toBe('VES');
    expect(getMethodCurrency('efectivo_bs')).toBe('VES');
  });
});

describe('usdToBs and bsToUsd', () => {
  it('converts USD to Bs and back with 2-decimal precision', () => {
    expect(usdToBs(10.33, 45.5)).toBe(470.02);
    expect(bsToUsd(470.02, 45.5)).toBe(10.33);
    expect(usdToBs(0, 45.5)).toBe(0);
    expect(bsToUsd(0, 45.5)).toBe(0);
  });

  it('throws on invalid exchange rates', () => {
    expect(() => usdToBs(10, 0)).toThrow();
    expect(() => usdToBs(10, -40)).toThrow();
    expect(() => bsToUsd(100, 0)).toThrow();
    expect(() => bsToUsd(100, Number.NaN)).toThrow();
    expect(() => usdToBs(10, Number.POSITIVE_INFINITY)).toThrow();
  });
});

describe('createPaymentEntry', () => {
  it('creates a USD-native payment entry with frozen Bs conversion', () => {
    const entry = createPaymentEntry({
      id: 'pay-1',
      method: 'zelle',
      amountNative: 15.5,
      exchangeRate: 42.5,
      reference: 'Z-9911',
      paidAt: '2026-11-25T03:00:00Z',
    });

    expect(entry).toEqual({
      id: 'pay-1',
      method: 'zelle',
      currency: 'USD',
      amountNative: 15.5,
      amountUsd: 15.5,
      amountBs: 658.75,
      exchangeRate: 42.5,
      reference: 'Z-9911',
      paidAt: '2026-11-25T03:00:00Z',
    });
  });

  it('creates a VES-native payment entry with frozen USD conversion', () => {
    const entry = createPaymentEntry({
      id: 'pay-2',
      method: 'debito_punto',
      amountNative: 242.52,
      exchangeRate: 45.5,
      paidAt: '2026-11-25T03:05:00Z',
    });

    expect(entry).toEqual({
      id: 'pay-2',
      method: 'debito_punto',
      currency: 'VES',
      amountNative: 242.52,
      amountUsd: 5.33,
      amountBs: 242.52,
      exchangeRate: 45.5,
      paidAt: '2026-11-25T03:05:00Z',
    });
  });

  it('rejects negative payment amounts or invalid exchange rates', () => {
    expect(() =>
      createPaymentEntry({
        id: 'pay-bad-1',
        method: 'efectivo_usd',
        amountNative: -5,
        exchangeRate: 45,
        paidAt: '2026-11-25T03:05:00Z',
      }),
    ).toThrow();

    expect(() =>
      createPaymentEntry({
        id: 'pay-bad-2',
        method: 'efectivo_bs',
        amountNative: 100,
        exchangeRate: 0,
        paidAt: '2026-11-25T03:05:00Z',
      }),
    ).toThrow();
  });
});

describe('calculateOrderTotalUsd', () => {
  it('sums item quantities and unit prices while ignoring voided items', () => {
    const items: OrderItem[] = [
      {
        id: 'oi-1',
        menuItemId: 'm-1',
        name: 'Pargo Frito',
        quantity: 2,
        unitPriceUsd: 18.5,
        notes: '',
        sendsToKitchen: true,
        comandaId: 'c-1',
      },
      {
        id: 'oi-2',
        menuItemId: 'm-2',
        name: 'Cerveza',
        quantity: 3,
        unitPriceUsd: 2.5,
        notes: '',
        sendsToKitchen: false,
        comandaId: 'c-1',
      },
      {
        id: 'oi-3',
        menuItemId: 'm-3',
        name: 'Tostones (Anulado)',
        quantity: 1,
        unitPriceUsd: 6,
        notes: '',
        sendsToKitchen: true,
        comandaId: 'c-1',
        voided: true,
        voidReason: 'Error de mesonero',
        voidDisposition: 'restock',
      },
    ];

    expect(calculateOrderTotalUsd(items)).toBe(44.5);
  });

  it('returns 0 when empty or all items are voided', () => {
    expect(calculateOrderTotalUsd([])).toBe(0);
    expect(
      calculateOrderTotalUsd([
        {
          id: 'oi-1',
          menuItemId: 'm-1',
          name: 'Cerveza',
          quantity: 1,
          unitPriceUsd: 3,
          notes: '',
          sendsToKitchen: false,
          comandaId: 'c-1',
          voided: true,
        },
      ]),
    ).toBe(0);
  });
});

describe('calculatePaymentSummary', () => {
  it('settles mixed USD and Bs payments on fractional total $10.33 cleanly', () => {
    const rate = 45.5;
    const totalUsd = 10.33;
    // $5.00 in efectivo_usd + remaining $5.33 * 45.5 = 242.515 -> 242.52 Bs via debito_punto
    const payments: PaymentEntry[] = [
      createPaymentEntry({
        id: 'p-1',
        method: 'efectivo_usd',
        amountNative: 5,
        exchangeRate: rate,
        paidAt: '2026-11-25T03:10:00Z',
      }),
      createPaymentEntry({
        id: 'p-2',
        method: 'debito_punto',
        amountNative: 242.52,
        exchangeRate: rate,
        paidAt: '2026-11-25T03:10:30Z',
      }),
    ];

    const summary = calculatePaymentSummary(totalUsd, payments, rate);

    expect(summary).toEqual({
      totalUsd: 10.33,
      totalBs: 470.02,
      paidUsd: 10.33,
      paidBs: 470.02,
      remainingUsd: 0,
      remainingBs: 0,
      changeUsd: 0,
      changeBs: 0,
      isSettled: true,
    });
  });

  it('settles within 0.005 USD floating-point cent tolerance', () => {
    const rate = 43.17;
    // $10.33 * 43.17 = 445.9461 -> 445.95 Bs.
    // Suppose customer pays $4.00 USD (= 172.68 Bs) + 273.10 Bs (which is 6.32615 -> 6.33 USD or close)
    // Test raw PaymentEntry where paidUsd is 10.326 (within 0.004 of 10.33)
    const payments: PaymentEntry[] = [
      {
        id: 'p-tol',
        method: 'debito_punto',
        currency: 'VES',
        amountNative: 445.77,
        amountUsd: 10.326,
        amountBs: 445.77,
        exchangeRate: rate,
        paidAt: '2026-11-25T03:11:00Z',
      },
    ];

    const summary = calculatePaymentSummary(10.33, payments, rate);
    expect(summary.isSettled).toBe(true);
    expect(summary.remainingUsd).toBe(0);
    expect(summary.remainingBs).toBe(0);
  });

  it('reports remaining balance when underpaid beyond tolerance', () => {
    const rate = 50;
    const payments: PaymentEntry[] = [
      createPaymentEntry({
        id: 'p-part',
        method: 'efectivo_usd',
        amountNative: 10,
        exchangeRate: rate,
        paidAt: '2026-11-25T03:12:00Z',
      }),
    ];

    const summary = calculatePaymentSummary(10.33, payments, rate);
    expect(summary.isSettled).toBe(false);
    expect(summary.remainingUsd).toBe(0.33);
    expect(summary.remainingBs).toBe(16.5);
    expect(summary.changeUsd).toBe(0);
    expect(summary.changeBs).toBe(0);
  });

  it('computes accurate visual change in USD and Bs on overpayment', () => {
    const rate = 40;
    const payments: PaymentEntry[] = [
      createPaymentEntry({
        id: 'p-1',
        method: 'efectivo_usd',
        amountNative: 5,
        exchangeRate: rate,
        paidAt: '2026-11-25T03:15:00Z',
      }),
      createPaymentEntry({
        id: 'p-2',
        method: 'efectivo_bs',
        amountNative: 300,
        exchangeRate: rate,
        paidAt: '2026-11-25T03:15:10Z',
      }),
    ];

    const summary = calculatePaymentSummary(10.33, payments, rate);
    expect(summary).toEqual({
      totalUsd: 10.33,
      totalBs: 413.2,
      paidUsd: 12.5,
      paidBs: 500,
      remainingUsd: 0,
      remainingBs: 0,
      changeUsd: 2.17,
      changeBs: 86.8,
      isSettled: true,
    });
  });
});

describe('summarizePaymentsByMethod', () => {
  it('preserves each payment entrys frozen amountUsd and amountBs across different exchange rates', () => {
    const orderAt40: Order = {
      id: 'ord-1',
      locationId: 'mesa-1',
      locationLabel: 'Mesa 1',
      zone: 'mesas',
      waiterId: 'u-1',
      waiterName: 'Carlos',
      shiftId: 'shift-1',
      status: 'cerrada',
      items: [],
      totalUsd: 20,
      totalBs: 800,
      exchangeRate: 40,
      payments: [
        createPaymentEntry({
          id: 'p-1',
          method: 'zelle',
          amountNative: 10,
          exchangeRate: 40,
          paidAt: '2026-11-25T01:00:00Z',
        }),
        createPaymentEntry({
          id: 'p-2',
          method: 'debito_punto',
          amountNative: 400,
          exchangeRate: 40,
          paidAt: '2026-11-25T01:01:00Z',
        }),
      ],
      openedAt: '2026-11-25T00:30:00Z',
      closedAt: '2026-11-25T01:01:00Z',
    };

    const orderAt50: Order = {
      id: 'ord-2',
      locationId: 'toldo-3',
      locationLabel: 'Toldo 3',
      zone: 'toldos',
      waiterId: 'u-1',
      waiterName: 'Carlos',
      shiftId: 'shift-1',
      status: 'cerrada',
      items: [],
      totalUsd: 20,
      totalBs: 1000,
      exchangeRate: 50,
      payments: [
        createPaymentEntry({
          id: 'p-3',
          method: 'zelle',
          amountNative: 10,
          exchangeRate: 50,
          paidAt: '2026-11-25T02:00:00Z',
        }),
        createPaymentEntry({
          id: 'p-4',
          method: 'debito_punto',
          amountNative: 500,
          exchangeRate: 50,
          paidAt: '2026-11-25T02:01:00Z',
        }),
      ],
      openedAt: '2026-11-25T01:30:00Z',
      closedAt: '2026-11-25T02:01:00Z',
    };

    const summary = summarizePaymentsByMethod([orderAt40, orderAt50]);

    expect(summary).toEqual({
      zelle: { count: 2, totalUsd: 20, totalBs: 900 },
      efectivo_usd: { count: 0, totalUsd: 0, totalBs: 0 },
      debito_punto: { count: 2, totalUsd: 20, totalBs: 900 },
      efectivo_bs: { count: 0, totalUsd: 0, totalBs: 0 },
    });
  });
});
