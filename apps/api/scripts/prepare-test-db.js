const { execSync } = require("node:child_process");
const path = require("node:path");

const cwd = path.join(__dirname, "..");
const env = { ...process.env, DATABASE_URL: "file:./test.db" };

execSync("npx prisma db push --skip-generate --accept-data-loss", {
  cwd,
  env,
  stdio: "inherit",
});
