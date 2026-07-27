/**
 * Pure helper: wrap an event payload in SSE wire format.
 * Kept tiny so it stays a one-liner in the controller.
 */
export interface SseEvent {
  event: string;
  data: unknown;
}

export function formatSse(event: SseEvent): string {
  return `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
}
