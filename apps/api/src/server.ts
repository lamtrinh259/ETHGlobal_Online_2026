import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { Chain } from "./chain.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const app = createApp({ config, chain: new Chain(config) });

serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  console.log(JSON.stringify({ msg: "api listening", port: info.port, chainId: config.CHAIN_ID }));
});
