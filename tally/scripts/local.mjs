#!/usr/bin/env node
// One command local start: `npm run local`
//   1. creates .env with a random session secret if it is missing
//   2. prepares the SQLite database and applies migrations
//   3. adds categories, purposes, sources and (if enabled) demo data
//   4. starts the app at http://localhost:3000
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

if (!existsSync(".env")) {
  const template = readFileSync(".env.example", "utf8");
  writeFileSync(".env", template.replace('SESSION_SECRET=""', `SESSION_SECRET="${randomBytes(32).toString("hex")}"`));
  console.log("Created .env with a new session secret.");
}
mkdirSync("data", { recursive: true });

console.log("\nPreparing the database…");
run("npx", ["prisma", "generate"]);
run("npx", ["prisma", "migrate", "deploy"]);
run("npx", ["tsx", "prisma/seed.ts"]);

const env = readFileSync(".env", "utf8");
const hasPassword = /APP_PASSWORD="?.+"?/.test(env.split("\n").find((l) => l.startsWith("APP_PASSWORD")) ?? "");
console.log(`\nTally is starting at http://localhost:3000`);
if (!hasPassword) console.log(`Sign in with the local default password: tally\n`);
if (process.env.TALLY_SETUP_ONLY) process.exit(0);
run("npx", ["next", "dev"]);
