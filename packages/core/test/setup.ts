import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Every test run uses a throwaway database and workspace folder, and never calls real providers or Claude.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gtm-test-"));
process.env.GTM_DB = path.join(dir, "test.db");
process.env.GTM_WORKSPACES = path.join(dir, "workspaces");
process.env.GTM_DEMO_MODE = "true";
process.env.ANTHROPIC_API_KEY = "";
process.env.APOLLO_API_KEY = "";
process.env.HUNTER_API_KEY = "";
process.env.ZEROBOUNCE_API_KEY = "";
process.env.COLDIQ_API_KEY = "";
