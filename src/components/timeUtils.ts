/**
 * Computes non-negative whole elapsed minutes since an ISO-8601 timestamp.
 */
export function getElapsedMinutes(isoTimestamp: string, nowMs: number): number {
  const parsedMs = Date.parse(isoTimestamp);
  if (Number.isNaN(parsedMs)) {
    return 0;
  }
  return Math.max(0, Math.floor((nowMs - parsedMs) / 60000));
}
