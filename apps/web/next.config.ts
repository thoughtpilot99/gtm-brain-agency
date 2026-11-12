import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // @gtm/core ships TypeScript source; Next compiles it with the app.
  transpilePackages: ["@gtm/core"],
  // The monorepo root holds the lockfile and node_modules.
  turbopack: { root: path.resolve(process.cwd(), "../..") },
  outputFileTracingRoot: path.resolve(process.cwd(), "../.."),
  serverExternalPackages: ["@anthropic-ai/sdk"],
};

export default nextConfig;
