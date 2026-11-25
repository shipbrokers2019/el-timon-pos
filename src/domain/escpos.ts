import type { Comanda, Order, OrderItem, PaymentMethod, Shift } from '../types/pos';
import { calculateOrderBreakdown, roundMoney } from './currency';

export type TicketPayload =
  | { type: 'comanda'; restaurantName: string; comanda: Comanda }
  | {
      type: 'anulacion';
      restaurantName: string;
      locationLabel: string;
      waiterName: string;
      item: OrderItem;
      reason: string;
      timestampIso: string;
    }
  | {
      type: 'precuenta';
      restaurantName: string;
      order: Order;
      exchangeRate: number;
      timestampIso: string;
    }
  | {
      type: 'cierre';
      restaurantName: string;
      shift: Shift;
      closedByName: string;
      timestampIso: string;
    }
  | {
      type: 'prueba';
      restaurantName: string;
      ip: string;
      port: number;
      timestampIso: string;
    };

const TICKET_WIDTH = 48;
const DIVIDER_LINE = '-'.repeat(TICKET_WIDTH);
const DOUBLE_DIVIDER_LINE = '='.repeat(TICKET_WIDTH);

const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  zelle: 'Zelle',
  efectivo_usd: 'Efectivo USD',
  debito_punto: 'Debito / Punto',
  efectivo_bs: 'Efectivo Bs',
};

const LATIN_TRANSLITERATIONS: Record<string, string> = {
  á: 'a',
  à: 'a',
  ä: 'a',
  â: 'a',
  ã: 'a',
  é: 'e',
  è: 'e',
  ë: 'e',
  ê: 'e',
  í: 'i',
  ì: 'i',
  ï: 'i',
  î: 'i',
  ó: 'o',
  ò: 'o',
  ö: 'o',
  ô: 'o',
  õ: 'o',
  ú: 'u',
  ù: 'u',
  ü: 'u',
  û: 'u',
  ñ: 'n',
  ç: 'c',
  Á: 'A',
  À: 'A',
  Ä: 'A',
  Â: 'A',
  Ã: 'A',
  É: 'E',
  È: 'E',
  Ë: 'E',
  Ê: 'E',
  Í: 'I',
  Ì: 'I',
  Ï: 'I',
  Î: 'I',
  Ó: 'O',
  Ò: 'O',
  Ö: 'O',
  Ô: 'O',
  Õ: 'O',
  Ú: 'U',
  Ù: 'U',
  Ü: 'U',
  Û: 'U',
  Ñ: 'N',
  Ç: 'C',
  '¡': '!',
  '¿': '?',
};

function wrapLine(text: string, width = TICKET_WIDTH): string[] {
  const normalized = text.replace(/\r?\n/g, ' ').trim();
  if (normalized.length === 0) {
    return [''];
  }
  if (normalized.length <= width) {
    return [normalized];
  }

  const words = normalized.split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (word.length > width) {
      if (current.length > 0) {
        lines.push(current);
        current = '';
      }
      for (let i = 0; i < word.length; i += width) {
        lines.push(word.slice(i, i + width));
      }
      continue;
    }

    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (candidate.length <= width) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }

  if (current.length > 0) {
    lines.push(current);
  }

  return lines;
}

function centerText(text: string, width = TICKET_WIDTH): string[] {
  return wrapLine(text, width).map((line) => {
    const padLeft = Math.floor((width - line.length) / 2);
    return `${' '.repeat(Math.max(0, padLeft))}${line}`;
  });
}

function formatColumns(left: string, right: string, width = TICKET_WIDTH): string {
  const rightTrimmed = right.slice(0, width);
  const maxLeft = Math.max(0, width - rightTrimmed.length - 1);
  const leftTrimmed = left.length > maxLeft ? left.slice(0, maxLeft) : left;
  const spaces = Math.max(1, width - leftTrimmed.length - rightTrimmed.length);
  return `${leftTrimmed}${' '.repeat(spaces)}${rightTrimmed}`;
}

function formatTimestamp(iso: string): string {
  return iso.replace('T', ' ').slice(0, 19);
}

