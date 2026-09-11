/**
 * Boots the docker e2e stack once per run (main process, so vitest's worker RPC never blocks on
 * the image build). Set E2E_SKIP_COMPOSE=1 to test against an already-running stack, E2E_KEEP=1
 * to leave it up for inspection.
 */
import { execSync } from "node:child_process";
import { fakePrivy } from "@ketsuban/registrar/testing";

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

/**
 * The addresses the stack just deployed.
 *
 * They used to be read out of the checkout, because the deploy step wrote them there through a mount
 * of the repo. Compose resolves such a path on the daemon's host, so a job running inside a container
 * of its own mounted nothing and the suite had no chance — the file it wanted was never going to
 * appear. The deploy step writes to a volume now, and this asks the volume rather than the filesystem
 * the suite happens to be sitting on.
 */
export function deployment(): Record<string, string> {
  const raw = execSync(`${COMPOSE} run --rm --no-deps --entrypoint cat deploy /deployments/local.json`, {
    encoding: "utf8",
    env: env(),
  });
  // `run` prints compose's own progress on stderr, so stdout is the file and nothing else.
  return JSON.parse(raw) as Record<string, string>;
}

/**
 * Restart the API container and wait until it is serving again, as a redeploy would.
 *
 * Compose reports the container started before the process inside it is listening, so readiness is
 * asked of the service itself rather than of docker.
 */
export async function restartApi(url: string): Promise<void> {
  execSync(`${COMPOSE} restart api`, { stdio: "inherit", env: env() });
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      if ((await fetch(`${url}/healthz`)).ok) return;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) throw new Error("api did not come back after a restart");
    await new Promise((r) => setTimeout(r, 500));
  }
}

export async function teardown() {
  if (process.env.E2E_SKIP_COMPOSE === "1" || process.env.E2E_KEEP === "1") return;
  execSync(`${COMPOSE} down -v`, { stdio: "inherit", env: env() });
}
