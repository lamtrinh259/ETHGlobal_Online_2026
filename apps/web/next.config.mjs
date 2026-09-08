import { execSync } from "node:child_process";

// Build hash: the deploy platform's commit if present (Coolify SOURCE_COMMIT), else git HEAD at
// build time, else empty (a gitless build context). 7 chars to match a short SHA.
function buildSha() {
  const fromEnv = (process.env.SOURCE_COMMIT || process.env.GIT_SHA || "").slice(0, 7);
  if (fromEnv) return fromEnv;
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
}
const BUILD_SHA = buildSha();
const BUILD_TIME = new Date().toISOString().slice(0, 16).replace("T", " ") + "Z";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  // TEST_BUILD builds to a separate dir so the Playwright webServer's `next build` never
  // clobbers a running `next dev` (which shares .next).
  distDir: process.env.TEST_BUILD ? ".next-test" : ".next",
  // The registrar package is workspace TypeScript compiled to ESM; transpile it in the bundle.
  transpilePackages: ["@ketsuban/registrar", "@peeramid-labs/multipass-client"],
  env: {
    NEXT_PUBLIC_BUILD: BUILD_SHA || BUILD_TIME,
    NEXT_PUBLIC_BUILD_SHA: BUILD_SHA,
    NEXT_PUBLIC_BUILD_TIME: BUILD_TIME,
  },
  // Revalidate the HTML shell on every load so a new deploy is picked up immediately; the hashed
  // /_next/static assets are content-addressed and stay immutable.
  async headers() {
    const revalidate = [{ key: "Cache-Control", value: "no-cache, must-revalidate" }];
    return [
      { source: "/", headers: revalidate },
      { source: "/v/:name", headers: revalidate },
    ];
  },
};

export default nextConfig;
