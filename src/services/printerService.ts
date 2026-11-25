import { buildEscPosBytes, type TicketPayload } from '../domain/escpos';
import type { PrintJob, PrinterConfig, PrintStatus } from '../types/pos';

export interface TcpPrintTransport {
  send(ip: string, port: number, data: Uint8Array): Promise<void>;
}

interface CapacitorThermalPrinterPlugin {
  send?(options: { ip: string; port: number; data: string }): Promise<void>;
  print?(options: { ip: string; port: number; bytes: number[] }): Promise<void>;
}

interface WindowWithCapacitor extends Window {
  Capacitor?: {
    Plugins?: {
      ThermalPrinter?: CapacitorThermalPrinterPlugin;
    };
  };
}

export interface PrintCoordinatorOptions {
  transport?: TcpPrintTransport;
  onPreviewTicket?: (job: PrintJob) => void;
  onJobStatusChange?: (
    jobId: string,
    status: PrintStatus,
    meta?: { printedAt?: string; error?: string },
  ) => void | Promise<void>;
  initiallyPrintedIds?: Iterable<string>;
}

export interface PrintExecutionParams {
  job: PrintJob;
  config: PrinterConfig;
  payload?: TicketPayload;
  isCloudOffline?: boolean;
  forceReprint?: boolean;
}

export interface PrintExecutionResult {
  jobId: string;
  status: PrintStatus;
  skipped: boolean;
  usedLanFallback: boolean;
  printedAt?: string;
  error?: string;
}

function encodePreviewAsEscPos(textPreview: string): Uint8Array {
  const bytes: number[] = [0x1b, 0x40];
  for (let i = 0; i < textPreview.length; i += 1) {
    const code = textPreview.charCodeAt(i);
    bytes.push(code === 0x0a || (code >= 0x20 && code <= 0x7e) ? code : 0x3f);
  }
  bytes.push(0x0a, 0x0a, 0x0a, 0x0a, 0x1d, 0x56, 0x42, 0x00);
  return new Uint8Array(bytes);
}

function bytesToBase64(data: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < data.length; i += 1) {
    binary += String.fromCharCode(data[i]);
  }
  return typeof btoa === 'function' ? btoa(binary) : '';
}

function resolveCapacitorTransport(): TcpPrintTransport | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const plugin = (window as WindowWithCapacitor).Capacitor?.Plugins?.ThermalPrinter;
  if (!plugin) {
    return null;
  }

  return {
    async send(ip: string, port: number, data: Uint8Array): Promise<void> {
      if (typeof plugin.send === 'function') {
        await plugin.send({ ip, port, data: bytesToBase64(data) });
        return;
      }
      if (typeof plugin.print === 'function') {
        await plugin.print({ ip, port, bytes: Array.from(data) });
        return;
      }
      throw new Error('ThermalPrinter plugin does not expose send() or print()');
    },
  };
}

/**
 * Serializes 80mm thermal printer jobs over a single FIFO queue, prevents duplicate tickets
 * by printJobId, and supports direct-LAN fallback during ISP cloud outages.
 */
export class PrintCoordinator {
  private readonly explicitTransport?: TcpPrintTransport;
  private readonly onPreviewTicket?: (job: PrintJob) => void;
  private readonly onJobStatusChange?: PrintCoordinatorOptions['onJobStatusChange'];
  private readonly printedJobIds: Set<string>;
  private queue: Promise<void> = Promise.resolve();

  constructor(options: PrintCoordinatorOptions = {}) {
    this.explicitTransport = options.transport;
    this.onPreviewTicket = options.onPreviewTicket;
    this.onJobStatusChange = options.onJobStatusChange;
    this.printedJobIds = new Set(options.initiallyPrintedIds ?? []);
  }

  hasPrinted(jobId: string): boolean {
    return this.printedJobIds.has(jobId);
  }

  markPrinted(jobId: string): void {
    this.printedJobIds.add(jobId);
  }

  printJob(params: PrintExecutionParams): Promise<PrintExecutionResult> {
    const task = this.queue.then(() => this.executeJob(params));
    // Keep queue alive even if a single task rejects unexpectedly
    this.queue = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  private async executeJob(params: PrintExecutionParams): Promise<PrintExecutionResult> {
    const { job, config, payload, isCloudOffline = false, forceReprint = false } = params;

    const alreadyCompleted =
      this.printedJobIds.has(job.id) ||
      job.status === 'printed' ||
      job.status === 'printed_locally';

    if (alreadyCompleted && !forceReprint) {
      this.printedJobIds.add(job.id);
      return {
        jobId: job.id,
        status: job.status === 'printed_locally' ? 'printed_locally' : 'printed',
        skipped: true,
        usedLanFallback: false,
      };
    }

    if (isCloudOffline && !config.lanFallbackEnabled) {
      const error = 'Sin conexión a la nube y respaldo LAN deshabilitado';
      await this.onJobStatusChange?.(job.id, 'failed', { error });
      return {
        jobId: job.id,
        status: 'failed',
        skipped: false,
        usedLanFallback: false,
        error,
      };
    }

    const bytes = payload
      ? buildEscPosBytes(payload)
      : encodePreviewAsEscPos(job.textPreview);

    const transport = this.explicitTransport ?? resolveCapacitorTransport();
    const targetStatus: PrintStatus = isCloudOffline ? 'printed_locally' : 'printed';
    const usedLanFallback = isCloudOffline && config.lanFallbackEnabled;

    try {
      if (transport) {
        await transport.send(config.ip, config.port, bytes);
      }

      const printedAt = new Date().toISOString();
      this.printedJobIds.add(job.id);
      const completedJob: PrintJob = {
        ...job,
        status: targetStatus,
        printedAt,
        error: undefined,
      };

      this.onPreviewTicket?.(completedJob);
      await this.onJobStatusChange?.(job.id, targetStatus, { printedAt });

      return {
        jobId: job.id,
        status: targetStatus,
        skipped: false,
        usedLanFallback,
        printedAt,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Error de impresión TCP 9100';
      await this.onJobStatusChange?.(job.id, 'failed', { error });
      return {
        jobId: job.id,
        status: 'failed',
        skipped: false,
        usedLanFallback,
        error,
      };
    }
  }
}
