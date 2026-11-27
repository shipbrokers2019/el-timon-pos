import type {
  Comanda,
  Ingredient,
  InventoryMovement,
  MenuItem,
  Order,
  OrderItem,
  Unit,
  VoidDisposition,
} from '../types/pos';

const CONVERSION_FACTORS: Partial<Record<Unit, Partial<Record<Unit, number>>>> = {
  g: { g: 1, kg: 0.001 },
  kg: { kg: 1, g: 1000 },
  ml: { ml: 1, L: 0.001 },
  L: { L: 1, ml: 1000 },
  unidad: { unidad: 1 },
};

/**
 * Rounds ingredient stock and movement quantities to 3 decimal places.
 */
function roundQuantity(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error('Quantity must be a finite number');
  }
  const absRounded = Math.round((Math.abs(value) + 1e-9) * 1000) / 1000;
  if (absRounded === 0) {
    return 0;
  }
  return value < 0 ? -absRounded : absRounded;
}

/**
 * Converts a quantity between compatible units (`g` <-> `kg`, `ml` <-> `L`, or identical units).
 * Throws a descriptive error if the units belong to incompatible dimensions.
 */
export function convertUnitQuantity(amount: number, from: Unit, to: Unit): number {
  if (!Number.isFinite(amount)) {
    throw new Error('Amount to convert must be a finite number');
  }

  if (from === to) {
    return amount;
  }

  const factor = CONVERSION_FACTORS[from]?.[to];
  if (factor === undefined) {
    throw new Error(`Incompatible unit conversion: cannot convert from "${from}" to "${to}"`);
  }

  const converted = amount * factor;
  return converted === 0 ? 0 : Number(converted.toPrecision(12));
}

/**
 * Applies 1-level recipe ingredient deductions for a comanda idempotently.
 * Ignores void alert comandas and voided order items, and permits negative stock during rush service.
 */
export function applyComandaRecipeDeductions(
  ingredients: Ingredient[],
  menu: MenuItem[],
  comanda: Comanda,
  existingMovements: InventoryMovement[],
  nowIso?: string,
): { ingredients: Ingredient[]; newMovements: InventoryMovement[] } {
  if (comanda.isVoidAlert === true) {
    return { ingredients, newMovements: [] };
  }

  const alreadyProcessed = existingMovements.some(
    (movement) => movement.type === 'venta' && movement.referenceId === comanda.id,
  );
  if (alreadyProcessed) {
    return { ingredients, newMovements: [] };
  }

  const updatedIngredients = ingredients.map((ingredient) => ({ ...ingredient }));
  const ingredientById = new Map(updatedIngredients.map((ingredient) => [ingredient.id, ingredient]));
  const menuById = new Map(menu.map((item) => [item.id, item]));
  const newMovements: InventoryMovement[] = [];
  const createdAt = nowIso ?? comanda.createdAt;

  for (const item of comanda.items) {
    if (item.voided === true) {
      continue;
    }

    const menuItem = menuById.get(item.menuItemId);
    if (!menuItem || menuItem.recipe.length === 0) {
      continue;
    }

    menuItem.recipe.forEach((line, lineIndex) => {
      const ingredient = ingredientById.get(line.ingredientId);
      if (!ingredient) {
        return;
      }

      const convertedQty = roundQuantity(
        convertUnitQuantity(line.quantity * item.quantity, line.unit, ingredient.unit),
      );
      ingredient.stock = roundQuantity(ingredient.stock - convertedQty);

      newMovements.push({
        id: `mov-venta-${comanda.id}-${item.id}-${line.ingredientId}-${lineIndex}`,
        ingredientId: ingredient.id,
        ingredientName: ingredient.name,
        type: 'venta',
        delta: convertedQty === 0 ? 0 : -convertedQty,
        unit: ingredient.unit,
        reason: `Venta ${comanda.locationLabel} (${item.quantity}x ${item.name})`,
        referenceId: comanda.id,
        userId: comanda.waiterId,
        createdAt,
      });
    });
  }

  return {
    ingredients: updatedIngredients,
    newMovements,
  };
}

/**
 * Reconciles recipe ingredient deductions for all orders (e.g. rounds created by Mesonero
 * stations that cannot write directly to /ingredients or /inventoryMovements per RBAC rules).
 * Strictly idempotent by comandaId so no round is ever deducted twice.
 */