interface TicketSections {
  headerLines: string[];
  bodyLines: string[];
}

function buildTicketSections(payload: TicketPayload): TicketSections {
  switch (payload.type) {
    case 'comanda': {
      const { comanda, restaurantName } = payload;
      const headerLines = [
        ...centerText(restaurantName.toUpperCase()),
        ...centerText(comanda.locationLabel.toUpperCase()),
      ];

      const bodyLines: string[] = [
        DOUBLE_DIVIDER_LINE,
        formatColumns(`Comanda #${comanda.sequenceNumber}`, `Ronda ${comanda.roundNumber}`),
        ...wrapLine(`Mesonero: ${comanda.waiterName}`),
        ...wrapLine(`Fecha: ${formatTimestamp(comanda.createdAt)}`),
        DIVIDER_LINE,
      ];

      const activeItems = comanda.items.filter((item) => item.voided !== true);
      for (const item of activeItems) {
        bodyLines.push(...wrapLine(`${item.quantity}x ${item.name}`));
        if (item.notes.trim().length > 0) {
          bodyLines.push(...wrapLine(`  >> ${item.notes.trim()}`));
        }
      }

      bodyLines.push(DOUBLE_DIVIDER_LINE);
      return { headerLines, bodyLines };
    }

    case 'anulacion': {
      const headerLines = [
        ...centerText(payload.restaurantName.toUpperCase()),
        ...centerText('*** ANULACION ***'),
      ];

      const bodyLines: string[] = [
        DOUBLE_DIVIDER_LINE,
        ...wrapLine(`Ubicacion: ${payload.locationLabel.toUpperCase()}`),
        ...wrapLine(`Mesonero: ${payload.waiterName}`),
        ...wrapLine(`Fecha: ${formatTimestamp(payload.timestampIso)}`),
        DIVIDER_LINE,
        ...wrapLine(`ITEM: ${payload.item.quantity}x ${payload.item.name}`),
        ...wrapLine(`Motivo: ${payload.reason}`),
        DOUBLE_DIVIDER_LINE,
      ];

      return { headerLines, bodyLines };
    }

    case 'precuenta': {
      const { order, exchangeRate, restaurantName, timestampIso } = payload;
      const activeItems = order.items.filter((item) => item.voided !== true);
      const breakdown = calculateOrderBreakdown(activeItems, exchangeRate);
      const ivaPct = Math.round(breakdown.ivaRate * 100);

      const headerLines = [
        ...centerText(restaurantName.toUpperCase()),
        ...centerText('PRECUENTA'),
      ];

      const bodyLines: string[] = [
        DOUBLE_DIVIDER_LINE,
        formatColumns(order.locationLabel.toUpperCase(), formatTimestamp(timestampIso)),
        ...wrapLine(`Mesonero: ${order.waiterName}`),
        DIVIDER_LINE,
      ];

      for (const item of activeItems) {
        const lineTotalUsd = roundMoney(item.quantity * item.unitPriceUsd).toFixed(2);
        bodyLines.push(formatColumns(`${item.quantity}x ${item.name}`, `$${lineTotalUsd}`));
      }

      bodyLines.push(
        DIVIDER_LINE,
        formatColumns('Subtotal Productos:', `$${breakdown.subtotalUsd.toFixed(2)}`),
        formatColumns(`IVA (${ivaPct}%):`, `$${breakdown.ivaUsd.toFixed(2)}`),
        DIVIDER_LINE,
        formatColumns('TOTAL A COBRAR USD:', `$${breakdown.totalUsd.toFixed(2)}`),
        formatColumns('TOTAL A COBRAR Bs:', `Bs ${breakdown.totalBs.toFixed(2)}`),
        formatColumns('Tasa BCV:', `${exchangeRate.toFixed(2)} Bs/$`),
        DOUBLE_DIVIDER_LINE,
        ...centerText('DOCUMENTO NO FISCAL'),
      );

      return { headerLines, bodyLines };
    }

    case 'cierre': {
      const { shift, closedByName, restaurantName, timestampIso } = payload;
      const headerLines = [
        ...centerText(restaurantName.toUpperCase()),
        ...centerText('CIERRE DE TURNO'),
      ];

      const bodyLines: string[] = [
        DOUBLE_DIVIDER_LINE,
        ...wrapLine(`Turno: ${shift.id}`),
        ...wrapLine(`Cerrado por: ${closedByName}`),
        ...wrapLine(`Fecha: ${formatTimestamp(timestampIso)}`),
        DIVIDER_LINE,
        formatColumns('Ordenes cerradas:', String(shift.ordersCount)),
        formatColumns('Total USD:', `$${roundMoney(shift.totalSalesUsd).toFixed(2)}`),
        formatColumns('Total Bs:', `Bs ${roundMoney(shift.totalSalesBs).toFixed(2)}`),
        DIVIDER_LINE,
        ...wrapLine('DESGLOSE POR METODO DE PAGO:'),
      ];

      const methods: PaymentMethod[] = [
        'zelle',
        'efectivo_usd',
        'debito_punto',
        'efectivo_bs',
      ];
      for (const method of methods) {
        const bucket = shift.totalsByMethod[method];
        const label = `${PAYMENT_METHOD_LABELS[method]} (${bucket.count})`;
        const amounts = `$${roundMoney(bucket.totalUsd).toFixed(2)} / Bs ${roundMoney(bucket.totalBs).toFixed(2)}`;
        bodyLines.push(formatColumns(label, amounts));
      }

      bodyLines.push(DOUBLE_DIVIDER_LINE);
      return { headerLines, bodyLines };
    }

    case 'prueba': {
      const headerLines = [
        ...centerText(payload.restaurantName.toUpperCase()),
        ...centerText('PRUEBA DE IMPRESORA 80MM'),
      ];

      const bodyLines: string[] = [
        DOUBLE_DIVIDER_LINE,
        ...wrapLine(`Destino: ${payload.ip}:${payload.port}`),
        ...wrapLine(`Fecha: ${formatTimestamp(payload.timestampIso)}`),
        DIVIDER_LINE,
        ...centerText('48 COLUMNAS - CONEXION OK'),
        DOUBLE_DIVIDER_LINE,
      ];

      return { headerLines, bodyLines };
    }
  }
}

