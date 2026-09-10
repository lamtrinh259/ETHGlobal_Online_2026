import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { Chain } from "./chain.js";
import { startIndexer } from "./indexer.js";
import { probeStorage } from "./store.js";
import { explainConfigError, loadConfig } from "./config.js";

let config;
try {
  config = loadConfig();
} catch (err) {
  for (const line of explainConfigError(err)) console.error(`config error · ${line}`);
  console.error("see apps/api/.env.coolify.example for every variable this service needs");
  process.exit(1);
}
const chain = new Chain(config);
const app = createApp({ config, chain });
const index = startIndexer(chain.indexer, config.INDEX_POLL_SECONDS);

// Storage fails quietly: a DATA_DIR with no volume behind it takes every write and loses it at the
// next restart. Ask once, at boot, before anyone has granted a permission that will not be there.
const storage = probeStorage(config.DATA_DIR || undefined);
if (!storage.durable) {
  console.error(
    "storage · DATA_DIR is not set: permissions, gas top-ups and avatars are kept in memory and lost on restart"
  );
} else if (!storage.writable) {
  console.error(
    `storage · DATA_DIR (${config.DATA_DIR}) cannot be written · ${storage.lastError} · nothing kept here survives a restart`
  );
} else {
  console.log(JSON.stringify({ msg: "storage ok", dataDir: config.DATA_DIR }));
}

// Say it once, at boot: a deployment pointed at the wrong contract should not wait for a user to
// sign something before it complains.
void chain
  .preflight()
  .then((p) => {
    for (const w of p.warnings) console.error(`preflight · ${w}`);
    if (p.ok)
      console.log(
        JSON.stringify({
          msg: "preflight ok",
          bridge: p.bridge.address,
          domains: p.multipass.domains.map((d) => d.domain),
        })
      );
  })
  .catch((err) => console.error(`preflight failed · ${(err as Error).message}`));

const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  console.log(JSON.stringify({ msg: "api listening", port: info.port, chainId: config.CHAIN_ID }));
});

// A deploy replaces this container: stop polling and let the in-flight tick finish, so the snapshot on
// disk is whole and the next boot resumes from it rather than rescanning.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    void (async () => {
      console.log(JSON.stringify({ msg: "shutting down", signal }));
      await index.stop();
      server.close(() => process.exit(0));
    })();
  });
}
