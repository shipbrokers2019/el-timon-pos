import { useEffect } from 'react';
import { Printer, X } from 'lucide-react';
import { usePos } from '../store/PosProvider';
import type { PrintJob, PrintStatus } from '../types/pos';

interface TicketPreviewModalProps {
  job?: PrintJob | null;
  onClose?: () => void;
}

const PRINT_STATUS_BADGE: Record<PrintStatus, { label: string; className: string }> = {
  printed: { label: 'Impresa', className: 'bg-[#047857] text-white' },
  printed_locally: { label: 'Impresa local LAN', className: 'bg-[#0E7490] text-white' },
  pending: { label: 'Pendiente', className: 'bg-[#B45309] text-white' },
  printing: { label: 'Pendiente', className: 'bg-[#B45309] text-white' },
  failed: { label: 'Error', className: 'bg-[#B91C1C] text-white' },
};

export function TicketPreviewModal({ job, onClose }: TicketPreviewModalProps) {
  const { activeTicketPreview, dismissTicketPreview } = usePos();
  const resolvedJob = job !== undefined ? job : activeTicketPreview;
  const handleClose = onClose ?? dismissTicketPreview;

  useEffect(() => {
    if (!resolvedJob) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        handleClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [resolvedJob, handleClose]);

  if (!resolvedJob) {
    return null;
  }

  const badge = PRINT_STATUS_BADGE[resolvedJob.status];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="ticket-preview-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <div className="w-full max-w-md bg-[#FAF8F4] text-[#0F2A36] border border-[#0F2A36]/20 rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-5 py-4 bg-[#F2EDE4] border-b border-[#0F2A36]/15 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 id="ticket-preview-title" className="text-base font-bold truncate">
              {resolvedJob.title}
            </h2>
            <div className="mt-1 flex items-center gap-2">
              <span
                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold ${badge.className}`}
              >
                {badge.label}
              </span>
              {resolvedJob.error && (
                <span className="text-xs font-medium text-[#B91C1C] truncate">
                  {resolvedJob.error}
                </span>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={handleClose}
            aria-label="Cerrar vista previa"
            className="min-h-12 min-w-12 rounded-xl border border-[#0F2A36]/20 bg-[#FAF8F4] hover:bg-white flex items-center justify-center text-[#0F2A36] cursor-pointer"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto flex justify-center bg-[#E7E0D4]">
          <pre
            id="thermal-ticket-print-area"
            className="font-mono text-[11px] leading-[1.35] bg-white text-[#0F172A] border border-slate-300 rounded-md p-4 shadow-sm whitespace-pre overflow-x-auto"
          >
            {resolvedJob.textPreview}
          </pre>
        </div>

        <div className="px-5 py-4 bg-[#F2EDE4] border-t border-[#0F2A36]/15 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={handleClose}
            className="min-h-12 px-4 rounded-xl border border-[#0F2A36]/20 bg-[#FAF8F4] hover:bg-white text-sm font-semibold text-[#0F2A36] cursor-pointer"
          >
            Cerrar
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="min-h-12 px-4 rounded-xl bg-[#0E7490] hover:bg-[#0B5E75] text-sm font-bold text-white inline-flex items-center gap-2 cursor-pointer"
          >
            <Printer className="h-4 w-4" aria-hidden="true" />
            <span>Imprimir navegador (80mm)</span>
          </button>
        </div>
      </div>
    </div>
  );
}