export function toAsciiSafe(text: string): string {
  const normalized = text.normalize('NFC');
  let out = '';
  for (const ch of normalized) {
    if (ch in LATIN_TRANSLITERATIONS) {
      out += LATIN_TRANSLITERATIONS[ch];
    } else {
      const code = ch.charCodeAt(0);
      if (code === 0x0a || (code >= 0x20 && code <= 0x7e)) {
        out += ch;
      } else {
        out += '?';
      }
    }
  }
  return out;
}

function encodeAsciiBytes(text: string): number[] {
  const safe = toAsciiSafe(text);
  const bytes: number[] = [];
  for (let i = 0; i < safe.length; i += 1) {
    bytes.push(safe.charCodeAt(i));
  }
  return bytes;
}

/**
 * Formats any supported POS ticket into a 48-column plain-text preview.
 */
export function formatTicketText(payload: TicketPayload): string {
  const { headerLines, bodyLines } = buildTicketSections(payload);
  return [...headerLines, ...bodyLines].join('\n');
}

/**
 * Builds an 80mm ESC/POS binary command buffer with ASCII-safe transliteration and partial cut.
 */
export function buildEscPosBytes(payload: TicketPayload): Uint8Array {
  const { headerLines, bodyLines } = buildTicketSections(payload);

  const bytes: number[] = [
    0x1b, 0x40, // ESC @ — Initialize printer
    0x1b, 0x21, 0x30, // ESC ! 0x30 — Double-height & bold/double-width header
    ...encodeAsciiBytes(`${headerLines.join('\n')}\n`),
    0x1b, 0x21, 0x00, // ESC ! 0x00 — Reset text style for body
    ...encodeAsciiBytes(`${bodyLines.join('\n')}\n`),
    0x0a, 0x0a, 0x0a, 0x0a, // Feed 4 lines before cut
    0x1d, 0x56, 0x42, 0x00, // GS V 66 0 — Partial paper cut
  ];

  return new Uint8Array(bytes);
}
