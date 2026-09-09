import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { Chain } from "./chain.js";
import { startIndexer } from "./indexer.js";
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
startIndexer(chain.indexer, config.INDEX_POLL_SECONDS);

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

serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  console.log(JSON.stringify({ msg: "api listening", port: info.port, chainId: config.CHAIN_ID }));
});
