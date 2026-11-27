import { describe, expect, it } from 'vitest';
import { calculateOrderBreakdown } from '../../src/domain/currency';
import { reconcileOrdersInventoryDeductions } from '../../src/domain/recipes';
import { LocalPosRepository } from '../../src/services/posRepository';

describe('5-Table End-to-End Simulation (Round 1, Round 2, Dish Returns, Pre-factura & Settlement)', () => {
  it('processes 5 tables through Round 1, Round 2, restock & merma returns, inventory reconciliation, and full checkout', async () => {
    const repo = new LocalPosRepository();
    const initialIngredients = new Map(
      repo.getState().ingredients.map((i) => [i.id, i.stock]),
    );

    const waiterCarlos = { waiterId: 'user-carlos', waiterName: 'Carlos (Mesonero)' };
    const waiterMaria = { waiterId: 'user-maria', waiterName: 'María (Mesonera)' };
    const adminUser = { id: 'user-admin', name: 'Administrador / Caja' };

    // ------------------------------------------------------------------
    // 1. ROUND 1 across 5 tables
    // ------------------------------------------------------------------
    const r1m1 = await repo.submitComanda({
      locationId: 'mesa-1',
      ...waiterCarlos,
      items: [
        { menuItemId: 'menu-pescado-frito', quantity: 2, notes: 'Bien crujiente' },
        { menuItemId: 'menu-cerveza-polar', quantity: 2, notes: 'Bien frías' },
      ],
    });
    const r1m2 = await repo.submitComanda({
      locationId: 'mesa-2',
      ...waiterCarlos,
      items: [
        { menuItemId: 'menu-hamburguesa-playera', quantity: 2, notes: 'Sin cebolla' },
        { menuItemId: 'menu-tostones-queso', quantity: 1, notes: '' },
      ],
    });
    const r1m3 = await repo.submitComanda({
      locationId: 'mesa-3',
      ...waiterMaria,
      items: [
        { menuItemId: 'menu-ceviche-mixto', quantity: 1, notes: 'Poco picante' },
        { menuItemId: 'menu-agua-mineral', quantity: 2, notes: '' },
      ],
    });
    const r1m4 = await repo.submitComanda({
      locationId: 'mesa-4',
      ...waiterMaria,
      items: [
        { menuItemId: 'menu-tostones-queso', quantity: 2, notes: '' },
        { menuItemId: 'menu-pescado-frito', quantity: 1, notes: '' },
      ],
    });
    const r1m5 = await repo.submitComanda({
      locationId: 'mesa-5',
      ...waiterCarlos,
      items: [
        { menuItemId: 'menu-hamburguesa-playera', quantity: 1, notes: '' },
        { menuItemId: 'menu-ceviche-mixto', quantity: 1, notes: '' },
      ],
    });

    const r1Comandas = [r1m1, r1m2, r1m3, r1m4, r1m5].map((r) => r.comanda!);
    expect(r1Comandas.every((c) => c !== null && c.status === 'pendiente')).toBe(true);

    // All 5 tables must be ocupada
    for (let n = 1; n <= 5; n += 1) {
      const loc = repo.getState().locations.find((l) => l.id === `mesa-${n}`);
      expect(loc?.status).toBe('ocupada');
    }

    // Cocina prepares and marks all 5 Round-1 comandas as lista -> alerts Mesonero & Caja
    for (const cmd of r1Comandas) {
      await repo.updateComandaStatus(cmd.id, 'en_preparacion');
      await repo.updateComandaStatus(cmd.id, 'lista');
    }
    for (let n = 1; n <= 5; n += 1) {
      const loc = repo.getState().locations.find((l) => l.id === `mesa-${n}`);
      expect(loc?.kitchenReadyAlert).toBe(true);
      await repo.acknowledgeKitchenReady(`mesa-${n}`);
      expect(
        repo.getState().locations.find((l) => l.id === `mesa-${n}`)?.kitchenReadyAlert,
      ).toBe(false);
    }

    // ------------------------------------------------------------------
    // 2. ROUND 2 across all 5 tables (same open orders!)
    // ------------------------------------------------------------------
    const r2m1 = await repo.submitComanda({
      locationId: 'mesa-1',
      ...waiterCarlos,
      items: [{ menuItemId: 'menu-tostones-queso', quantity: 1, notes: 'Extra queso' }],
    });
    // Mesa 2 Round 2: drinks only -> must NOT create a Cocina comanda, MUST deduct beer stock
    const r2m2 = await repo.submitComanda({
      locationId: 'mesa-2',
      ...waiterCarlos,
      items: [{ menuItemId: 'menu-cerveza-polar', quantity: 2, notes: '' }],
    });
    const r2m3 = await repo.submitComanda({
      locationId: 'mesa-3',
      ...waiterMaria,
      items: [{ menuItemId: 'menu-pescado-frito', quantity: 1, notes: '' }],
    });
    const r2m4 = await repo.submitComanda({
      locationId: 'mesa-4',
      ...waiterMaria,
      items: [{ menuItemId: 'menu-hamburguesa-playera', quantity: 1, notes: '' }],
    });
    const r2m5 = await repo.submitComanda({
      locationId: 'mesa-5',
      ...waiterCarlos,
      items: [{ menuItemId: 'menu-agua-mineral', quantity: 1, notes: '' }],
    });

    // Still exactly 5 open orders (Round 2 appended to existing orders)
    expect(repo.getState().orders.filter((o) => o.status === 'abierta')).toHaveLength(5);
    expect(r2m1.comanda?.roundNumber).toBe(2);
    expect(r2m2.comanda).toBeNull(); // Drinks only -> no kitchen ticket
    expect(r2m3.comanda?.roundNumber).toBe(2);
    expect(r2m4.comanda?.roundNumber).toBe(2);
    expect(r2m5.comanda).toBeNull(); // Water only -> no kitchen ticket

    // Check stock BEFORE returns:
    // Pescado pargo: 2 (M1) + 1 (M4) + 1 (M3 R2) = 4 deducted
    // Carne molida (0.2 kg/burger): 2 (M2) + 1 (M5) + 1 (M4 R2) = 4 * 0.2 = 0.8 kg deducted
    // Cerveza Polar: 2 (M1) + 2 (M2 R2) = 4 deducted
    const stockBeforeReturn = new Map(
      repo.getState().ingredients.map((i) => [i.id, i.stock]),
    );
    expect(stockBeforeReturn.get('ing-pescado-pargo')).toBe(
      Number((initialIngredients.get('ing-pescado-pargo')! - 4).toFixed(3)),
    );
    expect(stockBeforeReturn.get('ing-carne-molida')).toBe(
      Number((initialIngredients.get('ing-carne-molida')! - 0.8).toFixed(3)),
    );
    expect(stockBeforeReturn.get('ing-cerveza-polar')).toBe(
      Number((initialIngredients.get('ing-cerveza-polar')! - 4).toFixed(3)),
    );

    // ------------------------------------------------------------------
    // 3. DISH RETURNS (1 restock on Mesa 1, 1 merma on Mesa 4)
    // ------------------------------------------------------------------
    const mesa1OrderBeforeVoid = repo.getState().orders.find((o) => o.id === r1m1.order.id)!;
    const tostonesItemM1 = mesa1OrderBeforeVoid.items.find(
      (i) => i.menuItemId === 'menu-tostones-queso',
    )!;
    const platanoBeforeRestock = repo
      .getState()
      .ingredients.find((i) => i.id === 'ing-platano-verde')!.stock;

    await repo.voidOrderItem(
      r1m1.order.id,
      tostonesItemM1.id,
      'restock',
      'Cliente cambió de opinión antes de preparar',
      adminUser,
    );

    // Restock must return plátano verde to inventory and log anulacion_devolucion
    const platanoAfterRestock = repo
      .getState()
      .ingredients.find((i) => i.id === 'ing-platano-verde')!.stock;
    expect(platanoAfterRestock).toBeGreaterThan(platanoBeforeRestock);
    expect(
      repo
        .getState()
        .movements.some(
          (m) => m.type === 'anulacion_devolucion' && m.referenceId === tostonesItemM1.id,
        ),
    ).toBe(true);

    // Mesa 4 returns Round-2 Hamburguesa Playera as MERMA (already cooked -> stock NOT restored)
    const mesa4OrderBeforeVoid = repo.getState().orders.find((o) => o.id === r1m4.order.id)!;
    const burgerItemM4 = mesa4OrderBeforeVoid.items.find(
      (i) => i.menuItemId === 'menu-hamburguesa-playera',
    )!;
    const carneBeforeMerma = repo
      .getState()
      .ingredients.find((i) => i.id === 'ing-carne-molida')!.stock;

    await repo.voidOrderItem(
      r1m4.order.id,
      burgerItemM4.id,
      'merma',
      'Plato devuelto de mesa por cocción',
      adminUser,
    );

    const carneAfterMerma = repo
      .getState()
      .ingredients.find((i) => i.id === 'ing-carne-molida')!.stock;
    expect(carneAfterMerma).toBe(carneBeforeMerma); // Stock unchanged on merma
    expect(
      repo
        .getState()
        .movements.some(
          (m) => m.type === 'merma' && m.delta === 0 && m.referenceId === burgerItemM4.id,
        ),
    ).toBe(true);

    // Both returns generated ANULACIÓN alert cards for Cocina
    const voidAlerts = repo.getState().comandas.filter((c) => c.isVoidAlert === true);
    expect(voidAlerts).toHaveLength(2);

    // ------------------------------------------------------------------
    // 4. PRE-FACTURA on Mesa 1 & FULL SETTLEMENT of all 5 tables
    // ------------------------------------------------------------------
    await repo.createPreCuentaPrintJob(r1m1.order.id);
    expect(repo.getState().locations.find((l) => l.id === 'mesa-1')?.preFacturaReady).toBe(
      true,
    );

    const paymentMethods = [
      'zelle',
      'efectivo_usd',
      'debito_punto',
      'efectivo_bs',
      'zelle',
    ] as const;
    const orderIds = [r1m1.order.id, r1m2.order.id, r1m3.order.id, r1m4.order.id, r1m5.order.id];

    let expectedTotalSalesUsd = 0;
    for (let idx = 0; idx < orderIds.length; idx += 1) {
      const order = repo.getState().orders.find((o) => o.id === orderIds[idx])!;
      const breakdown = calculateOrderBreakdown(order.items, order.exchangeRate);
      expect(order.totalUsd).toBe(breakdown.totalUsd);
      expectedTotalSalesUsd = Number((expectedTotalSalesUsd + order.totalUsd).toFixed(2));

      const method = paymentMethods[idx];
      const isBs = method === 'debito_punto' || method === 'efectivo_bs';
      await repo.settleOrder(order.id, [
        {
          id: `pay-m${idx + 1}`,
          method,
          currency: isBs ? 'VES' : 'USD',
          amountNative: isBs ? order.totalBs : order.totalUsd,
          amountUsd: order.totalUsd,
          amountBs: order.totalBs,
          exchangeRate: order.exchangeRate,
          paidAt: new Date().toISOString(),
        },
      ]);
    }

    // All 5 tables must be libre with zero residual flags (no stale preFacturaReady or alerts)
    const finalState = repo.getState();
    for (let n = 1; n <= 5; n += 1) {
      const loc = finalState.locations.find((l) => l.id === `mesa-${n}`)!;
      expect(loc.status).toBe('libre');
      expect(loc.activeOrderId).toBeNull();
      expect(loc.preFacturaReady).toBe(false);
      expect(loc.kitchenReadyAlert).toBe(false);
    }

    // All comandas for the 5 settled orders auto-closed to lista
    expect(finalState.comandas.every((c) => c.status === 'lista')).toBe(true);

    // Shift totals match exact sum of all 5 settled orders
    const openShift = finalState.shifts.find((s) => s.status === 'abierto')!;
    expect(openShift.ordersCount).toBe(5);
    expect(openShift.totalSalesUsd).toBe(expectedTotalSalesUsd);

    // Reconciliation pass over all 5 settled orders is strictly idempotent (0 duplicate deductions)
    const reconcilePass = reconcileOrdersInventoryDeductions(
      finalState.orders,
      finalState.ingredients,
      finalState.menu,
      finalState.movements,
    );
    expect(reconcilePass.newMovements).toHaveLength(0);
  });
});
