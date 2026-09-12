import type { Response } from "express";

/** Simple in-process SSE hub, keyed by jobId. One process only (fine for the MVP single-node deployment). */
class SseHub {
  private subscribers = new Map<string, Set<Response>>();

  subscribe(jobId: string, res: Response): void {
    if (!this.subscribers.has(jobId)) this.subscribers.set(jobId, new Set());
    this.subscribers.get(jobId)!.add(res);
  }

  unsubscribe(jobId: string, res: Response): void {
    this.subscribers.get(jobId)?.delete(res);
  }

  publish(jobId: string, event: string, data: unknown): void {
    const subs = this.subscribers.get(jobId);
    if (!subs) return;
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of subs) {
      res.write(payload);
    }
  }
}

export const sseHub = new SseHub();
