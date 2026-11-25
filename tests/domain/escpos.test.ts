import { describe, expect, it } from 'vitest';
import {
  buildEscPosBytes,
  formatTicketText,
  type TicketPayload,
} from '../../src/domain/escpos';
import type { Comanda, Order, Shift } from '../../src/types/pos';

const sampleComanda: Comanda = {
  id: 'cmd-1',
  sequenceNumber: 12,
  orderId: 'ord-1',
  locationId: 'toldo-14',
  locationLabel: 'Toldo 14',
  zone: 'toldos',
  roundNumber: 2,
  waiterId: 'u-1',
  waiterName: 'Carlos Pérez',
  items: [
    {
      id: 'oi-1',
      menuItemId: 'm-1',
      name: 'Pargo Frito Especial de la Casa',
      quantity: 2,
      unitPriceUsd: 18.5,
      notes: 'Bien tostado sin ajo',
      sendsToKitchen: true,
      comandaId: 'cmd-1',
    },
  ],
  status: 'pendiente',
  printStatus: 'pending',
  createdAt: '2026-11-25T15:00:00Z',
  updatedAt: '2026-11-25T15:00:00Z',
};

const sampleOrder: Order = {
  id: 'ord-1',
  locationId: 'mesa-3',
  locationLabel: 'Mesa 3',
  zone: 'mesas',
  waiterId: 'u-1',
  waiterName: 'María',
  shiftId: 'shift-1',
  status: 'abierta',
  items: [
    {
      id: 'oi-1',
      menuItemId: 'm-1',
      name: 'Ceviche Mixto',
      quantity: 2,
      unitPriceUsd: 12,
      notes: '',
      sendsToKitchen: true,
      comandaId: 'cmd-1',
    },
    {
      id: 'oi-void',
      menuItemId: 'm-2',
      name: 'Langosta Anulada',
      quantity: 1,
      unitPriceUsd: 45,
      notes: '',
      sendsToKitchen: true,
      comandaId: 'cmd-1',
      voided: true,
      voidReason: 'Cliente cambio de opinion',
    },
  ],
  totalUsd: 24,
  totalBs: 1080,
  exchangeRate: 45,
  payments: [],
  openedAt: '2026-11-25T14:00:00Z',
};

const sampleShift: Shift = {
  id: 'shift-1',
  openedAt: '2026-11-25T08:00:00Z',
  openedBy: 'u-admin',
  closedAt: '2026-11-25T20:00:00Z',
  closedBy: 'u-admin',
  status: 'cerrado',
  totalSalesUsd: 150,
  totalSalesBs: 6750,
  ordersCount: 5,
  totalsByMethod: {
    zelle: { count: 2, totalUsd: 60, totalBs: 2700 },
    efectivo_usd: { count: 1, totalUsd: 40, totalBs: 1800 },
    debito_punto: { count: 1, totalUsd: 30, totalBs: 1350 },
    efectivo_bs: { count: 1, totalUsd: 20, totalBs: 900 },
  },
};

function assertMaxLineWidth48(text: string): void {
  for (const line of text.split('\n')) {
    expect(line.length).toBeLessThanOrEqual(48);
  }
}

