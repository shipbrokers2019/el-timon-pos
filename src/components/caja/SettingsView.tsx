import { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  DollarSign,
  Plus,
  Printer,
  RotateCcw,
  Save,
  Users,
  UtensilsCrossed,
} from 'lucide-react';
import { usePos } from '../../store/PosProvider';
import type { MenuCategory, MenuItem, Role, UserProfile } from '../../types/pos';

const CATEGORIES: readonly MenuCategory[] = [
  'Platos',
  'Entradas',
  'Bebidas',
  'Cócteles',
  'Extras',
];

const ROLE_LABELS: Record<Role, string> = {
  mesonero: 'Mesonero',
  cocina: 'Cocina',
  caja_admin: 'Caja / Admin',
};

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString('es-VE', { dateStyle: 'short', timeStyle: 'short' });
}

export function SettingsView() {
  const {
    state,
    updateExchangeRate,
    saveMenuItem,
    saveUser,
    savePrinterConfig,
    createTestPrintJob,
    resetDemoData,
  } = usePos();

  // Exchange rate form
  const [rateInput, setRateInput] = useState<string>(
    String(state.settings.exchangeRate),
  );
  useEffect(() => {
    setRateInput(String(state.settings.exchangeRate));
  }, [state.settings.exchangeRate]);

  // Menu inline edits (price drafts)
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({});
  const [newMenuName, setNewMenuName] = useState('');
  const [newMenuCategory, setNewMenuCategory] = useState<MenuCategory>('Platos');
  const [newMenuPrice, setNewMenuPrice] = useState('');
  const [newMenuSendsToKitchen, setNewMenuSendsToKitchen] = useState(true);

  // New user form
  const [newUserName, setNewUserName] = useState('');
  const [newUserRole, setNewUserRole] = useState<Role>('mesonero');
  const [newUserPin, setNewUserPin] = useState('');

  // Printer config form
  const [restaurantName, setRestaurantName] = useState(
    state.settings.printer.restaurantName,
  );
  const [printerIp, setPrinterIp] = useState(state.settings.printer.ip);
  const [printerPort, setPrinterPort] = useState(String(state.settings.printer.port));
  const [autoPrintKitchen, setAutoPrintKitchen] = useState(
    state.settings.printer.autoPrintFromKitchen,
  );
  const [lanFallback, setLanFallback] = useState(
    state.settings.printer.lanFallbackEnabled,
  );

  useEffect(() => {
    setRestaurantName(state.settings.printer.restaurantName);
    setPrinterIp(state.settings.printer.ip);
    setPrinterPort(String(state.settings.printer.port));
    setAutoPrintKitchen(state.settings.printer.autoPrintFromKitchen);
    setLanFallback(state.settings.printer.lanFallbackEnabled);
  }, [state.settings.printer]);

  const [confirmingReset, setConfirmingReset] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  const handleSaveRate = async () => {
    setErrorMessage(null);
    setFeedbackMessage(null);
    const parsed = Number(rateInput.replace(',', '.'));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setErrorMessage('Ingresa una tasa válida mayor que 0.');
      return;
    }
    try {
      await updateExchangeRate(parsed);
      setFeedbackMessage(
        `Tasa actualizada a 1 USD = ${parsed.toFixed(2)} Bs. Las cuentas ya cerradas conservan su tasa histórica.`,
      );
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Error al actualizar la tasa.');
    }
  };

  const handleSaveMenuPrice = async (item: MenuItem) => {
    setErrorMessage(null);
    setFeedbackMessage(null);
    const raw = priceDrafts[item.id] ?? String(item.priceUsd);
    const parsed = Number(raw.replace(',', '.'));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setErrorMessage(`Precio inválido para ${item.name}.`);
      return;
    }
    try {
      await saveMenuItem({ ...item, priceUsd: parsed });
      setFeedbackMessage(`Precio de "${item.name}" actualizado a $${parsed.toFixed(2)}.`);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'No se pudo actualizar el producto.');
    }
  };

  const handleToggleKitchenFlag = async (item: MenuItem) => {
    setErrorMessage(null);
    try {
      await saveMenuItem({ ...item, sendsToKitchen: !item.sendsToKitchen });
      setFeedbackMessage(
        `"${item.name}" ahora ${!item.sendsToKitchen ? 'envía a cocina' : 'es entrega directa (barra/extra)'}.`,
      );
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'No se pudo actualizar el producto.');
    }
  };

  const handleAddMenuItem = async () => {
    setErrorMessage(null);
    setFeedbackMessage(null);
    const name = newMenuName.trim();
    const price = Number(newMenuPrice.replace(',', '.'));
    if (!name) {
      setErrorMessage('El nombre del producto es obligatorio.');
      return;
    }
    if (!Number.isFinite(price) || price <= 0) {
      setErrorMessage('El precio en USD debe ser mayor que 0.');
      return;
    }
    try {
      await saveMenuItem({
        name,
        category: newMenuCategory,
        priceUsd: price,
        sendsToKitchen: newMenuSendsToKitchen,
        outOfStock: false,
        recipe: [],
      });
      setNewMenuName('');
      setNewMenuPrice('');
      setFeedbackMessage(`Producto "${name}" agregado al menú.`);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'No se pudo agregar el producto.');
    }
  };

  const handleAddUser = async () => {
    setErrorMessage(null);
    setFeedbackMessage(null);
    const name = newUserName.trim();
    const pin = newUserPin.trim();
    if (!name) {
      setErrorMessage('El nombre del usuario es obligatorio.');
      return;
    }
    if (!/^\d{4}$/.test(pin)) {
      setErrorMessage('El PIN debe tener exactamente 4 dígitos numéricos.');
      return;
    }
    try {
      await saveUser({ name, role: newUserRole, pin, active: true });
      setNewUserName('');
      setNewUserPin('');
      setFeedbackMessage(`Usuario "${name}" creado con rol ${ROLE_LABELS[newUserRole]}.`);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'No se pudo crear el usuario.');
    }
  };

  const handleToggleUserActive = async (user: UserProfile) => {
    setErrorMessage(null);
    try {
      await saveUser({ ...user, active: !user.active });
      setFeedbackMessage(
        `Usuario "${user.name}" ${!user.active ? 'activado' : 'desactivado'}.`,
      );
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'No se pudo actualizar el usuario.');
    }
  };

  const handleSavePrinter = async () => {
    setErrorMessage(null);
    setFeedbackMessage(null);
    const port = Number(printerPort);
    if (!restaurantName.trim() || !printerIp.trim() || !Number.isInteger(port) || port <= 0) {
      setErrorMessage('Verifica el nombre del restaurante, IP y puerto TCP.');
      return;
    }
    try {
      await savePrinterConfig({
        restaurantName: restaurantName.trim(),
        ip: printerIp.trim(),
        port,
        autoPrintFromKitchen: autoPrintKitchen,
        lanFallbackEnabled: lanFallback,
      });
      setFeedbackMessage('Configuración de impresora 80 mm guardada.');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'No se pudo guardar la impresora.');
    }
  };

  const handleResetDemo = async () => {
    setErrorMessage(null);
    try {
      await resetDemoData();
      setConfirmingReset(false);
      setFeedbackMessage('Datos de demostración restablecidos correctamente.');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'No se pudo restablecer.');
    }
  };

  return (
    <div className="space-y-6">
      {errorMessage && (
        <p
          role="alert"
          className="p-3.5 rounded-xl bg-red-50 border border-[#B91C1C]/35 text-sm font-semibold text-[#B91C1C] flex items-center gap-2"
        >
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{errorMessage}</span>
        </p>
      )}

      {feedbackMessage && (
        <p
          role="status"
          className="p-3.5 rounded-xl bg-[#047857]/10 border border-[#047857]/35 text-sm font-semibold text-[#047857] flex items-center gap-2"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{feedbackMessage}</span>
        </p>
      )}

      {/* 1. Tasa del día */}
      <section className="bg-white border border-[#E5DFD3] rounded-2xl overflow-hidden">
        <div className="px-5 py-3.5 bg-[#F2EDE4] border-b border-[#E5DFD3] flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-[#0E7490]" aria-hidden="true" />
          <h2 className="text-base font-extrabold text-[#0F2A36]">Tasa del día (Bs / USD)</h2>
        </div>

        <div className="p-5 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-full sm:w-64">
              <label
                htmlFor="exchange-rate-input"
                className="block text-xs font-bold text-[#0F2A36] mb-1"
              >
                Tasa del día (Bs / USD)
              </label>
              <input
                id="exchange-rate-input"
                type="number"
                step="0.01"
                min="0.01"
                value={rateInput}
                onChange={(e) => setRateInput(e.target.value)}
                className="w-full min-h-12 px-3.5 rounded-xl border border-[#E5DFD3] bg-[#FAF8F4] text-base font-extrabold text-[#0F2A36] tabular-nums focus:outline-2 focus:outline-[#0E7490]"
              />
            </div>

            <button
              type="button"
              onClick={() => void handleSaveRate()}
              className="min-h-12 px-5 rounded-xl bg-[#0E7490] hover:bg-[#0B5E75] text-white text-sm font-bold inline-flex items-center gap-2 cursor-pointer"
            >
              <Save className="h-4 w-4" aria-hidden="true" />
              <span>Guardar tasa</span>
            </button>
          </div>

          <p className="text-xs font-medium text-[#0F2A36]/70 tabular-nums">
            Última actualización: {formatTimestamp(state.settings.exchangeRateUpdatedAt)}. Cambiar la tasa actualiza únicamente las cuentas abiertas; las cuentas cerradas mantienen su tasa histórica.
          </p>
        </div>
      </section>

      {/* 2. Menú y Precios */}
      <section className="bg-white border border-[#E5DFD3] rounded-2xl overflow-hidden">
        <div className="px-5 py-3.5 bg-[#F2EDE4] border-b border-[#E5DFD3] flex items-center gap-2">
          <UtensilsCrossed className="h-4 w-4 text-[#0E7490]" aria-hidden="true" />
          <h2 className="text-base font-extrabold text-[#0F2A36]">
            Menú y Precios (Finales USD)
          </h2>
        </div>

        <div className="p-5 space-y-5">
          {/* Add Menu Item */}
          <div className="p-4 rounded-xl bg-[#FAF8F4] border border-[#E5DFD3] space-y-3">
            <h3 className="text-xs font-bold text-[#0F2A36]">Agregar nuevo producto</h3>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div className="sm:col-span-2">
                <label
                  htmlFor="new-menu-name"
                  className="block text-xs font-semibold text-[#0F2A36] mb-1"
                >
                  Nombre
                </label>
                <input
                  id="new-menu-name"
                  type="text"
                  value={newMenuName}
                  onChange={(e) => setNewMenuName(e.target.value)}
                  placeholder="Ej. Empanadas de cazón"
                  className="w-full min-h-12 px-3 rounded-xl border border-[#E5DFD3] bg-white text-sm"
                />
              </div>

              <div>
                <label
                  htmlFor="new-menu-category"
                  className="block text-xs font-semibold text-[#0F2A36] mb-1"
                >
                  Categoría
                </label>
                <select
                  id="new-menu-category"
                  value={newMenuCategory}
                  onChange={(e) => setNewMenuCategory(e.target.value as MenuCategory)}
                  className="w-full min-h-12 px-3 rounded-xl border border-[#E5DFD3] bg-white text-sm font-semibold"
                >
                  {CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="new-menu-price"
                  className="block text-xs font-semibold text-[#0F2A36] mb-1"
                >
                  Precio USD
                </label>
                <input
                  id="new-menu-price"
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={newMenuPrice}
                  onChange={(e) => setNewMenuPrice(e.target.value)}
                  placeholder="0.00"
                  className="w-full min-h-12 px-3 rounded-xl border border-[#E5DFD3] bg-white text-sm font-bold tabular-nums"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="inline-flex items-center gap-2 text-sm font-semibold text-[#0F2A36] cursor-pointer">
                <input
                  type="checkbox"
                  checked={newMenuSendsToKitchen}
                  onChange={(e) => setNewMenuSendsToKitchen(e.target.checked)}
                  className="h-5 w-5 accent-[#0E7490]"
                />
                <span>Enviar a cocina (KDS e impresora 80mm)</span>
              </label>

              <button
                type="button"
                onClick={() => void handleAddMenuItem()}
                className="min-h-12 px-4 rounded-xl bg-[#047857] hover:bg-[#065F46] text-white text-sm font-bold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                <span>Agregar producto</span>
              </button>
            </div>
          </div>

          {/* Menu list */}
          <div className="overflow-x-auto border border-[#E5DFD3] rounded-xl">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-[#FAF8F4] border-b border-[#E5DFD3] text-xs font-bold text-[#0F2A36]/80">
                  <th className="py-2.5 px-4">Producto</th>
                  <th className="py-2.5 px-4">Categoría</th>
                  <th className="py-2.5 px-4">Enviar a cocina</th>
                  <th className="py-2.5 px-4">Precio USD</th>
                  <th className="py-2.5 px-4 text-right">Guardar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5DFD3]">
                {state.menu.map((item) => {
                  const draft = priceDrafts[item.id] ?? String(item.priceUsd);
                  return (
                    <tr key={item.id}>
                      <td className="py-2.5 px-4 font-bold text-[#0F2A36]">{item.name}</td>
                      <td className="py-2.5 px-4 text-xs font-semibold text-[#0F2A36]/75">
                        {item.category}
                      </td>
                      <td className="py-2.5 px-4">
                        <button
                          type="button"
                          aria-pressed={item.sendsToKitchen}
                          onClick={() => void handleToggleKitchenFlag(item)}
                          className={`min-h-12 px-3 rounded-xl border text-xs font-bold cursor-pointer ${
                            item.sendsToKitchen
                              ? 'bg-[#0E7490] border-[#0E7490] text-white'
                              : 'bg-[#FAF8F4] border-[#E5DFD3] text-[#0F2A36]'
                          }`}
                        >
                          {item.sendsToKitchen ? 'Sí — Cocina' : 'No — Directo'}
                        </button>
                      </td>
                      <td className="py-2.5 px-4">
                        <input
                          type="number"
                          aria-label={`Precio USD de ${item.name}`}
                          step="0.01"
                          min="0.01"
                          value={draft}
                          onChange={(e) =>
                            setPriceDrafts((prev) => ({ ...prev, [item.id]: e.target.value }))
                          }
                          className="w-28 min-h-12 px-3 rounded-xl border border-[#E5DFD3] bg-[#FAF8F4] text-sm font-bold tabular-nums"
                        />
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => void handleSaveMenuPrice(item)}
                          className="min-h-12 px-3.5 rounded-xl border border-[#0E7490]/35 bg-[#0E7490]/10 hover:bg-[#0E7490]/20 text-xs font-bold text-[#0E7490] cursor-pointer"
                        >
                          Actualizar
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* 3. Usuarios y PINs */}
      <section className="bg-white border border-[#E5DFD3] rounded-2xl overflow-hidden">
        <div className="px-5 py-3.5 bg-[#F2EDE4] border-b border-[#E5DFD3] flex items-center gap-2">
          <Users className="h-4 w-4 text-[#0E7490]" aria-hidden="true" />
          <h2 className="text-base font-extrabold text-[#0F2A36]">Usuarios y PINs</h2>
        </div>

        <div className="p-5 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end p-4 rounded-xl bg-[#FAF8F4] border border-[#E5DFD3]">
            <div>
              <label
                htmlFor="new-user-name"
                className="block text-xs font-bold text-[#0F2A36] mb-1"
              >
                Nombre
              </label>
              <input
                id="new-user-name"
                type="text"
                value={newUserName}
                onChange={(e) => setNewUserName(e.target.value)}
                placeholder="Ej. Luis (Mesonero)"
                className="w-full min-h-12 px-3 rounded-xl border border-[#E5DFD3] bg-white text-sm"
              />
            </div>

            <div>
              <label
                htmlFor="new-user-role"
                className="block text-xs font-bold text-[#0F2A36] mb-1"
              >
                Rol
              </label>
              <select
                id="new-user-role"
                value={newUserRole}
                onChange={(e) => setNewUserRole(e.target.value as Role)}
                className="w-full min-h-12 px-3 rounded-xl border border-[#E5DFD3] bg-white text-sm font-semibold"
              >
                <option value="mesonero">Mesonero</option>
                <option value="cocina">Cocina</option>
                <option value="caja_admin">Caja / Admin</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="new-user-pin"
                className="block text-xs font-bold text-[#0F2A36] mb-1"
              >
                PIN (4 dígitos)
              </label>
              <input
                id="new-user-pin"
                type="text"
                inputMode="numeric"
                maxLength={4}
                value={newUserPin}
                onChange={(e) => setNewUserPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="4321"
                className="w-full min-h-12 px-3 rounded-xl border border-[#E5DFD3] bg-white text-sm font-bold tabular-nums"
              />
            </div>

            <button
              type="button"
              onClick={() => void handleAddUser()}
              className="min-h-12 px-4 rounded-xl bg-[#047857] hover:bg-[#065F46] text-white text-sm font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span>Crear usuario</span>
            </button>
          </div>

          <ul className="divide-y divide-[#E5DFD3] border border-[#E5DFD3] rounded-xl overflow-hidden">
            {state.users.map((u) => (
              <li
                key={u.id}
                className="px-4 py-3 flex flex-wrap items-center justify-between gap-3 bg-white"
              >
                <div>
                  <p className="text-sm font-bold text-[#0F2A36]">{u.name}</p>
                  <p className="text-xs font-semibold text-[#0F2A36]/70 tabular-nums">
                    Rol: {ROLE_LABELS[u.role]} · PIN: {u.pin}
                  </p>
                </div>

                <button
                  type="button"
                  aria-pressed={u.active}
                  onClick={() => void handleToggleUserActive(u)}
                  className={`min-h-12 px-4 rounded-xl border text-xs font-bold cursor-pointer ${
                    u.active
                      ? 'bg-[#047857]/12 border-[#047857]/35 text-[#047857]'
                      : 'bg-[#B91C1C]/12 border-[#B91C1C]/35 text-[#B91C1C]'
                  }`}
                >
                  {u.active ? 'Activo' : 'Inactivo'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* 4. Impresora Wi-Fi 80 mm */}
      <section className="bg-white border border-[#E5DFD3] rounded-2xl overflow-hidden">
        <div className="px-5 py-3.5 bg-[#F2EDE4] border-b border-[#E5DFD3] flex items-center gap-2">
          <Printer className="h-4 w-4 text-[#0E7490]" aria-hidden="true" />
          <h2 className="text-base font-extrabold text-[#0F2A36]">Impresora Wi-Fi 80 mm</h2>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label
                htmlFor="printer-restaurant-name"
                className="block text-xs font-bold text-[#0F2A36] mb-1"
              >
                Encabezado del restaurante
              </label>
              <input
                id="printer-restaurant-name"
                type="text"
                value={restaurantName}
                onChange={(e) => setRestaurantName(e.target.value)}
                className="w-full min-h-12 px-3 rounded-xl border border-[#E5DFD3] bg-[#FAF8F4] text-sm font-semibold"
              />
            </div>

            <div>
              <label
                htmlFor="printer-ip"
                className="block text-xs font-bold text-[#0F2A36] mb-1"
              >
                Dirección IP LAN
              </label>
              <input
                id="printer-ip"
                type="text"
                value={printerIp}
                onChange={(e) => setPrinterIp(e.target.value)}
                className="w-full min-h-12 px-3 rounded-xl border border-[#E5DFD3] bg-[#FAF8F4] text-sm font-bold tabular-nums"
              />
            </div>

            <div>
              <label
                htmlFor="printer-port"
                className="block text-xs font-bold text-[#0F2A36] mb-1"
              >
                Puerto TCP
              </label>
              <input
                id="printer-port"
                type="number"
                value={printerPort}
                onChange={(e) => setPrinterPort(e.target.value)}
                className="w-full min-h-12 px-3 rounded-xl border border-[#E5DFD3] bg-[#FAF8F4] text-sm font-bold tabular-nums"
              />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-4">
            <label className="inline-flex items-center gap-2 text-sm font-semibold text-[#0F2A36] cursor-pointer">
              <input
                type="checkbox"
                checked={autoPrintKitchen}
                onChange={(e) => setAutoPrintKitchen(e.target.checked)}
                className="h-5 w-5 accent-[#0E7490]"
              />
              <span>Auto-imprimir comandas desde estación Cocina</span>
            </label>

            <label className="inline-flex items-center gap-2 text-sm font-semibold text-[#0F2A36] cursor-pointer">
              <input
                type="checkbox"
                checked={lanFallback}
                onChange={(e) => setLanFallback(e.target.checked)}
                className="h-5 w-5 accent-[#0E7490]"
              />
              <span>Respaldo directo LAN sin internet</span>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              type="button"
              onClick={() => void handleSavePrinter()}
              className="min-h-12 px-5 rounded-xl bg-[#0E7490] hover:bg-[#0B5E75] text-white text-sm font-bold inline-flex items-center gap-2 cursor-pointer"
            >
              <Save className="h-4 w-4" aria-hidden="true" />
              <span>Guardar impresora</span>
            </button>

            <button
              type="button"
              onClick={() => void createTestPrintJob()}
              className="min-h-12 px-5 rounded-xl border border-[#E5DFD3] bg-[#FAF8F4] hover:bg-[#F2EDE4] text-sm font-bold text-[#0F2A36] inline-flex items-center gap-2 cursor-pointer"
            >
              <Printer className="h-4 w-4 text-[#0E7490]" aria-hidden="true" />
              <span>Imprimir ticket de prueba 80mm</span>
            </button>
          </div>
        </div>
      </section>

      {/* 5. Reset Demo Data */}
      <section className="bg-white border border-[#E5DFD3] rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-extrabold text-[#0F2A36]">Datos de demostración</h2>
          <p className="text-xs font-medium text-[#0F2A36]/70">
            Reinicia mesas, toldos, ventas, inventario y configuraciones a su estado inicial de fábrica.
          </p>
        </div>

        {!confirmingReset ? (
          <button
            type="button"
            onClick={() => setConfirmingReset(true)}
            className="min-h-12 px-4 rounded-xl border border-[#B91C1C]/35 bg-red-50 hover:bg-red-100 text-sm font-bold text-[#B91C1C] inline-flex items-center gap-2 cursor-pointer"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            <span>Restablecer datos demo</span>
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-[#B91C1C]">
              ¿Seguro que deseas borrar todo?
            </span>
            <button
              type="button"
              onClick={() => setConfirmingReset(false)}
              className="min-h-12 px-4 rounded-xl border border-[#E5DFD3] bg-white text-xs font-bold text-[#0F2A36] cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void handleResetDemo()}
              className="min-h-12 px-4 rounded-xl bg-[#B91C1C] hover:bg-[#991B1B] text-white text-xs font-bold cursor-pointer"
            >
              Sí, restablecer
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
