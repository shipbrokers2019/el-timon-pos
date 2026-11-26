import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearTabStation,
  readActiveStationKey,
  rememberStationKey,
  stationAppName,
  stationKeyFromEmail,
} from '../../src/services/firebaseRepository';

/**
 * Regression guard: Caja, Mesonero and Cocina must run in SEPARATE Firebase app slots
 * so activating one station in a browser tab can never sign out or hijack another tab.
 */
describe('Station isolation per Firebase app slot', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('maps each station email to its own slot', () => {
    expect(stationKeyFromEmail('caja@eltimon.pos')).toBe('caja');
    expect(stationKeyFromEmail('admin@eltimon.pos')).toBe('caja');
    expect(stationKeyFromEmail(' Mesonero@ElTimon.pos ')).toBe('mesonero');
    expect(stationKeyFromEmail('cocina@eltimon.pos')).toBe('cocina');
    expect(stationKeyFromEmail('otro@eltimon.pos')).toBeNull();
    expect(stationKeyFromEmail(null)).toBeNull();
  });

  it('gives Caja, Mesonero and Cocina three distinct Firebase app names', () => {
    const names = new Set([
      stationAppName('caja'),
      stationAppName('mesonero'),
      stationAppName('cocina'),
    ]);
    expect(names.size).toBe(3);
    expect(names.has('[DEFAULT]')).toBe(false);
  });

  it('prefers the station chosen in this tab over the last station used on the device', () => {
    expect(readActiveStationKey()).toBeNull();

    rememberStationKey('cocina');
    expect(readActiveStationKey()).toBe('cocina');

    // Another tab activates Mesonero: device default changes, but THIS tab keeps Cocina
    localStorage.setItem('eltimon_last_station_v2', 'mesonero');
    expect(readActiveStationKey()).toBe('cocina');

    // A brand-new tab (empty sessionStorage) falls back to the last station on the device
    sessionStorage.clear();
    expect(readActiveStationKey()).toBe('mesonero');
  });

  it('switching station in one tab detaches only that tab', () => {
    rememberStationKey('caja');
    clearTabStation();
    expect(readActiveStationKey()).toBeNull();
    // The device-level last station is untouched, so other tabs/devices are unaffected
    expect(localStorage.getItem('eltimon_last_station_v2')).toBe('caja');
  });
});
