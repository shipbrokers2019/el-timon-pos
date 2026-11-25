import { useMemo, useState } from 'react';
import {
  BarChart3,
  ClipboardCheck,
  DollarSign,
  LayoutGrid,
  Package,
  Pencil,
  RefreshCw,
  Settings,
} from 'lucide-react';
import { getLowStockIngredients } from '../../domain/recipes';
import { usePos } from '../../store/PosProvider';
import { AnalyticsView } from './AnalyticsView';
import { CajaFloorView } from './CajaFloorView';
import { CashCloseView } from './CashCloseView';
import { InventoryRecipesView } from './InventoryRecipesView';
import { SettingsView } from './SettingsView';

type CajaSection = 'floor' | 'cash_close' | 'inventory' | 'analytics' | 'settings';

export function CajaLayout() {
  const { state, isOnline, isSyncingBcvRate, syncBcvRate } = usePos();
  const [activeSection, setActiveSection] = useState<CajaSection>('floor');

  const openAccountsCount = useMemo(
    () => state.locations.filter((loc) => loc.status !== 'libre').length,
    [state.locations],
  );

  const porCobrarCount = useMemo(
    () => state.locations.filter((loc) => loc.status === 'por_cobrar').length,
    [state.locations],
  );

  const lowStockCount = useMemo(
    () => getLowStockIngredients(state.ingredients).length,
    [state.ingredients],
  );

  const navItems: ReadonlyArray<{
    id: CajaSection;
    label: string;
    icon: typeof LayoutGrid;
    badge?: { text: string; tone: 'teal' | 'amber' | 'crimson' };
  }> = [
    {
      id: 'floor',
      label: 'Cuadrícula y Cobros',
      icon: LayoutGrid,
      badge:
        porCobrarCount > 0
          ? { text: `${porCobrarCount} por cobrar`, tone: 'amber' }
          : openAccountsCount > 0
            ? { text: String(openAccountsCount), tone: 'teal' }
            : undefined,
    },
    {
      id: 'cash_close',
      label: 'Cierre de Caja',
      icon: ClipboardCheck,
    },
    {
      id: 'inventory',
      label: 'Inventario y Recetas',
      icon: Package,
      badge:
        lowStockCount > 0
          ? { text: String(lowStockCount), tone: 'crimson' }
          : undefined,
    },
    {
      id: 'analytics',
      label: 'Estadísticas',
      icon: BarChart3,
    },
    {
      id: 'settings',
      label: 'Configuración',
      icon: Settings,
    },
  ];

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-[#FAF8F4] text-[#0F2A36]">
      {/* Caja sub-header with exchange rate & navigation */}
      <div className="bg-[#F2EDE4] border-b border-[#E5DFD3] px-4 py-3">
        <div className="max-w-7xl mx-auto flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-lg sm:text-xl font-extrabold tracking-tight text-[#0F2A36]">
              Caja y Administración · {state.settings.printer.restaurantName}
            </h1>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveSection('settings')}
                title="Editar tasa del día en Configuración"
                className="min-h-12 px-3.5 rounded-xl bg-white border border-[#E5DFD3] hover:border-[#0E7490] inline-flex items-center gap-2 text-xs sm:text-sm font-bold text-[#0F2A36] tabular-nums transition-colors cursor-pointer"
              >
                <DollarSign className="h-4 w-4 text-[#0E7490]" aria-hidden="true" />
                <span>
                  Tasa BCV:{' '}
                  <strong className="text-[#0E7490]">
                    1 USD = {state.settings.exchangeRate.toFixed(2)} Bs
                  </strong>
                </span>
                {state.settings.exchangeRateSource && (
                  <span className="hidden sm:inline px-2 py-0.5 rounded-full bg-[#0E7490]/10 text-[#0E7490] text-[11px] font-bold">
                    {state.settings.exchangeRateSource}
                  </span>
                )}
                <Pencil className="h-3.5 w-3.5 text-[#0F2A36]/60" aria-hidden="true" />
              </button>

              <button
                type="button"
                disabled={!isOnline || isSyncingBcvRate}
                onClick={() => void syncBcvRate()}
                aria-label="Actualizar tasa desde BCV ahora"
                title="Actualizar tasa oficial BCV"
                className="min-h-12 px-3 rounded-xl bg-white border border-[#E5DFD3] hover:border-[#0E7490] disabled:opacity-50 text-[#0E7490] text-xs font-bold inline-flex items-center gap-1.5 transition-colors cursor-pointer disabled:cursor-not-allowed"
              >
                <RefreshCw
                  className={`h-4 w-4 ${isSyncingBcvRate ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                <span className="hidden md:inline">
                  {isSyncingBcvRate ? 'Actualizando...' : 'Actualizar BCV'}
                </span>
              </button>
            </div>
          </div>

          <nav
            aria-label="Navegación de Caja y Administración"
            className="flex flex-wrap items-center gap-2"
          >
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeSection === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-current={isActive ? 'page' : undefined}
                  onClick={() => setActiveSection(item.id)}
                  className={`min-h-12 px-4 rounded-xl border text-sm font-bold inline-flex items-center gap-2 transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-[#0E7490] border-[#0E7490] text-white'
                      : 'bg-white border-[#E5DFD3] text-[#0F2A36] hover:bg-[#FAF8F4]'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{item.label}</span>
                  {item.badge && (
                    <span
                      className={`px-2 py-0.5 rounded-full text-[11px] font-extrabold tabular-nums ${
                        isActive
                          ? 'bg-white/20 text-white'
                          : item.badge.tone === 'amber'
                            ? 'bg-[#B45309] text-white'
                            : item.badge.tone === 'crimson'
                              ? 'bg-[#B91C1C] text-white'
                              : 'bg-[#0E7490]/15 text-[#0E7490]'
                      }`}
                    >
                      {item.badge.text}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Active Admin Section */}
      <main className="max-w-7xl mx-auto p-4 sm:p-6">
        {activeSection === 'floor' && <CajaFloorView />}
        {activeSection === 'cash_close' && <CashCloseView />}
        {activeSection === 'inventory' && <InventoryRecipesView />}
        {activeSection === 'analytics' && <AnalyticsView />}
        {activeSection === 'settings' && <SettingsView />}
      </main>
    </div>
  );
}