describe('formatTicketText', () => {
  it('formats comanda within 48 columns with location, sequence, round, and notes', () => {
    const text = formatTicketText({
      type: 'comanda',
      restaurantName: 'Playa Brava Beach Club',
      comanda: sampleComanda,
    });

    assertMaxLineWidth48(text);
    expect(text).toContain('TOLDO 14');
    expect(text).toContain('#12');
    expect(text).toContain('Ronda 2');
    expect(text).toContain('>> Bien tostado sin ajo');
  });

  it('formats anulacion with prominent ANULACION header, item, and reason', () => {
    const text = formatTicketText({
      type: 'anulacion',
      restaurantName: 'Playa Brava Beach Club',
      locationLabel: 'Toldo 14',
      waiterName: 'Carlos',
      item: sampleComanda.items[0],
      reason: 'Producto agotado en cocina',
      timestampIso: '2026-11-25T15:05:00Z',
    });

    assertMaxLineWidth48(text);
    expect(text).toContain('*** ANULACION ***');
    expect(text).toContain('Producto agotado en cocina');
    expect(text).toContain('Pargo Frito');
  });

  it('formats precuenta excluding voided items and showing USD, Bs, rate, and non-fiscal notice', () => {
    const text = formatTicketText({
      type: 'precuenta',
      restaurantName: 'Playa Brava Beach Club',
      order: sampleOrder,
      exchangeRate: 45,
      timestampIso: '2026-11-25T15:30:00Z',
    });

    assertMaxLineWidth48(text);
    expect(text).toContain('Ceviche Mixto');
    expect(text).not.toContain('Langosta Anulada');
    // Subtotal $24.00 + IVA 16% ($3.84) = Total $27.84 / Bs 1252.80 at 45.00 Bs/$
    expect(text).toContain('Subtotal');
    expect(text).toContain('24.00');
    expect(text).toContain('IVA (16%)');
    expect(text).toContain('3.84');
    expect(text).toContain('27.84');
    expect(text).toContain('1252.80');
    expect(text).toContain('45.00');
    expect(text).toContain('DOCUMENTO NO FISCAL');
  });

  it('formats cierre with shift totals and all 4 payment methods within 48 columns', () => {
    const text = formatTicketText({
      type: 'cierre',
      restaurantName: 'Playa Brava Beach Club',
      shift: sampleShift,
      closedByName: 'Ana Administración',
      timestampIso: '2026-11-25T20:00:00Z',
    });

    assertMaxLineWidth48(text);
    expect(text).toContain('Zelle');
    expect(text).toContain('Efectivo USD');
    expect(text).toContain('Debito');
    expect(text).toContain('Efectivo Bs');
    expect(text).toContain('150.00');
  });

  it('formats prueba ticket with IP and port within 48 columns', () => {
    const text = formatTicketText({
      type: 'prueba',
      restaurantName: 'Playa Brava Beach Club',
      ip: '192.168.1.100',
      port: 9100,
      timestampIso: '2026-11-25T10:00:00Z',
    });

    assertMaxLineWidth48(text);
    expect(text).toContain('192.168.1.100:9100');
  });
});

describe('buildEscPosBytes', () => {
  it('starts with ESC @ (0x1B 0x40), includes bold/double-height header commands, transliterates Spanish accents, and ends with GS V 66 0 (0x1D 0x56 0x42 0x00)', () => {
    const payload: TicketPayload = {
      type: 'comanda',
      restaurantName: 'Bahía Ñandú Café',
      comanda: sampleComanda,
    };

    const bytes = buildEscPosBytes(payload);
    expect(bytes).toBeInstanceOf(Uint8Array);

    // Starts with ESC @ (0x1B 0x40)
    expect(Array.from(bytes.slice(0, 2))).toEqual([0x1b, 0x40]);

    // Ends with 4 feeds + GS V 66 0 (0x1D 0x56 0x42 0x00)
    expect(Array.from(bytes.slice(-8))).toEqual([
      0x0a, 0x0a, 0x0a, 0x0a, 0x1d, 0x56, 0x42, 0x00,
    ]);

    // Contains ESC ! 0x30 (header emphasis) and ESC ! 0x00 (reset)
    const byteArr = Array.from(bytes);
    const hasHeaderStyle = byteArr.some(
      (_, idx) => byteArr[idx] === 0x1b && byteArr[idx + 1] === 0x21 && byteArr[idx + 2] === 0x30,
    );
    const hasBodyReset = byteArr.some(
      (_, idx) => byteArr[idx] === 0x1b && byteArr[idx + 1] === 0x21 && byteArr[idx + 2] === 0x00,
    );
    expect(hasHeaderStyle).toBe(true);
    expect(hasBodyReset).toBe(true);

    // Transliterates accents cleanly to ASCII-safe text
    const decoded = new TextDecoder('ascii').decode(bytes);
    expect(decoded).toContain('BAHIA NANDU CAFE');
    expect(decoded).toContain('Carlos Perez');
  });
});
