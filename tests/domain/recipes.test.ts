import { describe, expect, it } from 'vitest';
import {
  applyComandaRecipeDeductions,
  applyVoidInventoryResolution,
  convertUnitQuantity,
  getLowStockIngredients,
} from '../../src/domain/recipes';
import type {
  Comanda,
  Ingredient,
  MenuItem,
  OrderItem,
} from '../../src/types/pos';

function makeBaseIngredients(): Ingredient[] {
  return [
    {
      id: 'ing-carne',
      name: 'Carne de Hamburguesa',
      unit: 'kg',
      stock: 2,
      minStock: 0.5,
    },
    {
      id: 'ing-pan',
      name: 'Pan Brioche',
      unit: 'unidad',
      stock: 10,
      minStock: 4,
    },
    {
      id: 'ing-aceite',
      name: 'Aceite Vegetal',
      unit: 'L',
      stock: 1.5,
      minStock: 1,
    },
  ];
}

function makeBaseMenu(): MenuItem[] {
  return [
    {
      id: 'menu-burger',
      name: 'Hamburguesa Playera',
      category: 'Platos',
      priceUsd: 9.5,
      sendsToKitchen: true,
      outOfStock: false,
      recipe: [
        { ingredientId: 'ing-carne', quantity: 200, unit: 'g' },
        { ingredientId: 'ing-pan', quantity: 1, unit: 'unidad' },
      ],
    },
    {
      id: 'menu-papas',
      name: 'Papas Fritas',
      category: 'Entradas',
      priceUsd: 4.5,
      sendsToKitchen: true,
      outOfStock: false,
      recipe: [{ ingredientId: 'ing-aceite', quantity: 250, unit: 'ml' }],
    },
  ];
}

function makeComanda(overrides: Partial<Comanda> = {}): Comanda {
  return {
    id: 'cmd-101',
    sequenceNumber: 1,
    orderId: 'ord-1',
    locationId: 'toldo-14',
    locationLabel: 'Toldo 14',
    zone: 'toldos',
    roundNumber: 1,
    waiterId: 'u-waiter-1',
    waiterName: 'Carlos',
    items: [
      {
        id: 'oi-1',
        menuItemId: 'menu-burger',
        name: 'Hamburguesa Playera',
        quantity: 1,
        unitPriceUsd: 9.5,
        notes: 'Sin cebolla',
        sendsToKitchen: true,
        comandaId: 'cmd-101',
      },
    ],
    status: 'pendiente',
    printStatus: 'pending',
    createdAt: '2026-11-25T14:00:00Z',
    updatedAt: '2026-11-25T14:00:00Z',
    ...overrides,
  };
}

describe('convertUnitQuantity', () => {
  it('converts between g <-> kg, ml <-> L, and identical units', () => {
    expect(convertUnitQuantity(200, 'g', 'kg')).toBe(0.2);
    expect(convertUnitQuantity(1.5, 'kg', 'g')).toBe(1500);
    expect(convertUnitQuantity(250, 'ml', 'L')).toBe(0.25);
    expect(convertUnitQuantity(2, 'L', 'ml')).toBe(2000);
    expect(convertUnitQuantity(3, 'unidad', 'unidad')).toBe(3);
    expect(convertUnitQuantity(500, 'g', 'g')).toBe(500);
  });

  it('throws a descriptive error on incompatible units', () => {
    expect(() => convertUnitQuantity(100, 'g', 'ml')).toThrow(/incompatible|convert/i);
    expect(() => convertUnitQuantity(2, 'unidad', 'kg')).toThrow(/incompatible|convert/i);
  });
});

