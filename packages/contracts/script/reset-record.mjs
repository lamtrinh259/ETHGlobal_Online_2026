/**
 * Delete one Multipass record, so a flow can be walked again from nothing.
 *
 * Written for the humanity domain, where a proof is spent once and there is otherwise no way back to
 * an unproved wallet: a record cannot be shortened, only replaced or removed. It takes any domain,
 * because the same need arrives for a name or an account while a deployment is being demonstrated.
 *
 * Refuses to act without `--apply`, and prints what it found first — the record it deletes is gone,
 * and reading it back afterwards is the only confirmation there is.
 *
 *   set -a; . .secrets/api.env; set +a
 *   node packages/contracts/script/reset-record.mjs 0x<wallet> humanity          # look
 *   node packages/contracts/script/reset-record.mjs 0x<wallet> humanity --apply  # delete
 *
 * The nullifier this deployment already bound to the wallet is not released: the same person proving
 * again from the same wallet is a renewal and passes, while letting a spent nullifier move to a second
 * wallet is the one thing that binding exists to prevent.
 */
import { createPublicClient, createWalletClient, http, zeroHash } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { MultipassAbi, toBytes32, fromBytes32 } from "@peeramid-labs/multipass-client";

const { RPC_URL, MULTIPASS, RELAYER_KEY } = process.env;
const wallet = process.argv[2];
const domain = process.argv[3] ?? "humanity";
const apply = process.argv.includes("--apply");

const pc = createPublicClient({ transport: http(RPC_URL) });
const query = {
  name: zeroHash,
  id: zeroHash,
  wallet,
  domainName: toBytes32(domain),
  targetDomain: zeroHash,
};
const [ok, r] = await pc.readContract({
  address: MULTIPASS, abi: MultipassAbi, functionName: "resolveRecord", args: [query],
});
console.log(`found=${ok} wallet=${r.wallet} id=${r.id}`);
console.log(`  payload=${fromBytes32(r.payload)} validUntil=${new Date(Number(r.validUntil) * 1000).toISOString()} nonce=${r.nonce}`);
if (!ok) process.exit(1);
if (!apply) { console.log("\ndry run — pass --apply to delete"); process.exit(0); }

const account = privateKeyToAccount(RELAYER_KEY);
const wc = createWalletClient({ account, transport: http(RPC_URL), chain: { id: Number(process.env.CHAIN_ID), name: "sepolia", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC_URL] } } } });
const hash = await wc.writeContract({
  address: MULTIPASS, abi: MultipassAbi, functionName: "deleteName",
  args: [{ ...query, id: r.id, wallet: r.wallet }],
});
console.log("tx", hash);
const rec = await pc.waitForTransactionReceipt({ hash });
console.log("status", rec.status);
