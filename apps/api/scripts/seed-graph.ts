/**
 * Seed the demo namespace into a running deployment: `pnpm --filter @ketsuban/api seed:graph`.
 * What it writes, and why, is in `src/seed.ts`; a deployment can also do this itself at boot with
 * `SEED_GRAPH=true`.
 */
import type { Hex } from "viem";
import { apply, plan } from "../src/seed.js";

const api = (process.env.API_URL ?? "").replace(/\/$/, "");
const registrarKey = process.env.REGISTRAR_KEY as Hex | undefined;
if (!api || !registrarKey) {
  console.error(
    "API_URL and REGISTRAR_KEY are required: the deployment to write to, and the key every record is signed with"
  );
  process.exit(2);
}
apply(plan(), {
  api,
  registrarKey,
  salt: process.env.SEED_SALT ?? "demo",
  eip712: {
    name: process.env.MULTIPASS_EIP712_NAME ?? "MultipassDNS",
    version: process.env.MULTIPASS_EIP712_VERSION ?? "1.0.0",
  },
  log: (s) => console.log(s),
})
  .then((done) =>
    console.log(`seeded: ${done.names} names, ${done.humans} proofs, ${done.references} references`)
  )
  .catch((e) => {
    console.error(String(e));
    process.exit(1);
  });
