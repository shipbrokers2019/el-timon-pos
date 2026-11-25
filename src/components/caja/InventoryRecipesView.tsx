import { useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowDownCircle,
  ArrowUpCircle,
  BookOpen,
  CheckCircle2,
  Package,
  Plus,
  Save,
  Trash2,
} from 'lucide-react';
import { usePos } from '../../store/PosProvider';
import type {
  Ingredient,
  InventoryMovementType,
  MenuItem,
  RecipeLine,
  Unit,
} from '../../types/pos';

type InventorySubTab = 'insumos' | 'recetas';

const ALL_UNITS: readonly Unit[] = ['g', 'kg', 'ml', 'L', 'unidad'];

const MOVEMENT_BADGE: Record<InventoryMovementType, { label: string; className: string }> = {
  venta: { label: 'Venta', className: 'bg-[#0E7490]/12 text-[#0E7490]' },
  reposicion: { label: 'Reposición', className: 'bg-[#047857]/12 text-[#047857]' },
  merma: { label: 'Merma', className: 'bg-[#B91C1C]/12 text-[#B91C1C]' },
  ajuste: { label: 'Ajuste', className: 'bg-[#B45309]/12 text-[#B45309]' },
  anulacion_devolucion: {
    label: 'Devolución',
    className: 'bg-[#047857]/12 text-[#047857]',
  },
};

function getCompatibleUnits(unit: Unit): Unit[] {
  if (unit === 'g' || unit === 'kg') {
    return ['g', 'kg'];
  }
  if (unit === 'ml' || unit === 'L') {
    return ['ml', 'L'];
  }
  return ['unidad'];
}

function formatQty(val: number): string {
  return Number(val.toFixed(3)).toString();
}

