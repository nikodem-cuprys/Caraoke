import type { NextFunction, Request, Response } from "express";
import { config } from "../config";

/** Only the Python worker process should ever hit /internal/* routes. */
export function requireWorkerSecret(req: Request, res: Response, next: NextFunction): void {
  const provided = req.headers["x-worker-secret"];
  if (provided !== config.workerSharedSecret) {
    res.status(401).json({ error: "Invalid or missing worker secret" });
    return;
  }
  next();
}
