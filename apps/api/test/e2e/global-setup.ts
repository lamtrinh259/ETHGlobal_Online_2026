/**
 * Boots the docker e2e stack once per run (main process, so vitest's worker RPC never blocks on
 * the image build). Set E2E_SKIP_COMPOSE=1 to test against an already-running stack, E2E_KEEP=1
 * to leave it up for inspection.
 */
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { hostname } from "node:os";
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

/** The network the stack builds, named in the compose file so it can be joined by name. */
const NETWORK = "ketsuban_e2e";

/**
 * Reach the stack from wherever this process is running.
 *
 * The services publish on loopback, which the suite then fetches — and that holds only while the
 * daemon and this process share a network namespace. Inside a job that is itself a container they do
 * not: a published port is unreachable there by every address, loopback and gateway alike, and the
 * suite times out on a healthcheck it was never going to reach. Joining the stack's own network makes
 * the services reachable by the names they already answer to.
 */
function reachStack() {
  if (!existsSync("/.dockerenv")) return;
  try {
    execSync(`docker network connect ${NETWORK} ${hostname()}`, { stdio: "ignore" });
  } catch {
    // Already on it, which is the state this wanted.
  }
  process.env.E2E_API_URL ??= "http://api:8787";
  process.env.E2E_RPC_URL ??= "http://anvil:8545";
}

export async function setup() {
  if (process.env.E2E_SKIP_COMPOSE === "1") return;
  /*
   * A network of this name left by a run that could not take it down.
   *
   * The name is fixed so the stack is findable, which also means a leftover is indistinguishable from
   * one this run made. Removing it before composing costs nothing when there is none, and turns a
   * failure one run later into no failure at all.
   */
  try {
    execSync(`docker network rm ${NETWORK}`, { stdio: "ignore" });
  } catch {
    // Nothing of that name, or something is still using it: compose says which in a moment.
  }
  execSync(`${COMPOSE} up -d --build --wait`, { stdio: "inherit", env: env() });
  reachStack();
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
  /*
   * Leave the network before taking it down.
   *
   * Joining it is what lets a containerised job reach the stack, and a container still attached is an
   * endpoint the daemon will not remove the network under. `down -v` then leaves it behind, and the
   * next run finds a network of that name which its own compose project does not own — which surfaces
   * one run later as "network ketsuban_e2e not found" while a container is starting, and reads as
   * flakiness rather than as the leak it is.
   */
  if (existsSync("/.dockerenv")) {
    try {
      execSync(`docker network disconnect -f ${NETWORK} ${hostname()}`, { stdio: "ignore" });
    } catch {
      // Never joined, or already gone: both are the state this wanted.
    }
  }
  execSync(`${COMPOSE} down -v`, { stdio: "inherit", env: env() });
}