export function InventoryRecipesView() {
  const {
    state,
    adjustIngredientStock,
    saveIngredient,
    saveMenuItem,
    toggleMenuOutOfStock,
  } = usePos();

  const [subTab, setSubTab] = useState<InventorySubTab>('insumos');

  // Stock adjustment inline state
  const [adjustingIngredient, setAdjustingIngredient] = useState<Ingredient | null>(null);
  const [adjustType, setAdjustType] = useState<'reposicion' | 'merma' | 'ajuste'>('reposicion');
  const [adjustQty, setAdjustQty] = useState<string>('');
  const [adjustReason, setAdjustReason] = useState<string>('');

  // New ingredient inline form
  const [showNewIngredient, setShowNewIngredient] = useState(false);
  const [newIngName, setNewIngName] = useState('');
  const [newIngUnit, setNewIngUnit] = useState<Unit>('kg');
  const [newIngStock, setNewIngStock] = useState('0');
  const [newIngMinStock, setNewIngMinStock] = useState('1');

  // Recipe editor state
  const [editingMenuItemId, setEditingMenuItemId] = useState<string | null>(null);
  const [draftRecipe, setDraftRecipe] = useState<RecipeLine[]>([]);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  const ingredientById = useMemo(
    () => new Map(state.ingredients.map((ing) => [ing.id, ing])),
    [state.ingredients],
  );

  const recentMovements = useMemo(
    () =>
      state.movements
        .slice()
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .slice(0, 30),
    [state.movements],
  );

  const openAdjustForm = (
    ingredient: Ingredient,
    type: 'reposicion' | 'merma' | 'ajuste',
  ) => {
    setAdjustingIngredient(ingredient);
    setAdjustType(type);
    setAdjustQty('');
    setAdjustReason(type === 'reposicion' ? 'Reposición de inventario' : '');
    setErrorMessage(null);
    setFeedbackMessage(null);
  };

  const handleSaveAdjustment = async () => {
    if (!adjustingIngredient) {
      return;
    }
    const numeric = Number(adjustQty.replace(',', '.'));
    if (!Number.isFinite(numeric) || numeric === 0) {
      setErrorMessage('Ingresa una cantidad numérica distinta de 0.');
      return;
    }
    const reason = adjustReason.trim() || 'Ajuste de inventario';
    setErrorMessage(null);
    try {
      await adjustIngredientStock(adjustingIngredient.id, numeric, adjustType, reason);
      setAdjustingIngredient(null);
      setAdjustQty('');
      setAdjustReason('');
      setFeedbackMessage('Movimiento de inventario registrado.');
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'No se pudo registrar el movimiento.',
      );
    }
  };

  const handleCreateIngredient = async () => {
    const cleanName = newIngName.trim();
    if (!cleanName) {
      setErrorMessage('El nombre del insumo es obligatorio.');
      return;
    }
    const stock = Number(newIngStock.replace(',', '.'));
    const minStock = Number(newIngMinStock.replace(',', '.'));
    if (!Number.isFinite(stock) || !Number.isFinite(minStock) || minStock < 0) {
      setErrorMessage('Verifica stock inicial y stock mínimo.');
      return;
    }
    setErrorMessage(null);
    try {
      await saveIngredient({
        name: cleanName,
        unit: newIngUnit,
        stock,
        minStock,
      });
      setNewIngName('');
      setNewIngStock('0');
      setNewIngMinStock('1');
      setShowNewIngredient(false);
      setFeedbackMessage(`Insumo "${cleanName}" creado.`);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'No se pudo crear el insumo.');
    }
  };

  const handleStartEditRecipe = (item: MenuItem) => {
    setEditingMenuItemId(item.id);
    setDraftRecipe(item.recipe.map((line) => ({ ...line })));
    setErrorMessage(null);
    setFeedbackMessage(null);
  };

  const handleAddRecipeRow = () => {
    const defaultIng = state.ingredients[0];
    if (!defaultIng) {
      return;
    }
    setDraftRecipe((prev) => [
      ...prev,
      { ingredientId: defaultIng.id, quantity: 1, unit: defaultIng.unit },
    ]);
  };

  const handleRecipeRowChange = (index: number, patch: Partial<RecipeLine>) => {
    setDraftRecipe((prev) =>
      prev.map((row, idx) => {
        if (idx !== index) {
          return row;
        }
        const nextRow = { ...row, ...patch };
        if (patch.ingredientId) {
          const targetIng = ingredientById.get(patch.ingredientId);
          if (targetIng) {
            const compat = getCompatibleUnits(targetIng.unit);
            if (!compat.includes(nextRow.unit)) {
              nextRow.unit = targetIng.unit;
            }
          }
        }
        return nextRow;
      }),
    );
  };

  const handleRemoveRecipeRow = (index: number) => {
    setDraftRecipe((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleSaveRecipe = async (item: MenuItem) => {
    const invalid = draftRecipe.some(
      (line) => !Number.isFinite(line.quantity) || line.quantity <= 0,
    );
    if (invalid) {
      setErrorMessage('Todas las cantidades de la receta deben ser mayores que 0.');
      return;
    }
    setErrorMessage(null);
    try {
      await saveMenuItem({ ...item, recipe: draftRecipe });
      setEditingMenuItemId(null);
      setFeedbackMessage(`Receta de "${item.name}" guardada.`);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'No se pudo guardar la receta.');
    }
  };

  return (
    <div className="space-y-5">
      {/* Sub-tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex gap-2" role="tablist" aria-label="Subsecciones de inventario">
          <button
            type="button"
            role="tab"
            aria-selected={subTab === 'insumos'}
            onClick={() => {
              setSubTab('insumos');
              setErrorMessage(null);
            }}
            className={`min-h-12 px-4 rounded-xl border text-sm font-bold inline-flex items-center gap-2 cursor-pointer ${
              subTab === 'insumos'
                ? 'bg-[#0E7490] border-[#0E7490] text-white'
                : 'bg-white border-[#E5DFD3] text-[#0F2A36] hover:bg-[#F2EDE4]'
            }`}
          >
            <Package className="h-4 w-4" aria-hidden="true" />
            <span>Insumos y Kardex</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={subTab === 'recetas'}
            onClick={() => {
              setSubTab('recetas');
              setErrorMessage(null);
            }}
            className={`min-h-12 px-4 rounded-xl border text-sm font-bold inline-flex items-center gap-2 cursor-pointer ${
              subTab === 'recetas'
                ? 'bg-[#0E7490] border-[#0E7490] text-white'
                : 'bg-white border-[#E5DFD3] text-[#0F2A36] hover:bg-[#F2EDE4]'
            }`}
          >
            <BookOpen className="h-4 w-4" aria-hidden="true" />
            <span>Recetas (Escandallo) y Disponibilidad</span>
          </button>
        </div>

        {subTab === 'insumos' && (
          <button
            type="button"
            onClick={() => setShowNewIngredient((prev) => !prev)}
            className="min-h-12 px-4 rounded-xl bg-[#0E7490] hover:bg-[#0B5E75] text-white text-sm font-bold inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span>Nuevo insumo</span>
          </button>
        )}
      </div>

      {errorMessage && (
        <p
          role="alert"
          className="p-3 rounded-xl bg-red-50 border border-[#B91C1C]/30 text-sm font-semibold text-[#B91C1C] flex items-center gap-2"
        >
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{errorMessage}</span>
        </p>
      )}

      {feedbackMessage && (
        <p
          role="status"
          className="p-3 rounded-xl bg-[#047857]/10 border border-[#047857]/30 text-sm font-semibold text-[#047857] flex items-center gap-2"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{feedbackMessage}</span>
        </p>
      )}

      {/* SUB-TAB 1: INSUMOS Y KARDEX */}
      {subTab === 'insumos' && (
        <div className="space-y-5">
          {/* New Ingredient Form */}
          {showNewIngredient && (
            <section className="p-5 rounded-2xl bg-white border border-[#E5DFD3] space-y-3">
              <h3 className="text-base font-extrabold text-[#0F2A36]">Crear nuevo insumo</h3>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div className="sm:col-span-2">
                  <label
                    htmlFor="new-ing-name"
                    className="block text-xs font-bold text-[#0F2A36] mb-1"
                  >
                    Nombre del insumo
                  </label>
                  <input
                    id="new-ing-name"
                    type="text"
                    value={newIngName}
                    onChange={(e) => setNewIngName(e.target.value)}
                    placeholder="Ej. Aceite vegetal"
                    className="w-full min-h-12 px-3 rounded-xl border border-[#E5DFD3] bg-[#FAF8F4] text-sm"
                  />
                </div>
                <div>
                  <label
                    htmlFor="new-ing-unit"
                    className="block text-xs font-bold text-[#0F2A36] mb-1"
                  >
                    Unidad
                  </label>
                  <select
                    id="new-ing-unit"
                    value={newIngUnit}
                    onChange={(e) => setNewIngUnit(e.target.value as Unit)}
                    className="w-full min-h-12 px-3 rounded-xl border border-[#E5DFD3] bg-[#FAF8F4] text-sm font-semibold"
                  >
                    {ALL_UNITS.map((unit) => (
                      <option key={unit} value={unit}>
                        {unit}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="new-ing-stock"
                    className="block text-xs font-bold text-[#0F2A36] mb-1"
                  >
                    Stock inicial
                  </label>
                  <input
                    id="new-ing-stock"
                    type="number"
                    step="0.01"
                    value={newIngStock}
                    onChange={(e) => setNewIngStock(e.target.value)}
                    className="w-full min-h-12 px-3 rounded-xl border border-[#E5DFD3] bg-[#FAF8F4] text-sm font-bold tabular-nums"
                  />
                </div>
                <div>
                  <label
                    htmlFor="new-ing-min"
                    className="block text-xs font-bold text-[#0F2A36] mb-1"
                  >
                    Stock mínimo
                  </label>
                  <input
                    id="new-ing-min"
                    type="number"
                    step="0.01"
                    min="0"
                    value={newIngMinStock}
                    onChange={(e) => setNewIngMinStock(e.target.value)}
                    className="w-full min-h-12 px-3 rounded-xl border border-[#E5DFD3] bg-[#FAF8F4] text-sm font-bold tabular-nums"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowNewIngredient(false)}
                  className="min-h-12 px-4 rounded-xl border border-[#E5DFD3] text-sm font-bold text-[#0F2A36] cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => void handleCreateIngredient()}
                  className="min-h-12 px-5 rounded-xl bg-[#047857] hover:bg-[#065F46] text-white text-sm font-bold cursor-pointer"
                >
                  Guardar insumo
                </button>
              </div>
            </section>
          )}

          {/* Inline Stock Adjustment Panel */}
          {adjustingIngredient && (
            <section className="p-5 rounded-2xl bg-white border border-[#0E7490] space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-base font-extrabold text-[#0F2A36]">
                  {adjustType === 'reposicion'
                    ? 'Registrar entrada / reposición'
                    : 'Registrar merma / ajuste'}{' '}
                  · {adjustingIngredient.name}
                </h3>
                <span className="text-xs font-bold text-[#0F2A36]/75 tabular-nums">
                  Stock actual: {formatQty(adjustingIngredient.stock)} {adjustingIngredient.unit}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label
                    htmlFor="adjust-type-select"
                    className="block text-xs font-bold text-[#0F2A36] mb-1"
                  >
                    Tipo de movimiento
                  </label>
                  <select
                    id="adjust-type-select"
                    value={adjustType}
                    onChange={(e) =>
                      setAdjustType(e.target.value as 'reposicion' | 'merma' | 'ajuste')
                    }
                    className="w-full min-h-12 px-3 rounded-xl border border-[#E5DFD3] bg-[#FAF8F4] text-sm font-semibold"
                  >
                    <option value="reposicion">Reposición (Entrada +)</option>
                    <option value="merma">Merma (Pérdida -)</option>
                    <option value="ajuste">Ajuste manual (+/-)</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="adjust-qty-input"
                    className="block text-xs font-bold text-[#0F2A36] mb-1"
                  >
                    Cantidad ({adjustingIngredient.unit})
                  </label>
                  <input
                    id="adjust-qty-input"
                    type="number"
                    step="0.01"
                    value={adjustQty}
                    onChange={(e) => setAdjustQty(e.target.value)}
                    placeholder="Ej. 2"
                    className="w-full min-h-12 px-3 rounded-xl border border-[#E5DFD3] bg-[#FAF8F4] text-sm font-bold tabular-nums"
                  />
                </div>

                <div>
                  <label
                    htmlFor="adjust-reason-input"
                    className="block text-xs font-bold text-[#0F2A36] mb-1"
                  >
                    Motivo
                  </label>
                  <input
                    id="adjust-reason-input"
                    type="text"
                    value={adjustReason}
                    onChange={(e) => setAdjustReason(e.target.value)}
                    placeholder="Ej. Compra proveedor / Producto dañado"
                    className="w-full min-h-12 px-3 rounded-xl border border-[#E5DFD3] bg-[#FAF8F4] text-sm"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setAdjustingIngredient(null)}
                  className="min-h-12 px-4 rounded-xl border border-[#E5DFD3] text-sm font-bold text-[#0F2A36] cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => void handleSaveAdjustment()}
                  className="min-h-12 px-5 rounded-xl bg-[#047857] hover:bg-[#065F46] text-white text-sm font-bold cursor-pointer"
                >
                  Guardar movimiento
                </button>
              </div>
            </section>
          )}

          {/* Ingredients Table */}
          <section className="bg-white border border-[#E5DFD3] rounded-2xl overflow-hidden">
            <div className="px-5 py-3.5 bg-[#F2EDE4] border-b border-[#E5DFD3]">
              <h2 className="text-base font-extrabold text-[#0F2A36]">
                Existencias de insumos ({state.ingredients.length})
              </h2>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#E5DFD3] bg-[#FAF8F4] text-xs font-bold text-[#0F2A36]/80">
                    <th className="py-3 px-4">Insumo</th>
                    <th className="py-3 px-4 text-right">Stock actual</th>
                    <th className="py-3 px-4 text-right">Stock mínimo</th>
                    <th className="py-3 px-4">Estado</th>
                    <th className="py-3 px-4 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5DFD3] text-sm">
                  {state.ingredients.map((ing) => {
                    const isCritical = ing.stock <= 0;
                    const isLow = !isCritical && ing.stock <= ing.minStock;

                    return (
                      <tr key={ing.id} className="hover:bg-[#FAF8F4]">
                        <td className="py-3 px-4 font-bold text-[#0F2A36]">{ing.name}</td>
                        <td className="py-3 px-4 text-right font-extrabold text-[#0F2A36] tabular-nums">
                          {formatQty(ing.stock)} {ing.unit}
                        </td>
                        <td className="py-3 px-4 text-right font-medium text-[#0F2A36]/70 tabular-nums">
                          {formatQty(ing.minStock)} {ing.unit}
                        </td>
                        <td className="py-3 px-4">
                          {isCritical ? (
                            <span className="inline-flex px-2.5 py-0.5 rounded-full bg-[#B91C1C] text-white text-xs font-bold">
                              Sin stock
                            </span>
                          ) : isLow ? (
                            <span className="inline-flex px-2.5 py-0.5 rounded-full bg-[#B45309] text-white text-xs font-bold">
                              Stock bajo
                            </span>
                          ) : (
                            <span className="inline-flex px-2.5 py-0.5 rounded-full bg-[#047857]/12 text-[#047857] text-xs font-bold">
                              Óptimo
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          <div className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => openAdjustForm(ing, 'reposicion')}
                              className="min-h-12 px-3 rounded-xl border border-[#047857]/35 bg-[#047857]/10 hover:bg-[#047857]/20 text-xs font-bold text-[#047857] inline-flex items-center gap-1 cursor-pointer"
                            >
                              <ArrowUpCircle className="h-4 w-4" aria-hidden="true" />
                              <span>Entrada</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => openAdjustForm(ing, 'merma')}
                              className="min-h-12 px-3 rounded-xl border border-[#B45309]/35 bg-[#B45309]/10 hover:bg-[#B45309]/20 text-xs font-bold text-[#92400E] inline-flex items-center gap-1 cursor-pointer"
                            >
                              <ArrowDownCircle className="h-4 w-4" aria-hidden="true" />
                              <span>Merma / Ajuste</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* Kardex Movement Log */}
          <section className="bg-white border border-[#E5DFD3] rounded-2xl overflow-hidden">
            <div className="px-5 py-3.5 bg-[#F2EDE4] border-b border-[#E5DFD3]">
              <h3 className="text-base font-extrabold text-[#0F2A36]">
                Kardex de movimientos recientes ({recentMovements.length})
              </h3>
            </div>

            {recentMovements.length === 0 ? (
              <p className="p-5 text-sm font-medium text-[#0F2A36]/70">
                Aún no se han registrado movimientos de inventario.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[#E5DFD3] bg-[#FAF8F4] text-xs font-bold text-[#0F2A36]/80">
                      <th className="py-2.5 px-4">Insumo</th>
                      <th className="py-2.5 px-4">Tipo</th>
                      <th className="py-2.5 px-4 text-right">Variación</th>
                      <th className="py-2.5 px-4">Motivo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E5DFD3] text-xs sm:text-sm">
                    {recentMovements.map((mov) => {
                      const badge = MOVEMENT_BADGE[mov.type];
                      return (
                        <tr key={mov.id}>
                          <td className="py-2.5 px-4 font-bold text-[#0F2A36]">
                            {mov.ingredientName}
                          </td>
                          <td className="py-2.5 px-4">
                            <span
                              className={`inline-flex px-2 py-0.5 rounded-full text-xs font-bold ${badge.className}`}
                            >
                              {badge.label}
                            </span>
                          </td>
                          <td
                            className={`py-2.5 px-4 text-right font-extrabold tabular-nums ${
                              mov.delta < 0
                                ? 'text-[#B91C1C]'
                                : mov.delta > 0
                                  ? 'text-[#047857]'
                                  : 'text-[#0F2A36]/70'
                            }`}
                          >
                            {mov.delta > 0 ? '+' : ''}
                            {formatQty(mov.delta)} {mov.unit}
                          </td>
                          <td className="py-2.5 px-4 text-[#0F2A36]/80">{mov.reason}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      {/* SUB-TAB 2: RECETAS (ESCANDALLO) Y DISPONIBILIDAD */}
      {subTab === 'recetas' && (
        <section className="bg-white border border-[#E5DFD3] rounded-2xl overflow-hidden">
          <div className="px-5 py-3.5 bg-[#F2EDE4] border-b border-[#E5DFD3]">
            <h2 className="text-base font-extrabold text-[#0F2A36]">
              Recetas por plato y control de disponibilidad
            </h2>
          </div>

          <ul className="divide-y divide-[#E5DFD3]">
            {state.menu.map((item) => {
              const isEditing = editingMenuItemId === item.id;

              return (
                <li key={item.id} className="p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-base font-extrabold text-[#0F2A36]">{item.name}</p>
                        <span className="px-2 py-0.5 rounded-md bg-[#F2EDE4] text-xs font-semibold text-[#0F2A36]">
                          {item.category}
                        </span>
                        <span className="text-sm font-extrabold text-[#0E7490] tabular-nums">
                          ${item.priceUsd.toFixed(2)}
                        </span>
                      </div>
                      <p className="mt-1 text-xs font-medium text-[#0F2A36]/70 tabular-nums">
                        {item.recipe.length === 0
                          ? 'Sin insumos vinculados (servicio / extra)'
                          : item.recipe
                              .map((line) => {
                                const ing = ingredientById.get(line.ingredientId);
                                return `${formatQty(line.quantity)} ${line.unit} ${ing?.name ?? line.ingredientId}`;
                              })
                              .join(' · ')}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        aria-pressed={item.outOfStock}
                        onClick={() => void toggleMenuOutOfStock(item.id)}
                        className={`min-h-12 px-4 rounded-xl border text-xs font-bold cursor-pointer ${
                          item.outOfStock
                            ? 'bg-[#B91C1C] border-[#B91C1C] text-white'
                            : 'bg-[#047857]/12 border-[#047857]/35 text-[#047857]'
                        }`}
                      >
                        {item.outOfStock ? 'Agotado (Bloqueado)' : 'Disponible'}
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          isEditing
                            ? setEditingMenuItemId(null)
                            : handleStartEditRecipe(item)
                        }
                        className="min-h-12 px-4 rounded-xl border border-[#E5DFD3] bg-[#FAF8F4] hover:bg-[#F2EDE4] text-xs font-bold text-[#0F2A36] cursor-pointer"
                      >
                        {isEditing ? 'Cerrar editor' : 'Editar receta'}
                      </button>
                    </div>
                  </div>

                  {/* Inline Recipe Editor */}
                  {isEditing && (
                    <div className="p-4 rounded-xl bg-[#FAF8F4] border border-[#E5DFD3] space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <h4 className="text-xs font-bold text-[#0F2A36]">
                          Ingredientes del escandallo
                        </h4>
                        <button
                          type="button"
                          onClick={handleAddRecipeRow}
                          className="min-h-12 px-3 rounded-xl border border-[#0E7490]/35 bg-white text-xs font-bold text-[#0E7490] inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Plus className="h-4 w-4" aria-hidden="true" />
                          <span>Agregar ingrediente</span>
                        </button>
                      </div>

                      {draftRecipe.length === 0 ? (
                        <p className="text-xs text-[#0F2A36]/65">
                          Sin ingredientes configurados en esta receta.
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {draftRecipe.map((line, idx) => {
                            const selectedIng = ingredientById.get(line.ingredientId);
                            const units = selectedIng
                              ? getCompatibleUnits(selectedIng.unit)
                              : ALL_UNITS;

                            return (
                              <div
                                key={`${line.ingredientId}-${idx}`}
                                className="grid grid-cols-1 sm:grid-cols-[1fr_110px_110px_48px] gap-2 items-center"
                              >
                                <select
                                  aria-label={`Ingrediente fila ${idx + 1}`}
                                  value={line.ingredientId}
                                  onChange={(e) =>
                                    handleRecipeRowChange(idx, {
                                      ingredientId: e.target.value,
                                    })
                                  }
                                  className="min-h-12 px-3 rounded-xl border border-[#E5DFD3] bg-white text-sm font-semibold"
                                >
                                  {state.ingredients.map((ing) => (
                                    <option key={ing.id} value={ing.id}>
                                      {ing.name} ({ing.unit})
                                    </option>
                                  ))}
                                </select>

                                <input
                                  type="number"
                                  aria-label={`Cantidad fila ${idx + 1}`}
                                  step="0.01"
                                  min="0.01"
                                  value={line.quantity}
                                  onChange={(e) =>
                                    handleRecipeRowChange(idx, {
                                      quantity: Number(e.target.value),
                                    })
                                  }
                                  className="min-h-12 px-3 rounded-xl border border-[#E5DFD3] bg-white text-sm font-bold tabular-nums"
                                />

                                <select
                                  aria-label={`Unidad fila ${idx + 1}`}
                                  value={line.unit}
                                  onChange={(e) =>
                                    handleRecipeRowChange(idx, {
                                      unit: e.target.value as Unit,
                                    })
                                  }
                                  className="min-h-12 px-3 rounded-xl border border-[#E5DFD3] bg-white text-sm font-semibold"
                                >
                                  {units.map((u) => (
                                    <option key={u} value={u}>
                                      {u}
                                    </option>
                                  ))}
                                </select>

                                <button
                                  type="button"
                                  aria-label={`Eliminar fila ${idx + 1}`}
                                  onClick={() => handleRemoveRecipeRow(idx)}
                                  className="min-h-12 min-w-12 rounded-xl border border-[#E5DFD3] bg-white hover:bg-red-50 text-[#B91C1C] flex items-center justify-center cursor-pointer"
                                >
                                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      <div className="flex justify-end gap-2 pt-2">
                        <button
                          type="button"
                          onClick={() => setEditingMenuItemId(null)}
                          className="min-h-12 px-4 rounded-xl border border-[#E5DFD3] bg-white text-xs font-bold text-[#0F2A36] cursor-pointer"
                        >
                          Cancelar
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleSaveRecipe(item)}
                          className="min-h-12 px-4 rounded-xl bg-[#047857] hover:bg-[#065F46] text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <Save className="h-4 w-4" aria-hidden="true" />
                          <span>Guardar receta</span>
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
