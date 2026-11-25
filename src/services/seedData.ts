import type {
  Ingredient,
  Location,
  MenuItem,
  PaymentMethod,
  PosState,
  Shift,
  UserProfile,
} from '../types/pos';

export function createEmptyPaymentMethodTotals(): Record<
  PaymentMethod,
  { count: number; totalUsd: number; totalBs: number }
> {
  return {
    zelle: { count: 0, totalUsd: 0, totalBs: 0 },
    efectivo_usd: { count: 0, totalUsd: 0, totalBs: 0 },
    debito_punto: { count: 0, totalUsd: 0, totalBs: 0 },
    efectivo_bs: { count: 0, totalUsd: 0, totalBs: 0 },
  };
}

function createLocations(): Location[] {
  const mesas: Location[] = Array.from({ length: 10 }, (_, idx) => {
    const number = idx + 1;
    return {
      id: `mesa-${number}`,
      zone: 'mesas',
      number,
      label: `Mesa ${number}`,
      status: 'libre',
      activeOrderId: null,
      pendingSync: false,
      kitchenReadyAlert: false,
    };
  });

  const toldos: Location[] = Array.from({ length: 18 }, (_, idx) => {
    const number = idx + 1;
    return {
      id: `toldo-${number}`,
      zone: 'toldos',
      number,
      label: `Toldo ${number}`,
      status: 'libre',
      activeOrderId: null,
      pendingSync: false,
      kitchenReadyAlert: false,
    };
  });

  return [...mesas, ...toldos];
}

function createIngredients(): Ingredient[] {
  return [
    {
      id: 'ing-carne-molida',
      name: 'Carne molida',
      unit: 'kg',
      stock: 5,
      minStock: 1.5,
      unitCostUsd: 6.5,
    },
    {
      id: 'ing-pan-hamburguesa',
      name: 'Pan de hamburguesa',
      unit: 'unidad',
      stock: 40,
      minStock: 12,
      unitCostUsd: 0.45,
    },
    {
      id: 'ing-queso-amarillo',
      name: 'Queso amarillo',
      unit: 'kg',
      stock: 2,
      minStock: 0.6,
      unitCostUsd: 8.5,
    },
    {
      id: 'ing-pescado-pargo',
      name: 'Pescado pargo',
      unit: 'unidad',
      stock: 18,
      minStock: 6,
      unitCostUsd: 5.5,
    },
    {
      id: 'ing-platano-verde',
      name: 'Plátano verde',
      unit: 'unidad',
      stock: 30,
      minStock: 10,
      unitCostUsd: 0.4,
    },
    {
      id: 'ing-camarones',
      name: 'Camarones / Mariscos',
      unit: 'kg',
      stock: 4,
      minStock: 1,
      unitCostUsd: 12,
    },
    {
      id: 'ing-limon',
      name: 'Limón',
      unit: 'kg',
      stock: 3,
      minStock: 0.8,
      unitCostUsd: 2.2,
    },
    {
      id: 'ing-cerveza-polar',
      name: 'Cerveza Polar Pilsen',
      unit: 'unidad',
      stock: 96,
      minStock: 24,
      unitCostUsd: 0.9,
    },
    {
      id: 'ing-agua-mineral',
      name: 'Agua mineral',
      unit: 'unidad',
      stock: 48,
      minStock: 12,
      unitCostUsd: 0.4,
    },
    {
      id: 'ing-ron-anejo',
      name: 'Ron añejo',
      unit: 'L',
      stock: 3,
      minStock: 1,
      unitCostUsd: 14,
    },
    {
      id: 'ing-pina-coco',
      name: 'Piña / Crema de coco',
      unit: 'unidad',
      stock: 20,
      minStock: 6,
      unitCostUsd: 1.2,
    },
    {
      id: 'ing-refresco-lata',
      name: 'Refresco lata',
      unit: 'unidad',
      stock: 48,
      minStock: 12,
      unitCostUsd: 0.65,
    },
  ];
}

