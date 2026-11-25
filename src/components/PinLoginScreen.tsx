import { useCallback, useEffect, useState } from 'react';
import { Delete, Lock, LogOut, Unlock } from 'lucide-react';
import { signOutStation } from '../services/firebaseAuth';
import { isFirebaseConfigured } from '../services/firebaseRepository';
import { usePos } from '../store/PosProvider';
import type { Role } from '../types/pos';
import { BrandLogo } from './BrandLogo';

const STATION_ROLE_LABELS: Record<Role, string> = {
  mesonero: 'Mesonero',
  cocina: 'Cocina',
  caja_admin: 'Caja / Admin',
};

const KEYPAD_DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

export function PinLoginScreen() {
  const { state, lockedStationRole, setLockedStationRole, loginWithPin } = usePos();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showLockOptions, setShowLockOptions] = useState<boolean>(lockedStationRole !== null);

  const restaurantName = state.settings.printer.restaurantName;

  const attemptLogin = useCallback(
    (candidatePin: string) => {
      const matched = loginWithPin(candidatePin);
      if (!matched) {
        setError('PIN inválido o usuario inactivo');
        setPin('');
        return;
      }
      setError(null);
      setPin('');
    },
    [loginWithPin],
  );

  const handleDigit = useCallback((digit: string) => {
    setError(null);
    setPin((prev) => (prev.length >= 4 ? prev : `${prev}${digit}`));
  }, []);

  useEffect(() => {
    if (pin.length === 4) {
      attemptLogin(pin);
    }
  }, [pin, attemptLogin]);

  const handleBackspace = useCallback(() => {
    setError(null);
    setPin((prev) => prev.slice(0, -1));
  }, []);

  const handleClear = useCallback(() => {
    setError(null);
    setPin('');
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key >= '0' && event.key <= '9') {
        event.preventDefault();
        handleDigit(event.key);
      } else if (event.key === 'Backspace') {
        event.preventDefault();
        handleBackspace();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        handleClear();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleBackspace, handleClear, handleDigit]);

  const handleToggleStationLock = () => {
    if (showLockOptions) {
      setShowLockOptions(false);
      setLockedStationRole(null);
    } else {
      setShowLockOptions(true);
      if (!lockedStationRole) {
        setLockedStationRole('mesonero');
      }
    }
  };

  return (
    <main className="min-h-screen bg-[#FAF8F4] text-[#0F2A36] flex flex-col items-center justify-center px-4 py-8">
      <section className="w-full max-w-md bg-[#F2EDE4] border border-[#0F2A36]/15 rounded-2xl p-6 sm:p-8 shadow-sm">
        <header className="text-center mb-6">
          <div className="mb-3 flex justify-center">
            <BrandLogo size="lg" />
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-[#0F2A36]">
            {restaurantName}
          </h1>
          <p className="mt-1.5 text-sm font-medium text-[#0F2A36]/75">
            Ingresa tu PIN de 4 dígitos para acceder a tu estación
          </p>
          {lockedStationRole && (
            <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#0E7490]/12 border border-[#0E7490]/30 text-xs font-semibold text-[#0E7490]">
              <Lock className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Estación fija: {STATION_ROLE_LABELS[lockedStationRole]}</span>
            </div>
          )}
        </header>

        {/* Visual 4-digit PIN dots */}
        <div
          className="flex items-center justify-center gap-4 mb-4"
          role="status"
          aria-label={`PIN ingresado: ${pin.length} de 4 dígitos`}
        >
          {[0, 1, 2, 3].map((slot) => {
            const filled = slot < pin.length;
            return (
              <span
                key={slot}
                className={`h-4 w-4 rounded-full border transition-colors duration-150 ${
                  filled
                    ? 'bg-[#0E7490] border-[#0E7490]'
                    : 'bg-[#FAF8F4] border-[#0F2A36]/30'
                }`}
              />
            );
          })}
        </div>

        {/* Error feedback */}
        <div className="min-h-6 mb-4 text-center">
          {error && (
            <p
              role="alert"
              className="text-sm font-semibold text-[#B91C1C]"
            >
              {error}
            </p>
          )}
        </div>

        {/* Tactile 4-digit keypad (>= 56px buttons) */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          {KEYPAD_DIGITS.map((digit) => (
            <button
              key={digit}
              type="button"
              onClick={() => handleDigit(digit)}
              className="min-h-14 rounded-xl bg-[#FAF8F4] hover:bg-white active:bg-[#0E7490]/10 border border-[#0F2A36]/15 text-xl font-bold text-[#0F2A36] tabular-nums transition-colors focus-visible:outline-2 focus-visible:outline-[#0E7490] cursor-pointer"
            >
              {digit}
            </button>
          ))}

          <button
            type="button"
            onClick={handleClear}
            className="min-h-14 rounded-xl bg-[#FAF8F4] hover:bg-white active:bg-[#0F2A36]/10 border border-[#0F2A36]/15 text-sm font-semibold text-[#0F2A36]/80 transition-colors focus-visible:outline-2 focus-visible:outline-[#0E7490] cursor-pointer"
          >
            Limpiar
          </button>

          <button
            type="button"
            onClick={() => handleDigit('0')}
            className="min-h-14 rounded-xl bg-[#FAF8F4] hover:bg-white active:bg-[#0E7490]/10 border border-[#0F2A36]/15 text-xl font-bold text-[#0F2A36] tabular-nums transition-colors focus-visible:outline-2 focus-visible:outline-[#0E7490] cursor-pointer"
          >
            0
          </button>

          <button
            type="button"
            aria-label="Borrar último dígito"
            onClick={handleBackspace}
            className="min-h-14 rounded-xl bg-[#FAF8F4] hover:bg-white active:bg-[#0F2A36]/10 border border-[#0F2A36]/15 flex items-center justify-center text-[#0F2A36]/80 transition-colors focus-visible:outline-2 focus-visible:outline-[#0E7490] cursor-pointer"
          >
            <Delete className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* Station lock optional selector */}
        <div className="pt-4 border-t border-[#0F2A36]/15">
          <button
            type="button"
            aria-pressed={showLockOptions}
            onClick={handleToggleStationLock}
            className="w-full min-h-12 px-4 rounded-xl border border-[#0F2A36]/15 bg-[#FAF8F4] hover:bg-white flex items-center justify-between text-sm font-semibold text-[#0F2A36] transition-colors cursor-pointer"
          >
            <span className="flex items-center gap-2">
              {showLockOptions ? (
                <Lock className="h-4 w-4 text-[#0E7490]" aria-hidden="true" />
              ) : (
                <Unlock className="h-4 w-4 text-[#0F2A36]/65" aria-hidden="true" />
              )}
              <span>Fijar esta tablet como estación</span>
            </span>
            <span className="text-xs font-semibold text-[#0E7490]">
              {showLockOptions ? 'Activa' : 'Opcional'}
            </span>
          </button>

          {showLockOptions && (
            <div className="mt-3 grid grid-cols-3 gap-2" role="group" aria-label="Seleccionar estación fija">
              {(['mesonero', 'cocina', 'caja_admin'] as const).map((role) => {
                const selected = lockedStationRole === role;
                return (
                  <button
                    key={role}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => {
                      setError(null);
                      setLockedStationRole(role);
                    }}
                    className={`min-h-12 px-2 rounded-xl border text-xs font-bold transition-colors cursor-pointer ${
                      selected
                        ? 'bg-[#0E7490] border-[#0E7490] text-white'
                        : 'bg-[#FAF8F4] border-[#0F2A36]/15 text-[#0F2A36] hover:bg-white'
                    }`}
                  >
                    {STATION_ROLE_LABELS[role]}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Quick-reference demo hint footer */}
        <footer className="mt-5 pt-4 border-t border-[#0F2A36]/15 text-center space-y-2.5">
          <p className="text-xs font-medium text-[#0F2A36]/75 leading-relaxed tabular-nums">
            PINs demo — Mesonero: <strong className="text-[#0F2A36]">1111</strong> · Cocina:{' '}
            <strong className="text-[#0F2A36]">2222</strong> · Caja/Admin:{' '}
            <strong className="text-[#0F2A36]">0000</strong>
          </p>
          {isFirebaseConfigured() && (
            <button
              type="button"
              onClick={() => void signOutStation()}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0E7490] hover:underline cursor-pointer"
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Cambiar estación en la nube</span>
            </button>
          )}
        </footer>
      </section>
    </main>
  );
}
