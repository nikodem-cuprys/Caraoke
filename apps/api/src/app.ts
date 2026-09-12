import cors from "cors";
import express from "express";
import { config } from "./config";
import { errorHandler } from "./middleware/errorHandler";
import { requireWorkerSecret } from "./middleware/workerAuth";
import { assetsRouter } from "./routes/assets";
import { jobsRouter } from "./routes/jobs";
import { songsRouter } from "./routes/songs";
import { workerRouter } from "./routes/worker";

export function createApp() {
  const app = express();

  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: "2mb" }));

  app.get("/health", (_req, res) => res.json({ ok: true }));

  app.use("/api/songs", songsRouter);
  app.use("/api/jobs", jobsRouter);
  app.use("/internal", requireWorkerSecret, workerRouter);
  app.use("/assets", assetsRouter);

  app.use(errorHandler);

  return app;
}
