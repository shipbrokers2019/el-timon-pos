import { roundMoney } from '../domain/currency';

export const BCV_PRIMARY_URL = 'https://ve.dolarapi.com/v1/dolares/oficial';
export const BCV_FALLBACK_URL = 'https://open.er-api.com/v6/latest/USD';

export interface BcvRateResult {
  rate: number;
  source: string;
  officialUpdatedAt?: string;
  fetchedAt: string;
}

const REQUEST_TIMEOUT_MS = 8000;

async function fetchJsonWithTimeout(
  url: string,
  fetchImpl: typeof fetch,
): Promise<Record<string, unknown>> {
  const controller =
    typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId =
    controller !== null
      ? globalThis.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
      : null;

  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller?.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return (await response.json()) as Record<string, unknown>;
  } finally {
    if (timeoutId !== null) {
      globalThis.clearTimeout(timeoutId);
    }
  }
}

/**
 * Fetches the official Banco Central de Venezuela (BCV) USD/VES exchange rate
 * from DolarApi Venezuela, falling back to ER-API if the primary endpoint is unreachable.
 */
export async function fetchBcvRate(
  fetchImpl: typeof fetch = fetch,
): Promise<BcvRateResult> {
  const fetchedAt = new Date().toISOString();

  // 1. Primary: DolarApi Venezuela (Official BCV rate, CORS-enabled)
  try {
    const data = await fetchJsonWithTimeout(BCV_PRIMARY_URL, fetchImpl);
    const rawRate =
      typeof data.promedio === 'number' && data.promedio > 0
        ? data.promedio
        : typeof data.venta === 'number' && data.venta > 0
          ? data.venta
          : NaN;

    if (Number.isFinite(rawRate) && rawRate > 0) {
      return {
        rate: roundMoney(rawRate),
        source: 'BCV Oficial (DolarApi)',
        officialUpdatedAt:
          typeof data.fechaActualizacion === 'string'
            ? data.fechaActualizacion
            : undefined,
        fetchedAt,
      };
    }
  } catch {
    // Fall through to secondary endpoint
  }

  // 2. Fallback: Open ER-API VES rate
  try {
    const data = await fetchJsonWithTimeout(BCV_FALLBACK_URL, fetchImpl);
    const rates = data.rates as Record<string, unknown> | undefined;
    const rawVes = rates && typeof rates.VES === 'number' ? rates.VES : NaN;

    if (Number.isFinite(rawVes) && rawVes > 0) {
      return {
        rate: roundMoney(rawVes),
        source: 'Referencia VES (ER-API)',
        officialUpdatedAt:
          typeof data.time_last_update_utc === 'string'
            ? data.time_last_update_utc
            : undefined,
        fetchedAt,
      };
    }
  } catch {
    // Fall through to unified error
  }

  throw new Error(
    'No se pudo consultar la tasa BCV en este momento; se mantiene la última tasa guardada.',
  );
}
