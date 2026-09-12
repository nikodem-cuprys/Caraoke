import type { NextFunction, Request, Response } from "express";

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const anyErr = err as { statusCode?: number; message?: string };
  const statusCode = anyErr.statusCode ?? 500;
  if (statusCode >= 500) {
    // eslint-disable-next-line no-console
    console.error(err);
  }
  res.status(statusCode).json({ error: anyErr.message ?? "Internal server error" });
}

export function clientOwnerId(req: Request): string {
  const header = req.headers["x-client-id"];
  if (typeof header === "string" && header.length > 0) return header;
  return "anonymous";
}
