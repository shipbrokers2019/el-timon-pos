import { describe, expect, it, vi } from 'vitest';
import {
  PrintCoordinator,
  type TcpPrintTransport,
} from '../../src/services/printerService';
import type { PrintJob, PrinterConfig } from '../../src/types/pos';

const baseConfig: PrinterConfig = {
  restaurantName: 'Brisa Marina Beach Club',
  ip: '192.168.1.200',
  port: 9100,
  autoPrintFromKitchen: true,
  lanFallbackEnabled: true,
};

function makePrintJob(id: string, overrides: Partial<PrintJob> = {}): PrintJob {
  return {
    id,
    type: 'comanda',
    referenceId: `cmd-${id}`,
    title: `Comanda ${id}`,
    textPreview: `TICKET ${id}`,
    status: 'pending',
    createdAt: '2026-11-25T15:00:00Z',
    ...overrides,
  };
}

describe('PrintCoordinator', () => {
  it('serializes concurrent print jobs in FIFO order without overlapping port 9100 writes', async () => {
    const events: string[] = [];
    const transport: TcpPrintTransport = {
      async send(_ip, _port, data) {
        const label = new TextDecoder('ascii').decode(data);
        const match = label.match(/TICKET (job-\d+)/);
        const id = match ? match[1] : 'unknown';
        events.push(`start:${id}`);
        await new Promise((resolve) => setTimeout(resolve, id === 'job-1' ? 25 : 5));
        events.push(`end:${id}`);
      },
    };

    const coordinator = new PrintCoordinator({ transport });

    const [res1, res2, res3] = await Promise.all([
      coordinator.printJob({ job: makePrintJob('job-1'), config: baseConfig }),
      coordinator.printJob({ job: makePrintJob('job-2'), config: baseConfig }),
      coordinator.printJob({ job: makePrintJob('job-3'), config: baseConfig }),
    ]);

    expect(res1.status).toBe('printed');
    expect(res2.status).toBe('printed');
    expect(res3.status).toBe('printed');
    expect(events).toEqual([
      'start:job-1',
      'end:job-1',
      'start:job-2',
      'end:job-2',
      'start:job-3',
      'end:job-3',
    ]);
  });

  it('deduplicates already-printed printJobId unless forceReprint is true', async () => {
    const sendSpy = vi.fn(async () => {});
    const transport: TcpPrintTransport = { send: sendSpy };
    const coordinator = new PrintCoordinator({ transport });

    const job = makePrintJob('job-dedup');

    const first = await coordinator.printJob({ job, config: baseConfig });
    const second = await coordinator.printJob({ job, config: baseConfig });
    const third = await coordinator.printJob({
      job: { ...job, status: 'printed' },
      config: baseConfig,
    });

    expect(first.status).toBe('printed');
    expect(first.skipped).toBe(false);
    expect(second.skipped).toBe(true);
    expect(third.skipped).toBe(true);
    expect(sendSpy).toHaveBeenCalledTimes(1);

    const reprinted = await coordinator.printJob({
      job: { ...job, status: 'printed' },
      config: baseConfig,
      forceReprint: true,
    });
    expect(reprinted.skipped).toBe(false);
    expect(reprinted.status).toBe('printed');
    expect(sendSpy).toHaveBeenCalledTimes(2);
  });

  it('uses direct LAN fallback returning printed_locally when isCloudOffline is true', async () => {
    const sendSpy = vi.fn(async () => {});
    const onPreviewTicket = vi.fn();
    const transport: TcpPrintTransport = { send: sendSpy };

    const coordinator = new PrintCoordinator({
      transport,
      onPreviewTicket,
    });

    const job = makePrintJob('job-lan-1');
    const result = await coordinator.printJob({
      job,
      config: baseConfig,
      isCloudOffline: true,
    });

    expect(result.status).toBe('printed_locally');
    expect(result.usedLanFallback).toBe(true);
    expect(result.skipped).toBe(false);
    expect(sendSpy).toHaveBeenCalledWith(
      '192.168.1.200',
      9100,
      expect.any(Uint8Array),
    );
    expect(onPreviewTicket).toHaveBeenCalledTimes(1);
  });
});
