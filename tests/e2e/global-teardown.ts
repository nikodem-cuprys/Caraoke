import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const PID_FILE = path.join(__dirname, ".worker-pid");

export default async function globalTeardown(): Promise<void> {
  if (!fs.existsSync(PID_FILE)) return;
  const pid = fs.readFileSync(PID_FILE, "utf-8").trim();
  fs.unlinkSync(PID_FILE);
  if (!pid) return;

  try {
    if (process.platform === "win32") {
      // /T kills the child python.exe the spawned process tree started too.
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" });
    } else {
      process.kill(-Number(pid), "SIGTERM");
    }
  } catch {
    // Already exited — nothing to do.
  }
}
