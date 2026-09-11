/**
 * Docker e2e: anvil + deployed contracts + the API image, driven from the host.
 *
 *   pnpm --filter @ketsuban/api test:e2e
 *
 * Requires docker compose; `global-setup.ts` boots the compose file, which deploys
 * `DeployLocal.s.sol` into anvil and starts the API image against it. The full loop is exercised: intent → attest (node registrar) → delivery →
 * bridge.verify on chain → name resolves through the ENS shim → verify endpoint.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import {
  bytesToHex,
  createPublicClient,
  createWalletClient,
  http,
  hexToBytes,
  namehash,
  parseAbi,
  zeroAddress,
  zeroHash,
  recoverMessageAddress,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  baseIntent,
  fakePrivy,
  fakeUser,
  signedAttestRequest,
  signedInvite,
  toWire,
} from "@ketsuban/registrar/testing";
import {
  discloseDomain,
  eciesDecrypt,
  eciesEncrypt,
  hashBoxes,
  signDisclosure,
  signRevocation,
} from "@ketsuban/registrar";
import { decodeRecord, fromBytes32, MultipassAbi, toBytes32 } from "@peeramid-labs/multipass-client";
import { hashSignal, rpSignatureMessage } from "../../src/world.js";
import { APP_ID, PRIVY_SEED, restartApi } from "./global-setup.js";

const API = process.env.E2E_API_URL ?? `http://127.0.0.1:${process.env.E2E_API_PORT ?? "18787"}`;
const RPC = process.env.E2E_RPC_URL ?? `http://127.0.0.1:${process.env.E2E_ANVIL_PORT ?? "18545"}`;
const privy = fakePrivy(APP_ID, PRIVY_SEED);
const USER_KEY = "0x000000000000000000000000000000000000000000000000000000000000a11c" as const;
const user = fakeUser(USER_KEY, "alice");

let deployment: {
  multipass: Hex;
  instanceDomain: string;
  instanceParent: string;
  bridge: Hex;
  permissionedResolver: Hex;
  ethRegistry: Hex;
};

/** anvil account 0: the DeployLocal deployer, which owns the mock `.eth` registry. */
const DEPLOYER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const anvil = {
  id: 31337,
  name: "anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
} as const;

const walletFor = (key: Hex) =>
  createWalletClient({ account: privateKeyToAccount(key), chain: anvil, transport: http(RPC) });

async function waitFor(url: string, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`timeout waiting for ${url}`);
}

beforeAll(async () => {
  await waitFor(`${API}/healthz`);
  deployment = JSON.parse(
    readFileSync(new URL("../../../../packages/contracts/deployments/local.json", import.meta.url), "utf8")
  );

  /*
   * This suite writes to a chain, so it can only be run against an empty one: names it registers are
   * already taken on a second run, and nonces it expects have moved on. Against a stack left up by
   * `E2E_KEEP=1`, that surfaces as a dozen unrelated assertion failures with no hint of the cause —
   * which costs more time than the run it was meant to save.
   */
  const health = await (await fetch(`${API}/healthz`)).json();
  if (health.index?.records > 0) {
    throw new Error(
      `this stack already holds ${health.index.records} records, and these tests need an empty chain. ` +
        `Tear it down first:\n\n  docker compose -f apps/api/docker-compose.e2e.yml down -v\n`
    );
  }
});