describe('applyComandaRecipeDeductions', () => {
  it('deducts hamburger 200g meat from 2kg -> 1.8kg and 1 bun from 10 -> 9', () => {
    const ingredients = makeBaseIngredients();
    const menu = makeBaseMenu();
    const comanda = makeComanda();

    const result = applyComandaRecipeDeductions(
      ingredients,
      menu,
      comanda,
      [],
      '2026-11-25T14:01:00Z',
    );

    const carne = result.ingredients.find((i) => i.id === 'ing-carne');
    const pan = result.ingredients.find((i) => i.id === 'ing-pan');
    expect(carne?.stock).toBe(1.8);
    expect(pan?.stock).toBe(9);

    // Does not mutate original array
    expect(ingredients[0].stock).toBe(2);
    expect(ingredients[1].stock).toBe(10);

    expect(result.newMovements).toHaveLength(2);
    expect(result.newMovements[0]).toMatchObject({
      ingredientId: 'ing-carne',
      type: 'venta',
      delta: -0.2,
      unit: 'kg',
      referenceId: 'cmd-101',
      reason: 'Venta Toldo 14 (1x Hamburguesa Playera)',
      createdAt: '2026-11-25T14:01:00Z',
    });
    expect(result.newMovements[1]).toMatchObject({
      ingredientId: 'ing-pan',
      type: 'venta',
      delta: -1,
      unit: 'unidad',
      referenceId: 'cmd-101',
      reason: 'Venta Toldo 14 (1x Hamburguesa Playera)',
    });
  });

  it('is idempotent when existingMovements already contains a venta for comanda.id', () => {
    const ingredients = makeBaseIngredients();
    const menu = makeBaseMenu();
    const comanda = makeComanda();

    const first = applyComandaRecipeDeductions(ingredients, menu, comanda, []);
    const second = applyComandaRecipeDeductions(
      first.ingredients,
      menu,
      comanda,
      first.newMovements,
    );

    expect(second.newMovements).toEqual([]);
    expect(second.ingredients).toEqual(first.ingredients);
  });

  it('ignores void alert comandas and voided items', () => {
    const ingredients = makeBaseIngredients();
    const menu = makeBaseMenu();

    const voidAlertComanda = makeComanda({ isVoidAlert: true });
    const resAlert = applyComandaRecipeDeductions(ingredients, menu, voidAlertComanda, []);
    expect(resAlert.newMovements).toEqual([]);
    expect(resAlert.ingredients).toEqual(ingredients);

    const partialVoidComanda = makeComanda({
      items: [
        {
          id: 'oi-voided',
          menuItemId: 'menu-burger',
          name: 'Hamburguesa Playera',
          quantity: 2,
          unitPriceUsd: 9.5,
          notes: '',
          sendsToKitchen: true,
          comandaId: 'cmd-101',
          voided: true,
        },
        {
          id: 'oi-active',
          menuItemId: 'menu-papas',
          name: 'Papas Fritas',
          quantity: 2,
          unitPriceUsd: 4.5,
          notes: '',
          sendsToKitchen: true,
          comandaId: 'cmd-101',
        },
      ],
    });

    const resPartial = applyComandaRecipeDeductions(ingredients, menu, partialVoidComanda, []);
    expect(resPartial.newMovements).toHaveLength(1);
    expect(resPartial.ingredients.find((i) => i.id === 'ing-carne')?.stock).toBe(2);
    expect(resPartial.ingredients.find((i) => i.id === 'ing-aceite')?.stock).toBe(1);
  });

  it('allows negative stock cleanly during rush service without throwing', () => {
    const ingredients: Ingredient[] = [
      { id: 'ing-carne', name: 'Carne', unit: 'kg', stock: 0.1, minStock: 0.5 },
      { id: 'ing-pan', name: 'Pan', unit: 'unidad', stock: 1, minStock: 4 },
    ];
    const menu = makeBaseMenu();
    const comanda = makeComanda({
      items: [
        {
          id: 'oi-rush',
          menuItemId: 'menu-burger',
          name: 'Hamburguesa Playera',
          quantity: 3,
          unitPriceUsd: 9.5,
          notes: '',
          sendsToKitchen: true,
          comandaId: 'cmd-101',
        },
      ],
    });

    const result = applyComandaRecipeDeductions(ingredients, menu, comanda, []);
    expect(result.ingredients.find((i) => i.id === 'ing-carne')?.stock).toBe(-0.5);
    expect(result.ingredients.find((i) => i.id === 'ing-pan')?.stock).toBe(-2);
  });
});

describe('applyVoidInventoryResolution', () => {
  const item: OrderItem = {
    id: 'oi-void-1',
    menuItemId: 'menu-burger',
    name: 'Hamburguesa Playera',
    quantity: 2,
    unitPriceUsd: 9.5,
    notes: '',
    sendsToKitchen: true,
    comandaId: 'cmd-101',
    voided: true,
  };

  it('restores stock when disposition is restock', () => {
    const ingredients = makeBaseIngredients();
    const menu = makeBaseMenu();

    const result = applyVoidInventoryResolution(
      ingredients,
      menu,
      item,
      'restock',
      'Error de comanda antes de cocinar',
      'u-admin-1',
      '2026-11-25T14:10:00Z',
    );

    expect(result.ingredients.find((i) => i.id === 'ing-carne')?.stock).toBe(2.4);
    expect(result.ingredients.find((i) => i.id === 'ing-pan')?.stock).toBe(12);
    expect(result.newMovements).toHaveLength(2);
    expect(result.newMovements[0]).toMatchObject({
      type: 'anulacion_devolucion',
      delta: 0.4,
      referenceId: 'oi-void-1',
      userId: 'u-admin-1',
    });
  });

  it('records zero-delta merma audit movements without double-deducting stock', () => {
    const ingredients = makeBaseIngredients();
    const menu = makeBaseMenu();

    const result = applyVoidInventoryResolution(
      ingredients,
      menu,
      item,
      'merma',
      'Se cayo en cocina',
      'u-admin-1',
      '2026-11-25T14:15:00Z',
    );

    expect(result.ingredients.find((i) => i.id === 'ing-carne')?.stock).toBe(2);
    expect(result.ingredients.find((i) => i.id === 'ing-pan')?.stock).toBe(10);
    expect(result.newMovements).toHaveLength(2);
    expect(result.newMovements[0]).toMatchObject({
      type: 'merma',
      delta: 0,
      referenceId: 'oi-void-1',
      reason: 'Merma por anulación (2x Hamburguesa Playera): Se cayo en cocina',
    });
  });
});

describe('getLowStockIngredients', () => {
  it('filters stock <= minStock and sorts by urgency ratio ascending', () => {
    const list: Ingredient[] = [
      { id: '1', name: 'Ok', unit: 'kg', stock: 5, minStock: 2 },
      { id: '2', name: 'Borderline', unit: 'kg', stock: 2, minStock: 2 }, // ratio 1.0
      { id: '3', name: 'Negative', unit: 'kg', stock: -0.5, minStock: 1 }, // ratio -0.5
      { id: '4', name: 'Critical', unit: 'unidad', stock: 1, minStock: 10 }, // ratio 0.1
    ];

    const low = getLowStockIngredients(list);
    expect(low.map((i) => i.id)).toEqual(['3', '4', '2']);
  });
});
