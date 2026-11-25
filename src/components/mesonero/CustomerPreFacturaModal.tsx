import { useEffect } from 'react';
import { X } from 'lucide-react';
import type { PreFacturaSnapshot } from '../../types/pos';
import { BrandLogo } from '../BrandLogo';

interface CustomerPreFacturaModalProps {
  preFactura: PreFacturaSnapshot;
  onClose: () => void;
}

export function CustomerPreFacturaModal({
  preFactura,
  onClose,
}: CustomerPreFacturaModalProps) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const formattedDate = new Date(preFactura.generatedAt).toLocaleString('es-VE', {
    dateStyle: 'short',
    timeStyle: 'short',
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Pre-factura ${preFactura.locationLabel}`}
      className="fixed inset-0 z-50 bg-[#0F2A36]/75 p-4 flex items-center justify-center overflow-y-auto"
    >
      <div className="w-full max-w-md bg-[#FAF8F4] text-[#0F2A36] border border-[#0F2A36]/20 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-6 py-5 bg-[#0E7490] text-white flex items-center justify-between gap-3">
          <div className="flex items-center gap-3.5 min-w-0">
            <BrandLogo size="md" className="ring-2 ring-white/40" />
            <div className="space-y-0.5 min-w-0">
              <h2 className="text-xl font-extrabold tracking-tight truncate">
                {preFactura.restaurantName}
              </h2>
              <p className="text-sm font-bold text-white/90">
                Pre-factura · {preFactura.locationLabel}
              </p>
              <p className="text-xs font-medium text-white/75 tabular-nums">
                Emitida: {formattedDate}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar pre-factura"
            className="min-h-12 min-w-12 rounded-xl bg-white/15 hover:bg-white/25 text-white flex items-center justify-center cursor-pointer"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* Itemized list */}
        <div className="p-6 overflow-y-auto space-y-5">
          <div className="bg-white border border-[#E5DFD3] rounded-2xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#F2EDE4] text-[#0F2A36]/75 text-xs font-bold border-b border-[#E5DFD3]">
                  <th className="py-2.5 px-3 text-left">Cant.</th>
                  <th className="py-2.5 px-3 text-left">Consumo</th>
                  <th className="py-2.5 px-3 text-right">Total USD</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5DFD3]">
                {preFactura.items.map((item) => (
                  <tr key={item.id}>
                    <td className="py-3 px-3 font-extrabold text-[#0E7490] tabular-nums">
                      {item.quantity}x
                    </td>
                    <td className="py-3 px-3">
                      <p className="font-bold text-[#0F2A36] leading-snug">{item.name}</p>
                      <p className="text-xs text-[#0F2A36]/60 tabular-nums">
                        ${item.unitPriceUsd.toFixed(2)} c/u
                      </p>
                    </td>
                    <td className="py-3 px-3 text-right font-extrabold text-[#0F2A36] tabular-nums">
                      ${item.subtotalUsd.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Grand Totals */}
          <div className="p-5 rounded-2xl bg-[#F2EDE4] border border-[#0F2A36]/15 space-y-2.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-bold text-[#0F2A36]/80">Total a pagar (USD)</span>
              <span className="text-3xl font-extrabold text-[#0F2A36] tabular-nums">
                ${preFactura.totalUsd.toFixed(2)}
              </span>
            </div>
            <div className="pt-2 border-t border-[#0F2A36]/15 flex items-baseline justify-between gap-2">
              <span className="text-sm font-bold text-[#0F2A36]/80">Total en Bolívares</span>
              <span className="text-xl font-extrabold text-[#0E7490] tabular-nums">
                Bs {preFactura.totalBs.toFixed(2)}
              </span>
            </div>
            <p className="text-xs font-medium text-[#0F2A36]/65 tabular-nums text-right">
              Tasa BCV aplicada: {preFactura.exchangeRate.toFixed(2)} Bs/USD
            </p>
          </div>

          <p className="text-center text-xs font-semibold text-[#0F2A36]/65">
            Documento informativo no fiscal · Gracias por su visita
          </p>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-[#F2EDE4] border-t border-[#0F2A36]/15">
          <button
            type="button"
            onClick={onClose}
            className="w-full min-h-12 px-5 rounded-xl bg-[#0F2A36] hover:bg-[#0F2A36]/90 text-white text-sm font-bold cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