describe("api e2e", () => {
  it("preflights the deployment it is pointed at", async () => {
    const res = await fetch(`${API}/v1/preflight`);
    const p = await res.json();
    /*
     * This rig deploys every contract from one anvil key, so that key owns Multipass and is also the
     * relayer — which preflight reports, correctly. Production should split them. Everything else must
     * still be silent, so the expected warning is named rather than the check being dropped.
     */
    const unexpected = (p.warnings as string[]).filter((w) => !/the Multipass owner is the relayer/.test(w));
    expect(JSON.stringify(unexpected)).toBe("[]");
    expect(p.warnings).toHaveLength(1);
    expect(p.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(p.bridge).toMatchObject({ deployed: true, missing: [] });
    // The key this service signs with must be the one Multipass expects for those domains.
    expect(p.registrar.onchain).toEqual([p.registrar.signsAs]);
    expect(BigInt(p.relayer.balance)).toBeGreaterThan(0n);
    expect(p.factory.instances).toContain(deployment.instanceDomain);
    // Every domain the attester may be asked for, mounts included: an uninitialised one reverts with
    // `invalidDomain` only after the user has signed.
    const checked = p.multipass.domains.map((d: { domain: string }) => d.domain);
    for (const domain of [deployment.instanceDomain, "x", "telegram", "email", "x.com", "t.me"]) {
      expect(checked).toContain(domain);
    }
    expect(
      p.multipass.domains.every((d: { initialised: boolean; active: boolean }) => d.initialised && d.active)
    ).toBe(true);
    expect(
      p.multipass.domains.every((d: { initialised: boolean; active: boolean }) => d.initialised && d.active)
    ).toBe(true);
  });

  it("lists the root instance and the platform namespace mounted under it", async () => {
    const { instances } = await (await fetch(`${API}/v1/instances`)).json();
    expect(instances[0]).toMatchObject({
      domain: deployment.instanceDomain,
      parentName: deployment.instanceParent,
    });
    // Each platform is mounted at the DNS name it is, first label first: `x.com` lives at `com.x.www`.
    const byDomain = new Map(instances.map((i: { domain: string; parentName: string }) => [i.domain, i]));
    expect(byDomain.get("x.com")).toMatchObject({
      parentName: `com.x.www.${deployment.instanceParent}`,
    });
    expect(byDomain.get("t.me")).toMatchObject({ parentName: `me.t.www.${deployment.instanceParent}` });
    // A mail host is grouped apart, under the at-sign level.
    expect(byDomain.get("example.com")).toMatchObject({
      parentName: `com.example.@.${deployment.instanceParent}`,
    });
  });

  it("attests, delivers, and resolves a name record end to end", async () => {
    const now = Math.floor(Date.now() / 1000);
    const answer = toBytes32("terrible dictator");
    const intent = baseIntent(user.account, now, {
      domain: deployment.instanceDomain,
      handle: "alice",
      payload: answer,
      exp: BigInt(now + 3600),
    });
    const idToken = privy.mint({ sub: user.did, linked: user.linked, now });
    const req = toWire(await signedAttestRequest(user.account, intent, idToken, 31337, deployment.multipass));

    const attested = await (
      await fetch(`${API}/v1/attest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(req),
      })
    ).json();
    expect(attested.record).toMatchObject({
      name: toBytes32("alice"),
      domainName: toBytes32(deployment.instanceDomain),
      payload: answer,
      nonce: "1",
      wallet: user.account.address,
    });

    const delivered = await (
      await fetch(`${API}/v1/cre/delivery`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-delivery-token": "e2e-delivery-token-0123456789" },
        body: JSON.stringify(attested),
      })
    ).json();
    expect(delivered.ok).toBe(true);
    expect(delivered.txHash).toMatch(/^0x[0-9a-f]{64}$/);

    const pc = createPublicClient({ transport: http(RPC) });
    const [ok, onchain] = await pc.readContract({
      address: deployment.multipass,
      abi: MultipassAbi,
      functionName: "resolveRecord",
      args: [
        {
          name: toBytes32("alice"),
          id: zeroHash,
          wallet: "0x0000000000000000000000000000000000000000",
          domainName: toBytes32(deployment.instanceDomain),
          targetDomain: zeroHash,
        },
      ],
    });
    expect(ok).toBe(true);
    expect(onchain.wallet).toBe(user.account.address);
    expect(onchain.payload).toBe(answer);

    const name = `alice.${deployment.instanceParent}`;
    const verified = await (await fetch(`${API}/v1/verify/${name}`)).json();
    expect(verified).toMatchObject({
      name,
      status: "active",
      wallet: user.account.address,
      answer: "terrible dictator",
      humanity: null,
      links: [],
      decision: "additional_context_available",
    });
    expect(new Date(verified.expiresAt).getTime() / 1000).toBe(Number(attested.record.validUntil));
  });

  it("links an opted-in platform account and discloses it only with the view code", async () => {
    const now = Math.floor(Date.now() / 1000);
    const intent = baseIntent(user.account, now, { domain: "x", optIn: true, exp: BigInt(now + 3600) });
    const idToken = privy.mint({ sub: user.did, linked: user.linked, now });
    const req = toWire(await signedAttestRequest(user.account, intent, idToken, 31337, deployment.multipass));
    const attested = await (
      await fetch(`${API}/v1/attest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(req),
      })
    ).json();
    expect(attested.viewCode).not.toBeNull();
    const viewCode = bytesToHex(eciesDecrypt(USER_KEY, attested.viewCode));
    expect(decodeRecord(attested.record, viewCode)).toEqual({
      handle: "alice",
      platformId: "1234567890123456789",
    });

    const delivered = await (
      await fetch(`${API}/v1/cre/delivery`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-delivery-token": "e2e-delivery-token-0123456789" },
        body: JSON.stringify(attested),
      })
    ).json();
    expect(delivered.ok).toBe(true);

    const name = `alice.${deployment.instanceParent}`;
    const masked = await (await fetch(`${API}/v1/verify/${name}?links=x`)).json();
    // The flat mount has no private branch, so a masked account there has no name to offer.
    expect(masked.links).toEqual([
      { domain: "x", optedIn: true, ensName: null, commitment: attested.record.payload },
    ]);

    const disclosed = await (await fetch(`${API}/v1/verify/${name}?links=x&viewCode=${viewCode}`)).json();
    expect(disclosed.links[0].disclosed).toEqual({ handle: "alice", platformId: "1234567890123456789" });
    expect(disclosed.evidence).toContain("x_account_control");
  });

  it("shares a masked account with one reader, lists it, and takes it back", async () => {
    // The whole permission loop against a real chain: only the enclave key can open the grant, only the
    // wallet that holds the record can sign one, and revoking makes the account masked again.
    const now = Math.floor(Date.now() / 1000);
    // Alice already has an `x` record from an earlier test; renewing it takes the next nonce, and the
    // renewal carries a fresh view code, which is the one this grant is for.
    const { next } = await (await fetch(`${API}/v1/nonce?wallet=${user.account.address}&domain=x`)).json();
    const intent = baseIntent(user.account, now, {
      domain: "x",
      optIn: true,
      nonce: BigInt(next),
      exp: BigInt(now + 3600),
    });
    const idToken = privy.mint({ sub: user.did, linked: user.linked, now });
    const req = toWire(await signedAttestRequest(user.account, intent, idToken, 31337, deployment.multipass));
    const attested = await (
      await fetch(`${API}/v1/attest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(req),
      })
    ).json();
    expect(attested.error).toBeUndefined();
    const viewCode = bytesToHex(eciesDecrypt(USER_KEY, attested.viewCode));
    await fetch(`${API}/v1/cre/delivery`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-delivery-token": "e2e-delivery-token-0123456789" },
      body: JSON.stringify(attested),
    });

    const name = `alice.${deployment.instanceParent}`;
    const reader = privateKeyToAccount(`0x${"b0".repeat(32)}` as Hex);
    const { publicKey } = await (await fetch(`${API}/v1/enclave-key`)).json();

    // The view code travels encrypted to the enclave: the service that stores this cannot read it.
    const box = eciesEncrypt(publicKey, hexToBytes(viewCode as Hex), new Uint8Array(32).fill(11));
    const disclosure = {
      name,
      domains: ["x"],
      audience: reader.address,
      audienceName: "",
      exp: BigInt(now + 3600),
      boxesHash: hashBoxes([box]),
    };
    const grant = await (
      await fetch(`${API}/v1/disclose`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...disclosure,
          exp: disclosure.exp.toString(),
          boxes: [box],
          signature: await signDisclosure(
            user.account,
            disclosure,
            discloseDomain(31337, deployment.multipass)
          ),
        }),
      })
    ).json();
    expect(grant.ok).toBe(true);
    const grantId = grant.id;

    const opened = await (await fetch(`${API}/v1/disclose/${name}/x?reader=${reader.address}`)).json();
    expect(opened.disclosed).toEqual({ handle: "alice", platformId: "1234567890123456789" });
    // Addressed to one wallet: anyone else asking gets nothing, grant or no grant.
    expect((await fetch(`${API}/v1/disclose/${name}/x`)).status).toBe(403);

    const listed = await (await fetch(`${API}/v1/disclosures/${name}`)).json();
    expect(listed.grants).toContainEqual({
      id: grantId,
      domains: ["x"],
      audience: reader.address,
      audienceName: "",
      expiresAt: new Date((now + 3600) * 1000).toISOString(),
    });

    // A stranger cannot close someone else's account: the chain says who holds the record.
    const stranger = await fetch(`${API}/v1/revoke`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        grantId,
        at: now.toString(),
        signature: await signRevocation(
          reader,
          { name, grantId, at: BigInt(now) },
          discloseDomain(31337, deployment.multipass)
        ),
      }),
    });
    expect(stranger.status).toBe(422);
    expect((await fetch(`${API}/v1/disclose/${name}/x?reader=${reader.address}`)).status).toBe(200);

    const at = Math.floor(Date.now() / 1000);
    const revoked = await fetch(`${API}/v1/revoke`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        grantId,
        at: at.toString(),
        signature: await signRevocation(
          user.account,
          { name, grantId, at: BigInt(at) },
          discloseDomain(31337, deployment.multipass)
        ),
      }),
    });
    expect(revoked.status).toBe(200);
    // Masked again: the reader who could open it a moment ago now gets the same answer as a stranger.
    expect((await fetch(`${API}/v1/disclose/${name}/x?reader=${reader.address}`)).status).toBe(404);
    expect((await (await fetch(`${API}/v1/disclosures/${name}`)).json()).grants).toEqual([]);
  });

  it("keeps a letter by its hash, serves it back, and still has it after a restart", async () => {
    // The letter is the part that cannot fit on chain. What goes on chain is the hash, so the copy a
    // reader is handed is checkable — and the copy has to outlive a deploy or the reference points at
    // nothing.
    const letter = "Alice ran infrastructure at Acme for three years. ".repeat(40);
    const kept = await (
      await fetch(`${API}/v1/letter`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: letter }),
      })
    ).json();
    expect(kept.ref).toBe(`sha256:${kept.hash}`);

    const read = await (await fetch(`${API}/v1/letter/${kept.hash}`)).json();
    expect(read.text).toBe(letter);
    // The hash is the whole point: anyone can check what they were given is what the record names.
    expect(createHash("sha256").update(letter).digest("hex")).toBe(kept.hash);

    await restartApi(API);
    expect((await (await fetch(`${API}/v1/letter/${kept.hash}`)).json()).text).toBe(letter);
  });

  it("keeps a picture by its bytes, serves it as a picture, and still has it after a restart", async () => {
    /*
     * A profile picture is the other thing this service holds that the chain cannot: a text record
     * carries a URL, so the bytes live here and the record points at them. Lose them and every avatar
     * on the deployment is a broken image, permanently, because the record still names the URL.
     *
     * The upload route had no end-to-end cover at all — it is one of two POSTs the docker suite never
     * exercised — and it is the one that writes straight to `DATA_DIR` rather than through a store.
     */
    // A one-pixel PNG, which is a real picture: the route sniffs the bytes rather than trusting a name.
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64"
    );
    const send = async () => {
      const form = new FormData();
      form.append("file", new Blob([png], { type: "image/png" }), "me.png");
      return (await fetch(`${API}/v1/avatar`, { method: "POST", body: form })).json();
    };

    const up = await send();
    expect(up.error, `upload refused: ${up.error}`).toBeUndefined();
    // Content-addressed: the name is the bytes, so the same picture twice costs one copy.
    expect(up.id).toBe(`${createHash("sha256").update(png).digest("hex")}.png`);
    expect((await send()).id).toBe(up.id);

    const served = await fetch(`${API}/v1/avatar/${up.id}`);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toContain("image/png");
    expect(Buffer.from(await served.arrayBuffer()).equals(png)).toBe(true);

    /*
     * A name this service never issued is not a path to go looking down. Encoded, so it reaches the
     * route as a parameter rather than being folded away by the client: `../..` in a URL is resolved
     * before the request is sent, and asserting on that only proves the router has no such route.
     */
    const traversal = await fetch(`${API}/v1/avatar/${encodeURIComponent("../../etc/passwd")}`);
    expect(traversal.status).toBe(404);
    expect((await traversal.json()).error).toMatch(/no such picture/);

    await restartApi(API);
    const after = await fetch(`${API}/v1/avatar/${up.id}`);
    expect(after.status, "the picture did not survive a restart").toBe(200);
    expect(Buffer.from(await after.arrayBuffer()).equals(png)).toBe(true);
  });

  it("keeps a share across a restart, because a redeploy must not revoke anybody", async () => {
    // The failure this guards against cost a live deployment its permissions: writes went to a
    // directory the service could not keep, everything looked fine, and the grants were gone at the
    // next deploy. Storage says it is durable — this proves it, with a grant of its own.
    const storage = (await (await fetch(`${API}/healthz`)).json()).config.storage;
    expect(storage).toMatchObject({ durable: true, writable: true, lastError: null });

    const now = Math.floor(Date.now() / 1000);
    const { next } = await (await fetch(`${API}/v1/nonce?wallet=${user.account.address}&domain=x`)).json();
    const intent = baseIntent(user.account, now, {
      domain: "x",
      optIn: true,
      nonce: BigInt(next),
      exp: BigInt(now + 3600),
    });
    const idToken = privy.mint({ sub: user.did, linked: user.linked, now });
    const req = toWire(await signedAttestRequest(user.account, intent, idToken, 31337, deployment.multipass));
    const attested = await (
      await fetch(`${API}/v1/attest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(req),
      })
    ).json();
    expect(attested.error).toBeUndefined();
    const viewCode = bytesToHex(eciesDecrypt(USER_KEY, attested.viewCode));
    await fetch(`${API}/v1/cre/delivery`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-delivery-token": "e2e-delivery-token-0123456789" },
      body: JSON.stringify(attested),
    });

    const name = `alice.${deployment.instanceParent}`;
    const { publicKey } = await (await fetch(`${API}/v1/enclave-key`)).json();
    const box = eciesEncrypt(publicKey, hexToBytes(viewCode as Hex), new Uint8Array(32).fill(21));
    const disclosure = {
      name,
      domains: ["x"],
      audience: zeroAddress as Hex,
      audienceName: "",
      exp: BigInt(now + 3600),
      boxesHash: hashBoxes([box]),
    };
    const grant = await (
      await fetch(`${API}/v1/disclose`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...disclosure,
          exp: disclosure.exp.toString(),
          boxes: [box],
          signature: await signDisclosure(
            user.account,
            disclosure,
            discloseDomain(31337, deployment.multipass)
          ),
        }),
      })
    ).json();
    expect(grant.ok).toBe(true);

    await restartApi(API);

    // Same grant, same id, still readable: nothing about a restart is a revocation.
    const after = await (await fetch(`${API}/v1/disclosures/${name}`)).json();
    expect(after.grants.map((g: { id: string }) => g.id)).toContain(grant.id);
    expect((await fetch(`${API}/v1/disclose/${name}/x`)).status).toBe(200);
  });

  it("attests an account into the DNS domain it belongs to, and names it there", async () => {
    // The platform namespace this deployment mounts: `x.com` under `www`, so the account reads as one.
    const now = Math.floor(Date.now() / 1000);
    const intent = baseIntent(user.account, now, { domain: "x.com", optIn: false, exp: BigInt(now + 3600) });
    const idToken = privy.mint({ sub: user.did, linked: user.linked, now });
    const req = toWire(await signedAttestRequest(user.account, intent, idToken, 31337, deployment.multipass));
    const attested = await (
      await fetch(`${API}/v1/attest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(req),
      })
    ).json();
    expect(attested.error).toBeUndefined();
    expect(fromBytes32(attested.record.domainName)).toBe("x.com");
    expect(fromBytes32(attested.record.name)).toBe("alice");

    const delivered = await (
      await fetch(`${API}/v1/cre/delivery`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-delivery-token": "e2e-delivery-token-0123456789" },
        body: JSON.stringify(attested),
      })
    ).json();
    expect(delivered.ok).toBe(true);

    // The index reads its own write, so the account is named the moment the relay returns.
    const dash = await (await fetch(`${API}/v1/wallet/${user.account.address}`)).json();
    expect(dash.links.find((l: { domain: string }) => l.domain === "x.com")).toMatchObject({
      name: "alice",
      live: true,
      ensName: `alice.com.x.www.${deployment.instanceParent}`,
    });
  });

  it("names a private account after the person, and answers for it as the private branch", async () => {
    // The account itself is a one-time pad on chain. The name says the holder of alice.<root> is on
    // Telegram and stops there, which is the whole claim a verifier gets.
    const now = Math.floor(Date.now() / 1000);
    const intent = baseIntent(user.account, now, {
      domain: "t.me",
      optIn: true,
      exp: BigInt(now + 3600),
    });
    const idToken = privy.mint({ sub: user.did, linked: user.linked, now });
    const req = toWire(await signedAttestRequest(user.account, intent, idToken, 31337, deployment.multipass));
    const attested = await (
      await fetch(`${API}/v1/attest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(req),
      })
    ).json();
    expect(attested.error).toBeUndefined();
    expect(attested.record.payload).not.toBe(`0x${"00".repeat(32)}`);

    await (
      await fetch(`${API}/v1/cre/delivery`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-delivery-token": "e2e-delivery-token-0123456789" },
        body: JSON.stringify(attested),
      })
    ).json();

    const dash = await (await fetch(`${API}/v1/wallet/${user.account.address}`)).json();
    const link = dash.links.find((l: { domain: string }) => l.domain === "t.me");
    const privateName = `alice.me.t.private-www.${deployment.instanceParent}`;
    expect(link).toMatchObject({ optedIn: true, ensName: privateName });
    // Nothing readable about the account is published: the stored name is the pad.
    expect(link.name).toBe("");

    const read = await (await fetch(`${API}/v1/verify/${privateName}`)).json();
    expect(read).toMatchObject({ branch: "private", status: "active", wallet: user.account.address });
    // The open branch has nothing to say about her: she never attested one there.
    const open = await (await fetch(`${API}/v1/verify/alice.me.t.www.${deployment.instanceParent}`)).json();
    expect(open.status).toBe("inactive");
  });

  it("mounts a namespace nobody deployed, on demand, for an ordinary mail host", async () => {
    // `nowhere.test` is in no deploy list. A person with an address there attests, and the relay builds
    // the levels, the instance and the mirror before handing back the signature.
    const now = Math.floor(Date.now() / 1000);
    const linked = [
      { type: "wallet", address: user.account.address, chain_type: "ethereum" },
      { type: "email", address: "alice@nowhere.test" },
    ];
    const idToken = privy.mint({ sub: user.did, linked, now });
    const intent = baseIntent(user.account, now, {
      domain: "nowhere.test",
      optIn: false,
      exp: BigInt(now + 3600),
    });
    const req = toWire(await signedAttestRequest(user.account, intent, idToken, 31337, deployment.multipass));
    const attested = await (
      await fetch(`${API}/v1/attest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(req),
      })
    ).json();
    expect(attested.error).toBeUndefined();
    expect(fromBytes32(attested.record.name)).toBe("alice");

    const { instances } = await (await fetch(`${API}/v1/instances`)).json();
    const mounted = instances.find((i: { domain: string }) => i.domain === "nowhere.test");
    expect(mounted).toMatchObject({
      parentName: `test.nowhere.@.${deployment.instanceParent}`,
      maskedParentName: `test.nowhere.private@.${deployment.instanceParent}`,
    });

    // And the record it was signed for goes through, which is the whole point of mounting first.
    const delivered = await (
      await fetch(`${API}/v1/cre/delivery`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-delivery-token": "e2e-delivery-token-0123456789" },
        body: JSON.stringify(attested),
      })
    ).json();
    expect(delivered.ok).toBe(true);
  });

  it("finds the person behind an account, and ranks people of a name by their references", async () => {
    // The first step of referring someone, against a real chain: alice holds a name and a public `x`
    // account, so both ways of looking for her have to arrive at the same person.
    const found = await (await fetch(`${API}/v1/who?domain=x.com&handle=alice`)).json();
    expect(found).toMatchObject({ found: true, wallet: user.account.address, candidate: "alice" });
    expect(found.standing).toMatchObject({ claimed: true });

    // An account nobody attested is simply absent — no guessing, no partial match.
    const missing = await (await fetch(`${API}/v1/who?domain=x.com&handle=nobody-here`)).json();
    expect(missing.found).toBe(false);

    // And by name: every handle that looks like this, with the references each has received.
    const search = await (await fetch(`${API}/v1/find?q=ali`)).json();
    expect(search.matches.map((m: { handle: string }) => m.handle)).toContain("alice");
    const alice = search.matches.find((m: { handle: string }) => m.handle === "alice");
    expect(alice.received).toBeGreaterThanOrEqual(0);
    expect(alice.claimed).toBe(true);
  });

  it("cannot find a private account without its view code, and finds it with one", async () => {
    // The privacy claim, end to end: the chain holds a one-time pad, so the handle cannot be matched
    // by anyone who was not given the code — and can be matched exactly by anyone who was.
    const now = Math.floor(Date.now() / 1000);
    const { next } = await (
      await fetch(`${API}/v1/nonce?wallet=${user.account.address}&domain=telegram`)
    ).json();
    const intent = baseIntent(user.account, now, {
      domain: "telegram",
      optIn: true,
      nonce: BigInt(next),
      exp: BigInt(now + 3600),
    });
    const idToken = privy.mint({ sub: user.did, linked: user.linked, now });
    const req = toWire(await signedAttestRequest(user.account, intent, idToken, 31337, deployment.multipass));
    const attested = await (
      await fetch(`${API}/v1/attest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(req),
      })
    ).json();
    expect(attested.error).toBeUndefined();
    const viewCode = bytesToHex(eciesDecrypt(USER_KEY, attested.viewCode));
    await fetch(`${API}/v1/cre/delivery`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-delivery-token": "e2e-delivery-token-0123456789" },
      body: JSON.stringify(attested),
    });

    // As `fakeUser` writes it: the stored name is the username, not the person's root handle.
    const handle = "alice_tg";
    const blind = await (await fetch(`${API}/v1/who?domain=telegram&handle=${handle}`)).json();
    expect(blind.found).toBe(false);
    // Said plainly, because reporting "nobody" invites starting a second page for the same person.
    expect(blind.note).toMatch(/private/i);

    const withCode = await (
      await fetch(`${API}/v1/who?domain=telegram&handle=${handle}&viewCode=${viewCode}`)
    ).json();
    expect(withCode).toMatchObject({ found: true, wallet: user.account.address });
  });

  it("provisions the candidate's vouch instance and lets a verified voucher write under it", async () => {
    const now = Math.floor(Date.now() / 1000);
    // Bob: a second human with his own wallet and linked accounts.
    const BOB_KEY = "0x000000000000000000000000000000000000000000000000000000000000b0bb" as const;
    const bob = fakeUser(BOB_KEY, "bob");
    const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
      fetch(`${API}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      });
    const tok = { "x-delivery-token": "e2e-delivery-token-0123456789" };

    // Alice's root claim (earlier test) provisioned ~alice; a second delivery is idempotent.
    const vouches0 = await (await fetch(`${API}/v1/vouches/alice`)).json();
    expect(vouches0).toMatchObject({ handle: "alice", domain: "~alice", vouches: [] });

    // Bob claims his own name first (his vouching identity), then vouches for Alice.
    const claim = toWire(
      await signedAttestRequest(
        bob.account,
        baseIntent(bob.account, now, {
          domain: deployment.instanceDomain,
          handle: "bob",
          payload: toBytes32("hello"),
          exp: BigInt(now + 3600),
        }),
        privy.mint({ sub: bob.did, linked: bob.linked, now }),
        31337,
        deployment.multipass
      )
    );
    const bobClaim = await (await post("/v1/attest", claim)).json();
    const bobDelivered = await (await post("/v1/cre/delivery", bobClaim, tok)).json();
    expect(bobDelivered.ok).toBe(true);
    expect(bobDelivered.vouchInstance).toEqual({ domain: "~bob", created: true });

    const statement = toBytes32("worked together 2019-22");
    const vouchIntent = baseIntent(bob.account, now, {
      domain: "~alice",
      handle: "bob",
      payload: statement,
      exp: BigInt(now + 3600),
    });
    const bobToken = privy.mint({ sub: bob.did, linked: bob.linked, now });

    // Anyone may write a statement: an invitation is evidence the candidate asked, never permission.
    const uninvited = toWire(
      await signedAttestRequest(bob.account, vouchIntent, bobToken, 31337, deployment.multipass)
    );
    expect((await post("/v1/attest", uninvited)).status).toBe(200);

    // And an "invitation" bob signed for himself is worth nothing: only the wallet holding alice's
    // name can say she asked, which this reads on chain.
    const forged = toWire(
      await signedAttestRequest(
        bob.account,
        vouchIntent,
        bobToken,
        31337,
        deployment.multipass,
        await signedInvite(bob.account, "alice", now, 31337, deployment.multipass)
      )
    );
    expect((await post("/v1/attest", forged)).status).toBe(200);

    const vouch = toWire(
      await signedAttestRequest(
        bob.account,
        vouchIntent,
        bobToken,
        31337,
        deployment.multipass,
        await signedInvite(user.account, "alice", now, 31337, deployment.multipass)
      )
    );
    const attested = await (await post("/v1/attest", vouch)).json();
    expect(attested.record).toMatchObject({
      domainName: toBytes32("~alice"),
      name: toBytes32("bob"),
      payload: statement,
    });
    const delivered = await (await post("/v1/cre/delivery", attested, tok)).json();
    expect(delivered.ok).toBe(true);

    // Alice's own invitation counts, so this reference is reported as one she asked for, and the
    // signature travels with it for a verifier to check.
    const listed = await (await fetch(`${API}/v1/vouches/alice`)).json();
    const written = listed.vouches.find((v: { voucher: string }) => v.voucher === "bob");
    expect(written.solicited).toBe(true);
    expect(written.invite).toMatchObject({ handle: "alice" });

    // The index must answer for a record this service wrote a moment ago, with no poll in between.
    const health = await (await fetch(`${API}/healthz`)).json();
    expect(health.index).toMatchObject({ synced: true });
    const aw = await (await fetch(`${API}/v1/wallet/${user.account.address}`)).json();
    const bw = await (await fetch(`${API}/v1/wallet/${bob.account.address}`)).json();
    // Each wallet's dashboard, as the profile page reads it: the name held, the accounts attested and
    // where each is named, and the references written.
    expect(aw.names).toMatchObject([
      { domain: "kju-is", name: "alice", live: true, ensName: `alice.${deployment.instanceParent}` },
    ]);
    const byDomain = new Map(aw.links.map((l: { domain: string }) => [l.domain, l]));
    expect(byDomain.get("x")).toMatchObject({ optedIn: true, ensName: null, nameless: "private" });
    expect(byDomain.get("x.com")).toMatchObject({
      name: "alice",
      ensName: `alice.com.x.www.${deployment.instanceParent}`,
    });
    expect(bw.given).toMatchObject([
      { candidate: "alice", live: true, ensName: `bob.alice.${deployment.instanceParent}` },
    ]);
    const vouches = await (await fetch(`${API}/v1/vouches/alice`)).json();
    expect(vouches.vouches).toHaveLength(1);
    expect(vouches.vouches[0]).toMatchObject({
      voucher: "bob",
      voucherName: `bob.${deployment.instanceParent}`,
      wallet: bob.account.address,
      statement: "worked together 2019-22",
      nonce: "1",
      live: true,
    });

    // The vouch is an ENS name: bob.alice.<root> resolves through the nested instance.
    const name = `bob.alice.${deployment.instanceParent}`;
    const verified = await (await fetch(`${API}/v1/verify/${name}`)).json();
    expect(verified).toMatchObject({
      name,
      status: "active",
      wallet: bob.account.address,
      answer: "worked together 2019-22",
      instance: { domain: "~alice" },
    });
  });

  it("tops up a wallet that holds a live name exactly once, from the relayer", async () => {
    const rpc = createPublicClient({ transport: http(RPC) });
    const before = await rpc.getBalance({ address: user.account.address });
    const dash = await (await fetch(`${API}/v1/wallet/${user.account.address}`)).json();
    expect(dash.balance).toBe(before.toString());
    expect(dash.gasTopup).toEqual({ enabled: true, amount: "2000000000000000", available: true });

    const res = await fetch(`${API}/v1/gas`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wallet: user.account.address }),
    });
    expect(res.status).toBe(200);
    const { hash, amount } = await res.json();
    expect(amount).toBe("2000000000000000");
    expect((await rpc.getTransactionReceipt({ hash })).status).toBe("success");
    expect(await rpc.getBalance({ address: user.account.address })).toBe(before + 2_000_000_000_000_000n);

    const again = await fetch(`${API}/v1/gas`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wallet: user.account.address }),
    });
    expect(again.status).toBe(409);
    const after = await (await fetch(`${API}/v1/wallet/${user.account.address}`)).json();
    expect(after.gasTopup.available).toBe(false);
  });

  it("lets a voucher withdraw without a new invitation, and the record stays in the history", async () => {
    const now = Math.floor(Date.now() / 1000);
    const BOB_KEY = "0x000000000000000000000000000000000000000000000000000000000000b0bb" as const;
    const bob = fakeUser(BOB_KEY, "bob");
    const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
      fetch(`${API}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      });

    // No invite this time: bob already holds a record in ~alice from the previous test.
    const withdrawal = toWire(
      await signedAttestRequest(
        bob.account,
        baseIntent(bob.account, now, {
          domain: "~alice",
          handle: "bob",
          nonce: 2n,
          payload: toBytes32("withdrawn"),
          exp: BigInt(now + 3600),
        }),
        privy.mint({ sub: bob.did, linked: bob.linked, now }),
        31337,
        deployment.multipass
      )
    );
    const attested = await (await post("/v1/attest", withdrawal)).json();
    expect(attested.record.payload).toBe(toBytes32("withdrawn"));
    const delivered = await (
      await post("/v1/cre/delivery", attested, { "x-delivery-token": "e2e-delivery-token-0123456789" })
    ).json();
    expect(delivered.error ?? "").toBe("");
    expect(delivered.ok).toBe(true);

    const vouches = await (await fetch(`${API}/v1/vouches/alice`)).json();
    const mine = vouches.vouches.filter((v: { voucher: string }) => v.voucher === "bob");
    expect(mine.map((v: { statement: string; nonce: string }) => [v.nonce, v.statement])).toEqual([
      ["2", "withdrawn"],
    ]);
    // The earlier statement is gone from the current state but the name still resolves to the wallet.
    const name = `bob.alice.${deployment.instanceParent}`;
    expect((await (await fetch(`${API}/v1/verify/${name}`)).json()).answer).toBe("withdrawn");
  });

  it("serves the whole candidate in one read, matching the per-name endpoint", async () => {
    const profile = await (await fetch(`${API}/v1/profile/alice`)).json();
    expect(profile.handle).toBe("alice");
    expect(profile.standing).toMatchObject({ claimed: true, received: 1 });
    const named = profile.names.find((n: { instance: string }) => n.instance === deployment.instanceDomain);
    expect(named.verification.status).toBe("active");
    const single = await (await fetch(`${API}/v1/verify/${named.name}`)).json();
    expect(named.verification).toEqual(single);
    // This suite is a narrative: by now bob has withdrawn, so assert who wrote it, not what it says.
    expect(profile.vouches[0]).toMatchObject({ voucher: "bob", live: true });
    expect(typeof profile.vouches[0].statement).toBe("string");
  });

  it("provisions a vouch instance for a live handle and refuses one that does not exist", async () => {
    const call = (handle: string) =>
      fetch(`${API}/v1/provision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle }),
      });
    // alice claimed her name earlier in this suite, so her instance is already there: idempotent.
    const res = await call("alice");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ handle: "alice", domain: "~alice", created: false });

    const unknown = await call("nobody");
    expect(unknown.status).toBe(403);
    expect((await unknown.json()).error).toContain("holds no live record");
  });

  /**
   * Two writes only the browser makes: the profile text records the bridge granted the wallet, and
   * the `.eth` alias. Nothing in the API exercises either, so without this the grants could be wrong
   * and every test would still pass.
   */
  it("lets the record's own wallet write its ENS profile, because the bridge granted it", async () => {
    const resolver = parseAbi([
      "function setText(bytes32 node, string key, string value)",
      "function hasTextGrant(bytes name, string key, address account) view returns (bool)",
    ]);
    const name = `alice.${deployment.instanceParent}`;
    const rpc = createPublicClient({ chain: anvil, transport: http(RPC) });
    const dns = (n: string) =>
      `0x${n
        .split(".")
        .map((l) => l.length.toString(16).padStart(2, "0") + Buffer.from(l).toString("hex"))
        .join("")}00` as Hex;

    expect(
      await rpc.readContract({
        address: deployment.permissionedResolver,
        abi: resolver,
        functionName: "hasTextGrant",
        args: [dns(name), "description", user.account.address],
      })
    ).toBe(true);

    // Alice was funded by the gas top-up earlier in this suite, so she can send this herself.
    const hash = await walletFor(USER_KEY).writeContract({
      address: deployment.permissionedResolver,
      abi: resolver,
      functionName: "setText",
      args: [namehash(name), "description", "infra lead at Acme"],
    });
    expect((await rpc.waitForTransactionReceipt({ hash })).status).toBe("success");

    const verified = await (await fetch(`${API}/v1/verify/${name}`)).json();
    expect(verified.profile.description).toBe("infra lead at Acme");

    // A wallet holding no role on that name cannot write it. The deployer can: it keeps the
    // resolver's root roles by design, which is how the bridge was granted anything in the first place.
    const stranger = "0x000000000000000000000000000000000000000000000000000000000000b0bb" as const;
    await expect(
      walletFor(stranger).writeContract({
        address: deployment.permissionedResolver,
        abi: resolver,
        functionName: "setText",
        args: [namehash(name), "description", "not mine to write"],
      })
    ).rejects.toThrow(/Unauthorized|revert/i);
  });

  it("aliases a wallet's own .eth name onto its record through the bridge", async () => {
    const rpc = createPublicClient({ chain: anvil, transport: http(RPC) });
    const ethRegistry = parseAbi([
      "function setLabel(string label, address owner, address sub, address resolver)",
    ]);
    const bridge = parseAbi(["function linkOwnName(bytes32 domain, string label)"]);
    const resolver = parseAbi(["function getAlias(bytes fromName) view returns (bytes)"]);

    // Alice owns `alice.eth` on the mock registry the local deployment uses.
    const labelled = await walletFor(DEPLOYER_KEY).writeContract({
      address: deployment.ethRegistry,
      abi: ethRegistry,
      functionName: "setLabel",
      args: ["alice", user.account.address, zeroAddress, zeroAddress],
    });
    expect((await rpc.waitForTransactionReceipt({ hash: labelled })).status).toBe("success");

    const hash = await walletFor(USER_KEY).writeContract({
      address: deployment.bridge,
      abi: bridge,
      functionName: "linkOwnName",
      args: [toBytes32(deployment.instanceDomain), "alice"],
    });
    expect((await rpc.waitForTransactionReceipt({ hash })).status).toBe("success");

    const dns = (n: string) =>
      `0x${n
        .split(".")
        .map((l) => l.length.toString(16).padStart(2, "0") + Buffer.from(l).toString("hex"))
        .join("")}00` as Hex;
    const target = await rpc.readContract({
      address: deployment.permissionedResolver,
      abi: resolver,
      functionName: "getAlias",
      args: [dns(`${deployment.instanceDomain}.alice.eth`)],
    });
    expect(target).toBe(dns(`alice.${deployment.instanceParent}`));
  });

  /**
   * The university case: an organisation writes for someone who has never used this product. Nothing
   * else is in place — no invitation, no candidate name, no vouch instance — so if any of that is
   * really required, this fails.
   */
  it("lets an ordinary person refer someone who has claimed nothing, and marks it unsolicited", async () => {
    // The headline of the open model, end to end: no invitation, no organisation, and a subject who
    // holds no name. The relay builds their vouch instance from the signed record, and the reference
    // waits there for whoever claims the handle.
    const now = Math.floor(Date.now() / 1000);
    const REFERRER_KEY = "0x00000000000000000000000000000000000000000000000000000000000000cc" as const;
    const referrer = fakeUser(REFERRER_KEY, "dave");
    const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
      fetch(`${API}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      });

    // Nobody holds "erin", so no invitation exists and none can.
    expect((await (await fetch(`${API}/v1/name/${deployment.instanceDomain}/erin`)).json()).live).toBe(false);

    const wire = toWire(
      await signedAttestRequest(
        referrer.account,
        baseIntent(referrer.account, now, {
          domain: "~erin",
          handle: "dave",
          payload: toBytes32("worked together 2020-23"),
          exp: BigInt(now + 3600),
        }),
        privy.mint({ sub: referrer.did, linked: referrer.linked, now }),
        31337,
        deployment.multipass
      )
    );
    const attested = await (await post("/v1/attest", wire)).json();
    expect(attested.error).toBeUndefined();
    const delivered = await (
      await post("/v1/cre/delivery", attested, { "x-delivery-token": "e2e-delivery-token-0123456789" })
    ).json();
    expect(delivered.error ?? "").toBe("");
    expect(delivered).toMatchObject({ ok: true });

    // The reference stands, and says plainly that erin never asked for it.
    const listed = await (await fetch(`${API}/v1/vouches/erin`)).json();
    const written = listed.vouches.find((v: { voucher: string }) => v.voucher === "dave");
    expect(written).toMatchObject({ statement: "worked together 2020-23", live: true, solicited: false });

    // And erin is now findable as someone with a reference waiting, though she has claimed nothing.
    const standing = await (await fetch(`${API}/v1/standing/erin`)).json();
    expect(standing).toMatchObject({ claimed: false, received: 1 });
  });

  it("lets an onboarded organisation write a letter before the person exists", async () => {
    const now = Math.floor(Date.now() / 1000);
    const ORG_KEY = "0x00000000000000000000000000000000000000000000000000000000000000aa" as const;
    const org = fakeUser(ORG_KEY, "acme-university");
    const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
      fetch(`${API}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      });

    const onboarded = await post(
      "/v1/org",
      { wallet: org.account.address, label: "acme-university" },
      { "x-org-token": "e2e-org-token-0123456789abcdef" }
    );
    expect(onboarded.status).toBe(200);
    expect(await onboarded.json()).toMatchObject({ ok: true, renewal: false });

    // Nobody holds "carol": no invitation exists and none can.
    expect((await (await fetch(`${API}/v1/name/${deployment.instanceDomain}/carol`)).json()).live).toBe(
      false
    );
    const letter = toWire(
      await signedAttestRequest(
        org.account,
        baseIntent(org.account, now, {
          domain: "~carol",
          handle: "acme-university",
          payload: toBytes32("graduated 2021"),
          exp: BigInt(now + 3600),
        }),
        privy.mint({ sub: org.did, linked: org.linked, now }),
        31337,
        deployment.multipass
      )
    );
    const attested = await (await post("/v1/attest", letter)).json();
    expect(attested.error).toBeUndefined();

    const submitted = await (await post("/v1/submit", attested)).json();
    expect(submitted.error ?? "").toBe("");
    expect(submitted.ok).toBe(true);

    // The vouch instance followed the record rather than a name that does not exist.
    const instances = (await (await fetch(`${API}/v1/instances`)).json()).instances.map(
      (i: { domain: string }) => i.domain
    );
    expect(instances).toContain("~carol");

    const vouches = await (await fetch(`${API}/v1/vouches/carol`)).json();
    expect(vouches.vouches).toMatchObject([
      { voucher: "acme-university", statement: "graduated 2021", live: true },
    ]);

    // The page a graduate lands on: unclaimed, with the letter already there.
    const profile = await (await fetch(`${API}/v1/profile/carol`)).json();
    expect(profile.standing).toMatchObject({ claimed: false, received: 1 });
    expect(profile.names[0].verification.status).toBe("inactive");
  });

  it("rejects a replayed record", async () => {
    const now = Math.floor(Date.now() / 1000);
    const intent = baseIntent(user.account, now, {
      domain: "x",
      optIn: true,
      nonce: 1n,
      exp: BigInt(now + 3600),
    });
    const idToken = privy.mint({ sub: user.did, linked: user.linked, now });
    const req = toWire(await signedAttestRequest(user.account, intent, idToken, 31337, deployment.multipass));
    const res = await fetch(`${API}/v1/attest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "intent: nonce not increasing" });
  });
});

