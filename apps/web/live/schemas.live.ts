import { describe, expect, it } from "vitest";
import {
  contractsSchema,
  enclaveKeySchema,
  ensSchema,
  ethLabelSchema,
  explainSchema,
  findSchema,
  grantsSchema,
  instanceReadSchema,
  nameStatusSchema,
  preflightSchema,
  profileSchema,
  reverseSchema,
  verifySchema,
  vouchesSchema,
  walletSchema,
  whoSchema,
} from "@/lib/api";

/**
 * Does a running attester answer what this app is built to parse?
 *
 * Every page is written to degrade, so a response that has drifted from these schemas does not
 * announce itself: the read fails, the catch swallows it, and the page renders a fallback that reads
 * as an ordinary empty state. Worth knowing before a deploy rather than from a screenshot of a page
 * that quietly shows nothing.
 *
 * Deliberately outside the test run — it needs a reachable deployment, and a suite that fails when a
 * server is down is a suite people learn to ignore.
 *
 *   pnpm --filter @ketsuban/web check:live
 *   CHECK_API=http://127.0.0.1:8787 pnpm --filter @ketsuban/web check:live
 *
 * Parsing is only half of it: `chain.live.ts` asks whether what parsed is what the chain holds.
 */
const API = (process.env.CHECK_API ?? "https://ketsuban-api.peeramid.xyz").replace(/\/$/, "");
const HANDLE = process.env.CHECK_HANDLE ?? "peersky";
const ROOT = process.env.CHECK_ROOT ?? "ketsuban.eth";
const WALLET = process.env.CHECK_WALLET ?? "0xD70B5E8A232Bf67F64658cbDDebe32e1443894a0";
const SUBJECT = process.env.CHECK_SUBJECT ?? "kju-is";

const cases: [string, { parse: (v: unknown) => unknown }][] = [
  [`/v1/verify/${HANDLE}.${ROOT}`, verifySchema],
  [`/v1/vouches/${HANDLE}`, vouchesSchema],
  [`/v1/profile/${HANDLE}`, profileSchema],
  [`/v1/instance/${SUBJECT}`, instanceReadSchema],
  [`/v1/wallet/${WALLET}`, walletSchema],
  [`/v1/disclosures/${HANDLE}.${ROOT}`, grantsSchema],
  /*
   * The rest of what this app reads. Only the reads: a POST would write to the deployment being
   * checked, and a check with a side effect is one nobody dares run. Each of these had drifted
   * unnoticed at least once in the mock, which answers the same shapes.
   */
  ["/v1/instances", contractsSchema],
  ["/v1/preflight", preflightSchema],
  ["/v1/enclave-key", enclaveKeySchema],
  [`/v1/ens/${HANDLE}.${ROOT}`, ensSchema],
  [`/v1/explain/${HANDLE}.${ROOT}`, explainSchema],
  [`/v1/reverse/${WALLET}`, reverseSchema],
  [`/v1/name/${ROOT.split(".")[0]}/${HANDLE}`, nameStatusSchema],
  [`/v1/find?q=${HANDLE}`, findSchema],
  [`/v1/eth-label/${ROOT.split(".")[0]}`, ethLabelSchema],
  // Answers `found: false` for an account nobody attested, so this parses on any deployment.
  [`/v1/who?handle=${HANDLE}&domain=x.com`, whoSchema],
];

describe(`what ${API} answers`, () => {
  for (const [path, schema] of cases) {
    it(`${path} parses as this app parses it`, async () => {
      const res = await fetch(`${API}${path}`);
      expect(res.ok, `${path} answered ${res.status}`).toBe(true);
      schema.parse(await res.json());
    });
  }
});
