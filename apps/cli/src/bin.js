#!/usr/bin/env node
// Lets `npm link` / `npx gtm` work: loads the TypeScript CLI through tsx.
import { register } from "tsx/esm/api";
register();
await import("./index.ts");