/**
 * Proof of humanity, end to end against a stubbed Developer Portal (`world-stub.mjs`).
 *
 * The stub stands in for the zero-knowledge verification, which is World's half of the exchange and
 * cannot be reproduced here. Everything on this side of the boundary is real: the request signature
 * is checked against the key the deployment is configured with, the proof is refused unless it is
 * bound to the wallet asking, the record lands on anvil, and the name resolves through the ENS shim
 * to the credential — including across the restart that a redeploy would be.
 */
describe("proof of humanity", () => {
  /** The key the compose stack signs proof requests with. Its address is what World would know us by. */
  const WORLD_SIGNING_KEY = "0x000000000000000000000000000000000000000000000000000000000000d00d" as const;
  const human = fakeUser("0x0000000000000000000000000000000000000000000000000000000000c0ffee", "hugo");
  /** A second wallet, for the person who tries to spend somebody else's proof. */
  const impostor = fakeUser("0x000000000000000000000000000000000000000000000000000000000000dead", "mallory");

  /** A proof shaped as IDKit returns one, bound to `wallet` and carrying who the stub should answer as. */
  const proofFor = (wallet: Hex, identity: string, extra: Record<string, unknown> = {}) => ({
    protocol_version: 4,
    action: "humanity",
    // Hashed the way IDKit hashes it: a wallet reads as hex, so it is the 20 bytes it spells and not
    // the 42 characters. Hashing the text produced a different field element and the server refused
    // every sound proof as unbound.
    responses: [{ identifier: "orb", signal_hash: hashSignal(wallet.toLowerCase()) }],
    e2e_identity: identity,
    ...extra,
  });

  const prove = (wallet: Hex, proof: unknown) =>
    fetch(`${API}/v1/humanity`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wallet, proof }),
    });

  it("says this deployment can ask for a proof at all", async () => {
    expect((await (await fetch(`${API}/v1/instances`)).json()).humanity).toBe(true);
  });

  it("signs the proof request with the key World knows this app by", async () => {
    const res = await fetch(`${API}/v1/humanity/challenge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wallet: human.account.address }),
    });
    const challenge = await res.json();
    expect(challenge).toMatchObject({ app_id: "app_e2e", action: "humanity", environment: "staging" });
    // The signal is the wallet, which is what binds the proof to one account.
    expect(challenge.signal).toBe(human.account.address.toLowerCase());

    const { nonce, created_at, expires_at, signature, rp_id } = challenge.rp_context;
    expect(rp_id).toBe("rp_e2e");
    expect(expires_at).toBeGreaterThan(created_at);
    // The signature is the whole reason the widget opens: recover it, and check the deployment signs
    // as the key it was configured with rather than as anybody else.
    const signer = await recoverMessageAddress({
      message: { raw: rpSignatureMessage(nonce, created_at, expires_at, "humanity") },
      signature,
    });
    expect(signer).toBe(privateKeyToAccount(WORLD_SIGNING_KEY).address);
  });

  it("refuses a proof that is not bound to the wallet asking", async () => {
    // Mallory replays Hugo's proof under her own wallet. It never reaches World.
    const res = await prove(impostor.account.address, proofFor(human.account.address, "hugo"));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain("not bound to");
  });

  it("refuses a proof for another action", async () => {
    const res = await prove(
      human.account.address,
      proofFor(human.account.address, "hugo", { action: "some-other-app" })
    );
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain("some-other-app");
  });

  it("refuses a proof World itself rejects", async () => {
    const res = await prove(
      human.account.address,
      proofFor(human.account.address, "hugo", { e2e_reject: "expired root" })
    );
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain("expired root");
  });

  it("writes the human on chain, and the wallet reports it", async () => {
    const res = await prove(human.account.address, proofFor(human.account.address, "hugo"));
    expect(res.status).toBe(200);
    const proved = await res.json();
    expect(proved).toMatchObject({ ok: true, level: "orb", renewal: false });
    expect(proved.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    // sha256("hugo"), as the stub answers — stored padded to bytes32 rather than as the text it arrived as.
    expect(proved.nullifier).toBe(`0x${createHash("sha256").update("hugo").digest("hex")}`);

    const wallet = await (await fetch(`${API}/v1/wallet/${human.account.address}`)).json();
    expect(wallet.humanity).toMatchObject({ level: "orb" });
    expect(new Date(wallet.humanity.until).getTime()).toBeGreaterThan(Date.now());
  });

  it("answers ketsuban:humanity on the person's own name, through the resolver", async () => {
    const now = Math.floor(Date.now() / 1000);
    const intent = baseIntent(human.account, now, {
      domain: deployment.instanceDomain,
      handle: "hugo",
      payload: toBytes32("a real person"),
      exp: BigInt(now + 3600),
    });
    const idToken = privy.mint({ sub: human.did, linked: human.linked, now });
    const req = toWire(
      await signedAttestRequest(human.account, intent, idToken, 31337, deployment.multipass)
    );
    const attested = await (
      await fetch(`${API}/v1/attest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(req),
      })
    ).json();
    const delivered = await (
      await fetch(`${API}/v1/cre/delivery`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-delivery-token": "e2e-delivery-token-0123456789" },
        body: JSON.stringify(attested),
      })
    ).json();
    expect(delivered.ok).toBe(true);

    // The record is keyed by wallet in a domain of its own, so this is the resolver hopping from the
    // name to the humanity domain — the read a verifier actually performs.
    const name = `hugo.${deployment.instanceParent}`;
    const verified = await (await fetch(`${API}/v1/verify/${name}`)).json();
    expect(verified.humanity).toMatchObject({ level: "orb" });
    expect(verified.evidence).toContain("humanity_attestation");
  });

  it("renews the same person's own proof without calling it a second human", async () => {
    const res = await prove(human.account.address, proofFor(human.account.address, "hugo"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, renewal: true });
  });

  it("refuses one human a second account, and still refuses after a restart", async () => {
    const res = await prove(impostor.account.address, proofFor(impostor.account.address, "hugo"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("already held by another account");

    // The binding is what makes this "one human, one account"; a redeploy that forgot it would hand
    // that human a fresh account every time the container restarted.
    await restartApi(API);
    const after = await prove(impostor.account.address, proofFor(impostor.account.address, "hugo"));
    expect(after.status).toBe(409);

    // A different person is still welcome.
    const other = await prove(impostor.account.address, proofFor(impostor.account.address, "mallory"));
    expect(other.status).toBe(200);
    expect(await other.json()).toMatchObject({ ok: true, level: "orb" });
  });
});

