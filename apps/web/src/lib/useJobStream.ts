"use client";

import type { ProcessingJobDTO } from "@singlearn/shared";
import { useEffect, useState } from "react";
import { jobStreamUrl } from "./apiClient";

/** Subscribes to the API's SSE stream for a processing job's real stage progress. */
export function useJobStream(jobId: string | null): { job: ProcessingJobDTO | null; connected: boolean } {
  const [job, setJob] = useState<ProcessingJobDTO | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!jobId) return;
    const source = new EventSource(jobStreamUrl(jobId));

    source.addEventListener("open", () => setConnected(true));
    source.addEventListener("stage-update", (event) => {
      setConnected(true);
      setJob(JSON.parse((event as MessageEvent).data));
    });
    source.addEventListener("error", () => setConnected(false));

    return () => source.close();
  }, [jobId]);

  return { job, connected };
}
