/**
 * Boots the docker e2e stack once per run (main process, so vitest's worker RPC never blocks on
 * the image build). Set E2E_SKIP_COMPOSE=1 to test against an already-running stack, E2E_KEEP=1
 * to leave it up for inspection.
 */
import { execSync } from "node:child_process";
import { fakePrivy } from "@att/registrar/testing";

export const APP_ID = "e2e-app-id";
export const PRIVY_SEED = "e2e-privy-key";
const COMPOSE = `docker compose -f ${new URL("../../docker-compose.e2e.yml", import.meta.url).pathname}`;

function env() {
  return {
    ...process.env,
    PRIVY_APP_ID: APP_ID,
    PRIVY_VERIFICATION_KEY_JWK: JSON.stringify(fakePrivy(APP_ID, PRIVY_SEED).jwk),
  };
}

export async function setup() {
  if (process.env.E2E_SKIP_COMPOSE === "1") return;
  execSync(`${COMPOSE} up -d --build --wait`, { stdio: "inherit", env: env() });
}

export async function teardown() {
  if (process.env.E2E_SKIP_COMPOSE === "1" || process.env.E2E_KEEP === "1") return;
  execSync(`${COMPOSE} down -v`, { stdio: "inherit", env: env() });
}
