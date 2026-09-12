import { Router } from "express";
import { prisma } from "../db/client";
import { sseHub } from "../services/sse";
import { toJobDTO } from "../services/jobService";

export const jobsRouter = Router();

jobsRouter.get("/:jobId/stream", async (req, res) => {
  const jobId = req.params.jobId;
  const job = await prisma.processingJob.findUnique({ where: { id: jobId } });
  if (!job) {
    res.status(404).end();
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders?.();

  sseHub.subscribe(jobId, res);
  res.write(`event: stage-update\ndata: ${JSON.stringify(await toJobDTO(jobId))}\n\n`);

  const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 15000);

  req.on("close", () => {
    clearInterval(heartbeat);
    sseHub.unsubscribe(jobId, res);
  });
});

jobsRouter.get("/:jobId", async (req, res, next) => {
  try {
    res.json(await toJobDTO(req.params.jobId));
  } catch (err) {
    next(err);
  }
});
