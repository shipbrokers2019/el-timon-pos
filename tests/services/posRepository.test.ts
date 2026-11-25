import { beforeEach, describe, expect, it } from 'vitest';
import { createPaymentEntry } from '../../src/domain/currency';
import {
  LocalPosRepository,
  POS_STORAGE_KEY,
} from '../../src/services/posRepository';
import { createInitialPosState } from '../../src/services/seedData';

describe('seedData & LocalPosRepository', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('initializes exact 10 mesas and 18 toldos (28 libre locations), 4 users, 1 open shift, and settings', () => {
    const state = createInitialPosState();

    const mesas = state.locations.filter((loc) => loc.zone === 'mesas');
    const toldos = state.locations.filter((loc) => loc.zone === 'toldos');

    expect(mesas).toHaveLength(10);
    expect(toldos).toHaveLength(18);
    expect(state.locations).toHaveLength(28);
    expect(mesas[0]).toMatchObject({ id: 'mesa-1', label: 'Mesa 1', status: 'libre' });
    expect(mesas[9]).toMatchObject({ id: 'mesa-10', label: 'Mesa 10', status: 'libre' });
    expect(toldos[0]).toMatchObject({ id: 'toldo-1', label: 'Toldo 1', status: 'libre' });
    expect(toldos[17]).toMatchObject({ id: 'toldo-18', label: 'Toldo 18', status: 'libre' });

    expect(state.users.map((u) => u.pin)).toEqual(['1111', '1234', '2222', '0000']);
    expect(state.shifts).toHaveLength(1);
    expect(state.shifts[0].status).toBe('abierto');
    expect(state.settings.exchangeRate).toBe(52.5);
    expect(state.settings.printer).toMatchObject({
      restaurantName: 'Brisa Marina Beach Club',
      ip: '192.168.1.200',
      port: 9100,
      autoPrintFromKitchen: true,
      lanFallbackEnabled: true,
    });
  });

  it('queues offline comanda with pendingSync and syncOfflineQueue clears pendingSync without double-deducting ingredients', async () => {
    const repo = new LocalPosRepository();
    const carneBefore = repo
      .getState()
      .ingredients.find((i) => i.id === 'ing-carne-molida')!.stock;

    const { order, comanda, printJob } = await repo.submitComanda({
      comandaId: 'cmd-offline-1',
      locationId: 'toldo-5',
      waiterId: 'user-carlos',
      waiterName: 'Carlos (Mesonero)',
      items: [{ menuItemId: 'menu-hamburguesa-playera', quantity: 2, notes: 'Sin salsa' }],
      isOffline: true,
    });

    expect(order.locationId).toBe('toldo-5');
    expect(comanda).not.toBeNull();
    expect(comanda?.pendingSync).toBe(true);
    expect(printJob?.type).toBe('comanda');

    const locationDuringOffline = repo
      .getState()
      .locations.find((l) => l.id === 'toldo-5')!;
    expect(locationDuringOffline.status).toBe('ocupada');
    expect(locationDuringOffline.pendingSync).toBe(true);
    expect(repo.getPendingSyncCount()).toBe(1);

    const carneAfterSubmit = repo
      .getState()
      .ingredients.find((i) => i.id === 'ing-carne-molida')!.stock;
    expect(carneAfterSubmit).toBe(carneBefore - 0.4);
    const movementsCountBeforeSync = repo.getState().movements.length;

    await repo.syncOfflineQueue();

    const stateAfterSync = repo.getState();
    expect(stateAfterSync.locations.find((l) => l.id === 'toldo-5')?.pendingSync).toBe(false);
    expect(stateAfterSync.comandas.find((c) => c.id === 'cmd-offline-1')?.pendingSync).toBe(
      false,
    );
    expect(repo.getPendingSyncCount()).toBe(0);
    expect(
      stateAfterSync.ingredients.find((i) => i.id === 'ing-carne-molida')!.stock,
    ).toBe(carneAfterSubmit);
    expect(stateAfterSync.movements).toHaveLength(movementsCountBeforeSync);
    expect(localStorage.getItem(POS_STORAGE_KEY)).toBeTruthy();
  });

  it('handles rounds with ONLY sendsToKitchen: false items by updating order and deducting stock WITHOUT creating any Cocina comanda or print job', async () => {
    const repo = new LocalPosRepository();
    const beerBefore = repo
      .getState()
      .ingredients.find((i) => i.id === 'ing-cerveza-polar')!.stock;

    const result = await repo.submitComanda({
      locationId: 'toldo-1',
      waiterId: 'user-maria',
      waiterName: 'María (Mesonera)',
      items: [
        { menuItemId: 'menu-cerveza-polar', quantity: 4, notes: 'Bien frías' },
        { menuItemId: 'menu-alquiler-toldo', quantity: 1, notes: '' },
      ],
    });

    expect(result.comanda).toBeNull();
    expect(result.printJob).toBeNull();
    expect(result.order.items).toHaveLength(2);
    expect(result.order.totalUsd).toBe(25);

    const state = repo.getState();
    expect(state.comandas).toHaveLength(0);
    expect(state.printJobs).toHaveLength(0);
    expect(state.locations.find((l) => l.id === 'toldo-1')?.status).toBe('ocupada');
    expect(state.ingredients.find((i) => i.id === 'ing-cerveza-polar')?.stock).toBe(
      beerBefore - 4,
    );
  });

  it('voiding a kitchen item creates an isVoidAlert Cocina comanda + anulacion print job and honors restock vs merma', async () => {
    const repo = new LocalPosRepository();

    const { order } = await repo.submitComanda({
      locationId: 'mesa-2',
      waiterId: 'user-carlos',
      waiterName: 'Carlos (Mesonero)',
      items: [
        { menuItemId: 'menu-hamburguesa-playera', quantity: 2, notes: '' },
        { menuItemId: 'menu-pescado-frito', quantity: 1, notes: '' },
      ],
    });

    const burgerItem = order.items.find(
      (i) => i.menuItemId === 'menu-hamburguesa-playera',
    )!;
    const fishItem = order.items.find((i) => i.menuItemId === 'menu-pescado-frito')!;
    const carneAfterOrder = repo
      .getState()
      .ingredients.find((i) => i.id === 'ing-carne-molida')!.stock;
    const fishAfterOrder = repo
      .getState()
      .ingredients.find((i) => i.id === 'ing-pescado-pargo')!.stock;

    // 1. Void burger with 'restock' -> restores 0.4 kg carne
    await repo.voidOrderItem(
      order.id,
      burgerItem.id,
      'restock',
      'Cliente cambió de orden antes de cocinar',
      { id: 'user-admin', name: 'Administrador / Caja' },
    );

    const afterRestock = repo.getState();
    expect(afterRestock.ingredients.find((i) => i.id === 'ing-carne-molida')!.stock).toBe(
      carneAfterOrder + 0.4,
    );
    const updatedOrder1 = afterRestock.orders.find((o) => o.id === order.id)!;
    expect(updatedOrder1.totalUsd).toBe(14);

    const voidComandas = afterRestock.comandas.filter((c) => c.isVoidAlert === true);
    expect(voidComandas).toHaveLength(1);
    expect(voidComandas[0].voidReason).toContain('Cliente cambió de orden');

    const anulacionJobs = afterRestock.printJobs.filter((j) => j.type === 'anulacion');
    expect(anulacionJobs).toHaveLength(1);

    // 2. Void fish with 'merma' -> keeps stock deducted and logs 0-delta merma
    await repo.voidOrderItem(
      order.id,
      fishItem.id,
      'merma',
      'Se cayó en cocina',
      { id: 'user-admin', name: 'Administrador / Caja' },
    );

    const afterMerma = repo.getState();
    expect(afterMerma.ingredients.find((i) => i.id === 'ing-pescado-pargo')!.stock).toBe(
      fishAfterOrder,
    );
    expect(afterMerma.movements.some((m) => m.type === 'merma' && m.delta === 0)).toBe(true);
    expect(afterMerma.orders.find((o) => o.id === order.id)!.totalUsd).toBe(0);
    expect(afterMerma.comandas.filter((c) => c.isVoidAlert === true)).toHaveLength(2);
    expect(afterMerma.printJobs.filter((j) => j.type === 'anulacion')).toHaveLength(2);
  });

  it('settles an order, freezes exchange rate, frees location, and keeps closed order + cash close totals accurate after rate changes', async () => {
    const repo = new LocalPosRepository();

    const { order, comanda } = await repo.submitComanda({
      locationId: 'mesa-4',
      waiterId: 'user-carlos',
      waiterName: 'Carlos (Mesonero)',
      items: [{ menuItemId: 'menu-ceviche-mixto', quantity: 2, notes: '' }],
    });

    await repo.updateComandaStatus(comanda!.id, 'en_preparacion');
    await repo.updateComandaStatus(comanda!.id, 'lista');
    expect(repo.getState().locations.find((l) => l.id === 'mesa-4')?.kitchenReadyAlert).toBe(
      true,
    );

    await repo.acknowledgeKitchenReady('mesa-4');
    expect(repo.getState().locations.find((l) => l.id === 'mesa-4')?.kitchenReadyAlert).toBe(
      false,
    );

    await repo.requestCheck('mesa-4');
    expect(repo.getState().locations.find((l) => l.id === 'mesa-4')?.status).toBe(
      'por_cobrar',
    );

    const rateAtSale = 52.5;
    const payments = [
      createPaymentEntry({
        id: 'pay-1',
        method: 'zelle',
        amountNative: 10,
        exchangeRate: rateAtSale,
        reference: 'Z-991',
        paidAt: '2026-11-25T15:00:00Z',
      }),
      createPaymentEntry({
        id: 'pay-2',
        method: 'efectivo_bs',
        amountNative: 630, // 630 / 52.5 = $12.00
        exchangeRate: rateAtSale,
        paidAt: '2026-11-25T15:00:00Z',
      }),
    ];

    const settled = await repo.settleOrder(order.id, payments);
    expect(settled.status).toBe('cerrada');
    expect(settled.exchangeRate).toBe(52.5);
    expect(settled.totalUsd).toBe(22);
    expect(settled.totalBs).toBe(1155);

    const freedLocation = repo.getState().locations.find((l) => l.id === 'mesa-4')!;
    expect(freedLocation.status).toBe('libre');
    expect(freedLocation.activeOrderId).toBeNull();
    expect(freedLocation.kitchenReadyAlert).toBe(false);

    // Change exchange rate later to 65 Bs/USD — closed order and shift totals MUST stay frozen
    await repo.updateExchangeRate(65);
    const closedOrderAfterRateChange = repo
      .getState()
      .orders.find((o) => o.id === order.id)!;
    expect(closedOrderAfterRateChange.exchangeRate).toBe(52.5);
    expect(closedOrderAfterRateChange.totalBs).toBe(1155);

    const { shift, printJob } = await repo.closeShift('user-admin', 'Turno sin novedad');
    expect(shift.status).toBe('cerrado');
    expect(shift.ordersCount).toBe(1);
    expect(shift.totalSalesUsd).toBe(22);
    expect(shift.totalSalesBs).toBe(1155);
    expect(shift.totalsByMethod.zelle.totalUsd).toBe(10);
    expect(shift.totalsByMethod.efectivo_bs.totalBs).toBe(630);
    expect(printJob.type).toBe('cierre');
  });
});