export function reconcileOrdersInventoryDeductions(
  orders: Order[],
  ingredients: Ingredient[],
  menu: MenuItem[],
  existingMovements: InventoryMovement[],
  nowIso: string = new Date().toISOString(),
  skipComandaIds?: ReadonlySet<string>,
): {
  ingredients: Ingredient[];
  newMovements: InventoryMovement[];
  touchedIngredientIds: Set<string>;
  processedComandaIds: string[];
} {
  let currentIngredients = ingredients;
  let currentMovements = existingMovements;
  const allNewMovements: InventoryMovement[] = [];
  const touchedIngredientIds = new Set<string>();
  const processedComandaIds: string[] = [];

  for (const order of orders) {
    const itemsByComanda = new Map<string, OrderItem[]>();
    for (const item of order.items) {
      if (item.voided === true || !item.comandaId) {
        continue;
      }
      if (skipComandaIds?.has(item.comandaId)) {
        continue;
      }
      const list = itemsByComanda.get(item.comandaId);
      if (list) {
        list.push(item);
      } else {
        itemsByComanda.set(item.comandaId, [item]);
      }
    }

    let roundNumber = 1;
    for (const [comandaId, items] of itemsByComanda.entries()) {
      const syntheticComanda: Comanda = {
        id: comandaId,
        sequenceNumber: roundNumber,
        orderId: order.id,
        locationId: order.locationId,
        locationLabel: order.locationLabel,
        zone: order.zone,
        roundNumber,
        waiterId: order.waiterId,
        waiterName: order.waiterName,
        items,
        status: 'pendiente',
        printStatus: 'pending',
        createdAt: order.openedAt,
        updatedAt: order.openedAt,
        isVoidAlert: false,
      };
      roundNumber += 1;

      const { ingredients: nextIngredients, newMovements } =
        applyComandaRecipeDeductions(
          currentIngredients,
          menu,
          syntheticComanda,
          currentMovements,
          nowIso,
        );

      if (newMovements.length > 0) {
        currentIngredients = nextIngredients;
        currentMovements = [...currentMovements, ...newMovements];
        allNewMovements.push(...newMovements);
        processedComandaIds.push(comandaId);
        for (const mov of newMovements) {
          touchedIngredientIds.add(mov.ingredientId);
        }
      }
    }
  }

  return {
    ingredients: currentIngredients,
    newMovements: allNewMovements,
    touchedIngredientIds,
    processedComandaIds,
  };
}

/**
 * Resolves inventory impact when an order item is voided:
 * - `restock`: returns recipe quantities back into stock (`anulacion_devolucion`).
 * - `merma`: leaves stock unchanged (already deducted on comanda) and logs zero-delta waste audit rows.
 */
export function applyVoidInventoryResolution(
  ingredients: Ingredient[],
  menu: MenuItem[],
  item: OrderItem,
  disposition: VoidDisposition,
  reason: string,
  userId: string,
  nowIso: string,
): { ingredients: Ingredient[]; newMovements: InventoryMovement[] } {
  const menuItem = menu.find((entry) => entry.id === item.menuItemId);
  if (!menuItem || menuItem.recipe.length === 0) {
    return { ingredients, newMovements: [] };
  }

  const updatedIngredients = ingredients.map((ingredient) => ({ ...ingredient }));
  const ingredientById = new Map(updatedIngredients.map((ingredient) => [ingredient.id, ingredient]));
  const newMovements: InventoryMovement[] = [];

  menuItem.recipe.forEach((line, lineIndex) => {
    const ingredient = ingredientById.get(line.ingredientId);
    if (!ingredient) {
      return;
    }

    if (disposition === 'restock') {
      const convertedQty = roundQuantity(
        convertUnitQuantity(line.quantity * item.quantity, line.unit, ingredient.unit),
      );
      ingredient.stock = roundQuantity(ingredient.stock + convertedQty);

      newMovements.push({
        id: `mov-restock-${item.id}-${line.ingredientId}-${lineIndex}`,
        ingredientId: ingredient.id,
        ingredientName: ingredient.name,
        type: 'anulacion_devolucion',
        delta: convertedQty,
        unit: ingredient.unit,
        reason: `Devolución por anulación (${item.quantity}x ${item.name}): ${reason}`,
        referenceId: item.id,
        userId,
        createdAt: nowIso,
      });
      return;
    }

    newMovements.push({
      id: `mov-merma-${item.id}-${line.ingredientId}-${lineIndex}`,
      ingredientId: ingredient.id,
      ingredientName: ingredient.name,
      type: 'merma',
      delta: 0,
      unit: ingredient.unit,
      reason: `Merma por anulación (${item.quantity}x ${item.name}): ${reason}`,
      referenceId: item.id,
      userId,
      createdAt: nowIso,
    });
  });

  return {
    ingredients: updatedIngredients,
    newMovements,
  };
}

/**
 * Returns ingredients at or below their minimum stock threshold, sorted by urgency ascending.
 */
export function getLowStockIngredients(ingredients: Ingredient[]): Ingredient[] {
  return ingredients
    .filter((ingredient) => ingredient.stock <= ingredient.minStock)
    .slice()
    .sort((a, b) => {
      const ratioA = a.stock / Math.max(a.minStock, 1);
      const ratioB = b.stock / Math.max(b.minStock, 1);
      return ratioA - ratioB;
    });
}
