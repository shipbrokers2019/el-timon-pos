import { Cloud, HardDrive, LogOut, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { isFirebaseConfigured } from '../services/firebaseRepository';
import { usePos } from '../store/PosProvider';
import type { Role } from '../types/pos';

const ROLE_LABELS: Record<Role, string> = {
  mesonero: 'Mesonero',
  cocina: 'Cocina KDS',
  caja_admin: 'Caja / Admin',
};

export function StatusBanner() {
  const {
    currentUser,
    isOnline,
    isOfflineSimulated,
    pendingSyncCount,
    setOfflineSimulation,
    logout,
  } = usePos();

  if (!currentUser) {
    return null;
  }

  const isKitchen = currentUser.role === 'cocina';
  const firebaseEnabled = isFirebaseConfigured();

  return (
    <header
      className={`border-b px-4 py-2.5 ${
        isKitchen
          ? 'bg-[#1F2937] text-white border-white/15'
          : 'bg-[#F2EDE4] text-[#0F2A36] border-[#0F2A36]/15'
      }`}
    >
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="font-bold text-sm sm:text-base">{currentUser.name}</span>
          <span
            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold ${
              isKitchen
                ? 'bg-white/15 text-white'
                : 'bg-[#0E7490] text-white'
            }`}
          >
            {ROLE_LABELS[currentUser.role]}
          </span>

          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
              isOnline
                ? 'bg-[#047857] text-white'
                : 'bg-[#B45309] text-white'
            }`}
          >
            {isOnline ? (
              <Wifi className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            <span>{isOnline ? 'En línea' : 'Sin Wi-Fi — Modo Offline'}</span>
          </span>

          {pendingSyncCount > 0 && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-[#B45309] text-white tabular-nums">
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{pendingSyncCount} pendiente(s)</span>
            </span>
          )}

          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${
              isKitchen
                ? 'border-white/20 text-slate-200'
                : 'border-[#0F2A36]/20 text-[#0F2A36]/80 bg-[#FAF8F4]'
            }`}
          >
            {firebaseEnabled ? (
              <Cloud className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <HardDrive className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            <span>{firebaseEnabled ? 'Firebase Nube' : 'Local Multi-Pestaña'}</span>
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-pressed={isOfflineSimulated}
            onClick={() => setOfflineSimulation(!isOfflineSimulated)}
            className={`min-h-12 px-3.5 rounded-xl border text-xs sm:text-sm font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
              isOfflineSimulated
                ? 'bg-[#B45309] border-[#B45309] text-white'
                : isKitchen
                  ? 'bg-white/10 border-white/20 text-white hover:bg-white/20'
                  : 'bg-[#FAF8F4] border-[#0F2A36]/20 text-[#0F2A36] hover:bg-white'
            }`}
          >
            <WifiOff className="h-4 w-4" aria-hidden="true" />
            <span>Simular corte Wi-Fi</span>
          </button>

          <button
            type="button"
            onClick={logout}
            className={`min-h-12 px-3.5 rounded-xl border text-xs sm:text-sm font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
              isKitchen
                ? 'bg-white/10 border-white/20 text-white hover:bg-white/20'
                : 'bg-[#FAF8F4] border-[#0F2A36]/20 text-[#0F2A36] hover:bg-white'
            }`}
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            <span>Cambiar PIN / Salir</span>
          </button>
        </div>
      </div>
    </header>
  );
}
