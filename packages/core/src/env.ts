import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Find the repo root: the folder holding package.json named "gtm-brain". */
function findRoot(): string {
  if (process.env.GTM_ROOT) return path.resolve(process.env.GTM_ROOT);
  const starts = [process.cwd()];
  try {
    starts.push(path.dirname(fileURLToPath(import.meta.url)));
  } catch {
    /* bundled environments may not expose a file URL */
  }
  for (const start of starts) {
    let dir = start;
    for (let i = 0; i < 8; i++) {
      const pkg = path.join(/*turbopackIgnore: true*/ dir, "package.json");
      if (fs.existsSync(pkg)) {
        try {
          if (JSON.parse(fs.readFileSync(pkg, "utf8")).name === "gtm-brain") return dir;
        } catch {
          /* ignore malformed package.json */
        }
      }
      const up = path.dirname(dir);
      if (up === dir) break;
      dir = up;
    }
  }
  return process.cwd();
}

export const ROOT = findRoot();
export const WORKSPACES_DIR = process.env.GTM_WORKSPACES ?? path.join(/*turbopackIgnore: true*/ ROOT, "workspaces");
export const DATA_DIR = path.join(/*turbopackIgnore: true*/ ROOT, "data");

let loaded = false;
/** Load .env.local then .env from the repo root without overriding real env vars. */
export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  for (const name of [".env.local", ".env"]) {
    const file = path.join(/*turbopackIgnore: true*/ ROOT, name);
    if (!fs.existsSync(file)) continue;
    for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      // Real environment variables win, including ones set to "" on purpose (tests use that to disable keys).
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}

export function env(key: string): string | undefined {
  loadEnv();
  const v = process.env[key];
  return v && v.trim() ? v.trim() : undefined;
}

export function demoMode(): boolean {
  return (env("GTM_DEMO_MODE") ?? "false").toLowerCase() === "true";
}
