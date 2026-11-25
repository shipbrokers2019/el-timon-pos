import type {
  Order,
  OrderItem,
  PaymentCurrency,
  PaymentEntry,
  PaymentMethod,
} from '../types/pos';

const SETTLEMENT_TOLERANCE_USD = 0.005;

const PAYMENT_METHODS: readonly PaymentMethod[] = [
  'zelle',
  'efectivo_usd',
  'debito_punto',
  'efectivo_bs',
];

function assertValidRate(rate: number): void {
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error('Exchange rate must be a finite number greater than 0');
  }
}

export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error('Monetary value must be a finite number');
  }
  const absRounded = Math.round((Math.abs(value) + 1e-9) * 100) / 100;
  if (absRounded === 0) {
    return 0;
  }
  return value < 0 ? -absRounded : absRounded;
}

export function getMethodCurrency(method: PaymentMethod): PaymentCurrency {
  if (method === 'zelle' || method === 'efectivo_usd') {
    return 'USD';
  }
  return 'VES';
}

export function usdToBs(usd: number, rate: number): number {
  assertValidRate(rate);
  return roundMoney(usd * rate);
}

export function bsToUsd(bs: number, rate: number): number {
  assertValidRate(rate);
  return roundMoney(bs / rate);
}

export function createPaymentEntry(params: {
  id: string;
  method: PaymentMethod;
  amountNative: number;
  exchangeRate: number;
  reference?: string;
  paidAt: string;
}): PaymentEntry {
  assertValidRate(params.exchangeRate);
  if (!Number.isFinite(params.amountNative) || params.amountNative < 0) {
    throw new Error('Payment amount must be a non-negative finite number');
  }

  const currency = getMethodCurrency(params.method);
  const amountNative = roundMoney(params.amountNative);
  const amountUsd =
    currency === 'USD'
      ? amountNative
      : bsToUsd(amountNative, params.exchangeRate);
  const amountBs =
    currency === 'VES'
      ? amountNative
      : usdToBs(amountNative, params.exchangeRate);

  const entry: PaymentEntry = {
    id: params.id,
    method: params.method,
    currency,
    amountNative,
    amountUsd,
    amountBs,
    exchangeRate: params.exchangeRate,
    paidAt: params.paidAt,
  };

  if (params.reference !== undefined) {
    entry.reference = params.reference;
  }

  return entry;
}

export const DEFAULT_IVA_RATE = 0.16;

export interface OrderBreakdown {
  subtotalUsd: number;
  subtotalBs: number;
  ivaRate: number;
  ivaUsd: number;
  ivaBs: number;
  totalUsd: number;
  totalBs: number;
}

export function calculateOrderSubtotalUsd(items: OrderItem[]): number {
  const sum = items.reduce((acc, item) => {
    if (item.voided === true) {
      return acc;
    }
    return acc + item.quantity * item.unitPriceUsd;
  }, 0);

  return roundMoney(sum);
}

export function calculateOrderBreakdown(
  items: OrderItem[],
  rate: number,
  ivaRate = DEFAULT_IVA_RATE,
): OrderBreakdown {
  assertValidRate(rate);
  const subtotalUsd = calculateOrderSubtotalUsd(items);
  const ivaUsd = roundMoney(subtotalUsd * ivaRate);
  const totalUsd = roundMoney(subtotalUsd + ivaUsd);
  const subtotalBs = usdToBs(subtotalUsd, rate);
  const totalBs = usdToBs(totalUsd, rate);
  const ivaBs = roundMoney(totalBs - subtotalBs);

  return {
    subtotalUsd,
    subtotalBs,
    ivaRate,
    ivaUsd,
    ivaBs,
    totalUsd,
    totalBs,
  };
}

export function calculateOrderTotalUsd(
  items: OrderItem[],
  ivaRate = DEFAULT_IVA_RATE,
): number {
  const subtotalUsd = calculateOrderSubtotalUsd(items);
  const ivaUsd = roundMoney(subtotalUsd * ivaRate);
  return roundMoney(subtotalUsd + ivaUsd);
}

export interface PaymentSummary {
  totalUsd: number;
  totalBs: number;
  paidUsd: number;
  paidBs: number;
  remainingUsd: number;
  remainingBs: number;
  changeUsd: number;
  changeBs: number;
  isSettled: boolean;
}

export function calculatePaymentSummary(
  totalUsd: number,
  payments: PaymentEntry[],
  rate: number,
): PaymentSummary {
  assertValidRate(rate);

  const normalizedTotalUsd = roundMoney(totalUsd);
  const totalBs = usdToBs(normalizedTotalUsd, rate);
  const paidUsdRaw = payments.reduce((acc, payment) => acc + payment.amountUsd, 0);
  const paidBsRaw = payments.reduce((acc, payment) => acc + payment.amountBs, 0);
  const paidUsd = roundMoney(paidUsdRaw);
  const paidBs = roundMoney(paidBsRaw);

  const deficitUsd = normalizedTotalUsd - paidUsdRaw;
  const isSettled = deficitUsd <= SETTLEMENT_TOLERANCE_USD;

  if (isSettled) {
    const excessUsd = paidUsd - normalizedTotalUsd;
    const changeUsd = excessUsd > SETTLEMENT_TOLERANCE_USD ? roundMoney(excessUsd) : 0;
    const changeBs = changeUsd > 0 ? usdToBs(changeUsd, rate) : 0;

    return {
      totalUsd: normalizedTotalUsd,
      totalBs,
      paidUsd,
      paidBs,
      remainingUsd: 0,
      remainingBs: 0,
      changeUsd,
      changeBs,
      isSettled: true,
    };
  }

  const remainingUsd = roundMoney(normalizedTotalUsd - paidUsd);
  const remainingBs = usdToBs(remainingUsd, rate);

  return {
    totalUsd: normalizedTotalUsd,
    totalBs,
    paidUsd,
    paidBs,
    remainingUsd,
    remainingBs,
    changeUsd: 0,
    changeBs: 0,
    isSettled: false,
  };
}

export function summarizePaymentsByMethod(
  orders: Order[],
): Record<PaymentMethod, { count: number; totalUsd: number; totalBs: number }> {
  const totals = {
    zelle: { count: 0, totalUsd: 0, totalBs: 0 },
    efectivo_usd: { count: 0, totalUsd: 0, totalBs: 0 },
    debito_punto: { count: 0, totalUsd: 0, totalBs: 0 },
    efectivo_bs: { count: 0, totalUsd: 0, totalBs: 0 },
  } satisfies Record<PaymentMethod, { count: number; totalUsd: number; totalBs: number }>;

  for (const order of orders) {
    for (const payment of order.payments) {
      const bucket = totals[payment.method];
      bucket.count += 1;
      bucket.totalUsd += payment.amountUsd;
      bucket.totalBs += payment.amountBs;
    }
  }

  for (const method of PAYMENT_METHODS) {
    totals[method].totalUsd = roundMoney(totals[method].totalUsd);
    totals[method].totalBs = roundMoney(totals[method].totalBs);
  }

  return totals;
}
