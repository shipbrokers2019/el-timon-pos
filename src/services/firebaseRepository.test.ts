import { beforeEach, describe, expect, it } from 'vitest';
import {
  mergeLocationsWithBaseline,
  stripUndefined,
} from './firebaseRepository';
import { LocalPosRepository, POS_STORAGE_KEY } from './posRepository';
import { createInitialPosState } from './seedData';

describe('firebaseRepository resilience helpers', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('strips nested undefined keys while preserving null and arrays', () => {
    const cleaned = stripUndefined({
      id: 'ord-1',
      activeOrderId: null,
      closedAt: undefined,
      nested: { a: 1, b: undefined },
      items: [{ id: 'i1', voidReason: undefined, notes: '' }],
    });

    expect(cleaned).toEqual({
      id: 'ord-1',
      activeOrderId: null,
      nested: { a: 1 },
      items: [{ id: 'i1', notes: '' }],
    });
    expect('closedAt' in cleaned).toBe(false);
  });

  it('keeps all 10 mesas and 18 toldos when Firestore returns a partial snapshot', () => {
    const partialRemote = [
      {
        id: 'mesa-1',
        zone: 'mesas' as const,
        number: 1,
        label: 'Mesa 1',
        status: 'ocupada' as const,
        activeOrderId: 'ord-1',
        pendingSync: false,
        kitchenReadyAlert: false,
      },
    ];
    const current = createInitialPosState().locations.map((loc) =>
      loc.id === 'toldo-3'
        ? { ...loc, status: 'ocupada' as const, activeOrderId: 'ord-offline', pendingSync: true }
        : loc,
    );

    const merged = mergeLocationsWithBaseline(partialRemote, current);

    expect(merged).toHaveLength(28);
    expect(merged.filter((l) => l.zone === 'mesas')).toHaveLength(10);
    expect(merged.filter((l) => l.zone === 'toldos')).toHaveLength(18);
    expect(merged.find((l) => l.id === 'mesa-1')?.status).toBe('ocupada');
    expect(merged.find((l) => l.id === 'toldo-3')?.pendingSync).toBe(true);
  });

  it('auto-heals truncated localStorage locations back to all 28 mesas and toldos', () => {
    const truncated = createInitialPosState();
    truncated.locations = [
      {
        id: 'mesa-1',
        zone: 'mesas',
        number: 1,
        label: 'Mesa 1',
        status: 'ocupada',
        activeOrderId: 'ord-1',
      },
    ];
    localStorage.setItem(POS_STORAGE_KEY, JSON.stringify(truncated));

    const repo = new LocalPosRepository();
    const state = repo.getState();

    expect(state.locations).toHaveLength(28);
    expect(state.locations.filter((l) => l.zone === 'mesas')).toHaveLength(10);
    expect(state.locations.filter((l) => l.zone === 'toldos')).toHaveLength(18);
    expect(state.locations.find((l) => l.id === 'mesa-1')?.status).toBe('ocupada');
  });
});
