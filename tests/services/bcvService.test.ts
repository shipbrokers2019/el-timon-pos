import { describe, expect, it, vi } from 'vitest';
import { BCV_FALLBACK_URL, BCV_PRIMARY_URL, fetchBcvRate } from '../../src/services/bcvService';

describe('bcvService.fetchBcvRate', () => {
  it('fetches official BCV rate from ve.dolarapi.com primary endpoint', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        fuente: 'oficial',
        nombre: 'Oficial',
        promedio: 64.3782,
        fechaActualizacion: '2026-11-25T12:00:00.000Z',
      }),
    }) as unknown as typeof fetch;

    const result = await fetchBcvRate(mockFetch);

    expect(mockFetch).toHaveBeenCalledWith(BCV_PRIMARY_URL, expect.any(Object));
    expect(result.rate).toBe(64.38);
    expect(result.source).toBe('BCV Oficial (DolarApi)');
    expect(result.officialUpdatedAt).toBe('2026-11-25T12:00:00.000Z');
  });

  it('falls back to open.er-api.com when primary endpoint fails', async () => {
    const mockFetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: 'success',
          time_last_update_utc: 'Wed, 25 Nov 2026 00:00:01 +0000',
          rates: { VES: 64.551 },
        }),
      }) as unknown as typeof fetch;

    const result = await fetchBcvRate(mockFetch);

    expect(mockFetch).toHaveBeenNthCalledWith(1, BCV_PRIMARY_URL, expect.any(Object));
    expect(mockFetch).toHaveBeenNthCalledWith(2, BCV_FALLBACK_URL, expect.any(Object));
    expect(result.rate).toBe(64.55);
    expect(result.source).toBe('Referencia VES (ER-API)');
  });

  it('throws a clear Spanish error when both endpoints fail or return invalid rates', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
    }) as unknown as typeof fetch;

    await expect(fetchBcvRate(mockFetch)).rejects.toThrow(/No se pudo consultar la tasa BCV/i);
  });
});
