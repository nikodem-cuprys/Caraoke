import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const WORKER_DIR = path.resolve(__dirname, "..", "..", "apps", "worker");
const PID_FILE = path.join(__dirname, ".worker-pid");

/**
 * Playwright's built-in `webServer` option needs an HTTP health-check URL,
 * which the Python worker doesn't expose (it's a poll loop, not a server),
 * so it's started here instead and torn down in global-teardown.ts.
 */
export default async function globalSetup(): Promise<void> {
  const pythonBin =
    process.platform === "win32"
      ? path.join(WORKER_DIR, ".venv", "Scripts", "python.exe")
      : path.join(WORKER_DIR, ".venv", "bin", "python");

  if (!fs.existsSync(pythonBin)) {
    throw new Error(
      `Worker virtualenv not found at ${pythonBin}. Run the setup steps in apps/worker/README (create .venv, pip install -r requirements.txt) before running e2e tests.`
    );
  }

  const child = spawn(pythonBin, ["-m", "singlearn_worker.main"], {
    cwd: WORKER_DIR,
    stdio: "ignore",
    detached: process.platform !== "win32",
  });
  fs.writeFileSync(PID_FILE, String(child.pid));

  // Give the worker a moment to start polling before tests begin uploading.
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