/**
 * The letter a reference carries.
 *
 * A title lives in the record; the letter is an ENS `description` on the name that record creates, and
 * the writer signs it with their own wallet. That grant is a different question from the one already
 * covered: a person writing their own profile writes under a root name, while a letter is written
 * under the candidate's vouch instance — somebody else's namespace, mounted on demand. Unit tests
 * cannot tell the two apart, because both are the same call to a mocked signer.
 */
describe("a reference's letter", () => {
  const BOB_KEY = "0x000000000000000000000000000000000000000000000000000000000000b0bb" as const;
  const resolverAbi = parseAbi([
    "function setText(bytes32 node, string key, string value)",
    "function hasTextGrant(bytes name, string key, address account) view returns (bool)",
  ]);
  const dns = (n: string) =>
    `0x${n
      .split(".")
      .map((l) => l.length.toString(16).padStart(2, "0") + Buffer.from(l).toString("hex"))
      .join("")}00` as Hex;

  it("is written by the voucher onto the name their reference created", async () => {
    const bob = fakeUser(BOB_KEY, "bob");
    const listed = await (await fetch(`${API}/v1/vouches/alice`)).json();
    const written = listed.vouches.find((v: { voucher: string }) => v.voucher === "bob");
    expect(written, "the vouch suite must have run first").toBeDefined();
    const name = written.ensName as string;
    expect(name).toBe(`bob.alice.${deployment.instanceParent}`);

    const rpc = createPublicClient({ chain: anvil, transport: http(RPC) });
    // The grant is on the vouch instance, which was mounted for alice when her name landed.
    expect(
      await rpc.readContract({
        address: deployment.permissionedResolver,
        abi: resolverAbi,
        functionName: "hasTextGrant",
        args: [dns(name), "description", bob.account.address],
      })
    ).toBe(true);

    // Bob pays for his own letter and has never been funded: the gas top-up is for a wallet holding a
    // name, and his record is in alice's vouch domain. Anvil's deployer stands in for having some.
    const funded = await walletFor(DEPLOYER_KEY).sendTransaction({
      to: bob.account.address,
      value: 10n ** 17n,
    });
    // Waited for, not just sent: the next call estimates gas against his balance, and an unmined
    // transfer leaves that at zero.
    await rpc.waitForTransactionReceipt({ hash: funded });

    const letter = "We worked together for three years on the same team.";
    const hash = await walletFor(BOB_KEY).writeContract({
      address: deployment.permissionedResolver,
      abi: resolverAbi,
      functionName: "setText",
      args: [namehash(name), "description", letter],
    });
    expect((await rpc.waitForTransactionReceipt({ hash })).status).toBe("success");

    // And the page that shows references reads it back, which is the whole point of writing it there.
    const after = await (await fetch(`${API}/v1/vouches/alice`)).json();
    expect(after.vouches.find((v: { voucher: string }) => v.voucher === "bob").letter).toBe(letter);
  });

  it("cannot be written on somebody else's reference", async () => {
    // The name is in alice's namespace, but it is bob's reference; alice holding the namespace must
    // not let her put words in it.
    const name = `bob.alice.${deployment.instanceParent}`;
    await expect(
      walletFor(USER_KEY).writeContract({
        address: deployment.permissionedResolver,
        abi: resolverAbi,
        functionName: "setText",
        args: [namehash(name), "description", "not mine to write"],
      })
    ).rejects.toThrow(/Unauthorized|revert/i);
  });
});