function createMenu(): MenuItem[] {
  return [
    {
      id: 'menu-hamburguesa-playera',
      name: 'Hamburguesa Playera',
      category: 'Platos',
      priceUsd: 8.5,
      sendsToKitchen: true,
      outOfStock: false,
      recipe: [
        { ingredientId: 'ing-carne-molida', quantity: 200, unit: 'g' },
        { ingredientId: 'ing-pan-hamburguesa', quantity: 1, unit: 'unidad' },
        { ingredientId: 'ing-queso-amarillo', quantity: 30, unit: 'g' },
      ],
    },
    {
      id: 'menu-pescado-frito',
      name: 'Pescado Frito Completo',
      category: 'Platos',
      priceUsd: 14,
      sendsToKitchen: true,
      outOfStock: false,
      recipe: [
        { ingredientId: 'ing-pescado-pargo', quantity: 1, unit: 'unidad' },
        { ingredientId: 'ing-platano-verde', quantity: 1, unit: 'unidad' },
      ],
    },
    {
      id: 'menu-ceviche-mixto',
      name: 'Ceviche Mixto',
      category: 'Entradas',
      priceUsd: 11,
      sendsToKitchen: true,
      outOfStock: false,
      recipe: [
        { ingredientId: 'ing-camarones', quantity: 250, unit: 'g' },
        { ingredientId: 'ing-limon', quantity: 100, unit: 'g' },
      ],
    },
    {
      id: 'menu-tostones-queso',
      name: 'Tostones con Queso',
      category: 'Entradas',
      priceUsd: 6,
      sendsToKitchen: true,
      outOfStock: false,
      recipe: [
        { ingredientId: 'ing-platano-verde', quantity: 2, unit: 'unidad' },
        { ingredientId: 'ing-queso-amarillo', quantity: 80, unit: 'g' },
      ],
    },
    {
      id: 'menu-cerveza-polar',
      name: 'Cerveza Polar Pilsen',
      category: 'Bebidas',
      priceUsd: 2.5,
      sendsToKitchen: false,
      outOfStock: false,
      recipe: [{ ingredientId: 'ing-cerveza-polar', quantity: 1, unit: 'unidad' }],
    },
    {
      id: 'menu-refresco-lata',
      name: 'Refresco Lata',
      category: 'Bebidas',
      priceUsd: 2,
      sendsToKitchen: false,
      outOfStock: false,
      recipe: [{ ingredientId: 'ing-refresco-lata', quantity: 1, unit: 'unidad' }],
    },
    {
      id: 'menu-agua-mineral',
      name: 'Agua Mineral',
      category: 'Bebidas',
      priceUsd: 1.5,
      sendsToKitchen: false,
      outOfStock: false,
      recipe: [{ ingredientId: 'ing-agua-mineral', quantity: 1, unit: 'unidad' }],
    },
    {
      id: 'menu-pina-colada',
      name: 'Piña Colada',
      category: 'Cócteles',
      priceUsd: 6.5,
      sendsToKitchen: false,
      outOfStock: false,
      recipe: [
        { ingredientId: 'ing-ron-anejo', quantity: 60, unit: 'ml' },
        { ingredientId: 'ing-pina-coco', quantity: 1, unit: 'unidad' },
      ],
    },
    {
      id: 'menu-alquiler-toldo',
      name: 'Alquiler de Toldo',
      category: 'Extras',
      priceUsd: 15,
      sendsToKitchen: false,
      outOfStock: false,
      recipe: [],
    },
  ];
}

function createUsers(): UserProfile[] {
  return [
    {
      id: 'user-carlos',
      name: 'Carlos (Mesonero)',
      role: 'mesonero',
      pin: '1111',
      active: true,
    },
    {
      id: 'user-maria',
      name: 'María (Mesonera)',
      role: 'mesonero',
      pin: '1234',
      active: true,
    },
    {
      id: 'user-cocina',
      name: 'Estación Cocina',
      role: 'cocina',
      pin: '2222',
      active: true,
    },
    {
      id: 'user-admin',
      name: 'Administrador / Caja',
      role: 'caja_admin',
      pin: '0000',
      active: true,
    },
  ];
}

function createInitialShift(nowIso: string): Shift {
  return {
    id: 'shift-1',
    openedAt: nowIso,
    openedBy: 'user-admin',
    status: 'abierto',
    totalSalesUsd: 0,
    totalSalesBs: 0,
    ordersCount: 0,
    totalsByMethod: createEmptyPaymentMethodTotals(),
  };
}

/**
 * Generates a fresh default POS state with 10 mesas, 18 toldos, 12 pantry ingredients,
 * 9 menu items with 1-level recipes, 4 staff profiles, 1 open shift, and printer settings.
 */
export function createInitialPosState(): PosState {
  const nowIso = new Date().toISOString();
  return {
    locations: createLocations(),
    menu: createMenu(),
    ingredients: createIngredients(),
    orders: [],
    comandas: [],
    movements: [],
    shifts: [createInitialShift(nowIso)],
    users: createUsers(),
    settings: {
      exchangeRate: 52.5,
      exchangeRateUpdatedAt: nowIso,
      printer: {
        restaurantName: 'Brisa Marina Beach Club',
        ip: '192.168.1.200',
        port: 9100,
        autoPrintFromKitchen: true,
        lanFallbackEnabled: true,
      },
    },
    printJobs: [],
    nextComandaSeq: 1,
  };
}
