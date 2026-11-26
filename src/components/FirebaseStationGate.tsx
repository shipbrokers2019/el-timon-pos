import { useState, type FormEvent } from 'react';
import { AlertCircle, Cloud, Lock } from 'lucide-react';
import { isTabSessionOnlyMode, signInStation } from '../services/firebaseAuth';
import { BrandLogo } from './BrandLogo';

const STATION_PRESETS = [
  { label: 'Caja / Admin', email: 'caja@eltimon.pos' },
  { label: 'Mesonero', email: 'mesonero@eltimon.pos' },
  { label: 'Cocina', email: 'cocina@eltimon.pos' },
] as const;

interface FirebaseStationGateProps {
  externalError?: string | null;
}

export function FirebaseStationGate({ externalError }: FirebaseStationGateProps) {
  const [email, setEmail] = useState('caja@eltimon.pos');
  const [password, setPassword] = useState('');
  const [sessionOnly, setSessionOnly] = useState(() => isTabSessionOnlyMode());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!email.trim() || !password) {
      setError('Ingresa correo y contraseña de la estación.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await signInStation(email, password, { sessionOnly });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error de autenticación.';
      if (msg.includes('auth/invalid-credential') || msg.includes('auth/wrong-password')) {
        setError('Correo o contraseña incorrectos.');
      } else if (msg.includes('auth/network-request-failed')) {
        setError('Sin conexión a internet para activar esta tablet por primera vez.');
      } else {
        setError(msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const displayError = error ?? externalError;

  return (
    <main className="min-h-screen bg-[#FAF8F4] text-[#0F2A36] flex items-center justify-center p-4">
      <section className="w-full max-w-md bg-[#F2EDE4] border border-[#0F2A36]/15 rounded-2xl p-6 sm:p-8 shadow-sm space-y-6">
        <header className="text-center space-y-2">
          <div className="flex justify-center">
            <BrandLogo size="lg" />
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-[#0F2A36]">
            El Timón Restaurante
          </h1>
          <p className="text-sm font-medium text-[#0F2A36]/75 inline-flex items-center gap-1.5">
            <Cloud className="h-4 w-4 text-[#0E7490]" aria-hidden="true" />
            <span>Activa esta tablet una sola vez para sincronizar en la nube</span>
          </p>
        </header>

        <div className="space-y-2">
          <p className="text-xs font-bold text-[#0F2A36]/75">Estación rápida:</p>
          <div className="grid grid-cols-3 gap-2">
            {STATION_PRESETS.map((preset) => {
              const selected = email.toLowerCase() === preset.email;
              return (
                <button
                  key={preset.email}
                  type="button"
                  onClick={() => {
                    setEmail(preset.email);
                    setError(null);
                  }}
                  className={`min-h-12 px-2 rounded-xl border text-xs font-bold transition-colors cursor-pointer ${
                    selected
                      ? 'bg-[#0E7490] border-[#0E7490] text-white'
                      : 'bg-white border-[#0F2A36]/15 text-[#0F2A36] hover:bg-[#FAF8F4]'
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div>
            <label htmlFor="station-email" className="block text-xs font-bold text-[#0F2A36] mb-1">
              Correo de estación
            </label>
            <input
              id="station-email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full min-h-12 px-3.5 rounded-xl bg-white border border-[#0F2A36]/20 text-sm font-semibold text-[#0F2A36] focus:outline-2 focus:outline-[#0E7490]"
            />
          </div>

          <div>
            <label
              htmlFor="station-password"
              className="block text-xs font-bold text-[#0F2A36] mb-1"
            >
              Contraseña de estación
            </label>
            <input
              id="station-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Ingresa la contraseña de activación"
              className="w-full min-h-12 px-3.5 rounded-xl bg-white border border-[#0F2A36]/20 text-sm font-semibold text-[#0F2A36] focus:outline-2 focus:outline-[#0E7490]"
            />
          </div>

          <label className="flex items-start gap-2.5 p-3 rounded-xl bg-white/80 border border-[#0F2A36]/15 text-xs font-semibold text-[#0F2A36] cursor-pointer">
            <input
              type="checkbox"
              checked={sessionOnly}
              onChange={(e) => setSessionOnly(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[#0E7490] shrink-0"
            />
            <span>
              Solo en esta pestaña{' '}
              <span className="font-normal text-[#0F2A36]/70">
                (actívalo si estás probando Caja, Mesonero y Cocina a la vez en el mismo navegador)
              </span>
            </span>
          </label>

          {displayError && (
            <p
              role="alert"
              className="p-3 rounded-xl bg-red-50 border border-[#B91C1C]/35 text-xs font-semibold text-[#B91C1C] flex items-start gap-2"
            >
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{displayError}</span>
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full min-h-12 px-5 rounded-xl bg-[#0E7490] hover:bg-[#0B5E75] disabled:opacity-50 text-white text-sm font-bold inline-flex items-center justify-center gap-2 cursor-pointer"
          >
            <Lock className="h-4 w-4" aria-hidden="true" />
            <span>{submitting ? 'Activando estación...' : 'Activar Estación'}</span>
          </button>
        </form>
      </section>
    </main>
  );
}
