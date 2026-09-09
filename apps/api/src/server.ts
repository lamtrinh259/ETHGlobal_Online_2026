import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { Chain } from "./chain.js";
import { explainConfigError, loadConfig } from "./config.js";

let config;
try {
  config = loadConfig();
} catch (err) {
  for (const line of explainConfigError(err)) console.error(`config error · ${line}`);
  console.error("see apps/api/.env.coolify.example for every variable this service needs");
  process.exit(1);
}
const app = createApp({ config, chain: new Chain(config) });

serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  console.log(JSON.stringify({ msg: "api listening", port: info.port, chainId: config.CHAIN_ID }));
});
