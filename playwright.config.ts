import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const WEB_URL = process.env.E2E_WEB_URL ?? "http://localhost:3200";
const API_URL = process.env.E2E_API_URL ?? "http://localhost:4100";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 180_000, // real ASR/pitch-detection pipeline runs during these tests
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  globalSetup: require.resolve("./tests/e2e/global-setup.ts"),
  globalTeardown: require.resolve("./tests/e2e/global-teardown.ts"),
  use: {
    baseURL: WEB_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "npm run dev -w @singlearn/api",
      cwd: path.resolve(__dirname),
      url: `${API_URL}/health`,
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: "npm run dev -w @singlearn/web",
      cwd: path.resolve(__dirname),
      url: WEB_URL,
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
