import { config } from "../config";
import { DbBackedQueueProvider } from "./DbBackedQueueProvider";
import type { QueueProvider } from "./QueueProvider";

let instance: QueueProvider | null = null;

export function getQueueProvider(): QueueProvider {
  if (instance) return instance;
  let created: QueueProvider;
  if (config.queueProvider === "bullmq" && config.redisUrl) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { BullMqQueueProvider } = require("./BullMqQueueProvider");
    created = new BullMqQueueProvider(config.redisUrl);
  } else {
    created = new DbBackedQueueProvider();
  }
  instance = created;
  return created;
}

export type { QueueProvider } from "./QueueProvider";
