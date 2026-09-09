/**
 * Docker e2e: anvil + deployed contracts + the API image, driven from the host.
 *
 *   pnpm --filter @ketsuban/api test:e2e
 *
 * Requires docker compose; `global-setup.ts` boots the compose file, which deploys
 * `DeployLocal.s.sol` into anvil and starts the API image against it. The full loop is exercised: intent → attest (node registrar) → delivery →
 * bridge.verify on chain → name resolves through the ENS shim → verify endpoint.
 */
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import {
  bytesToHex,
  createPublicClient,
  createWalletClient,
  http,
  namehash,
  parseAbi,
  zeroAddress,
  zeroHash,
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
import { eciesDecrypt } from "@ketsuban/registrar";
import { decodeRecord, MultipassAbi, toBytes32 } from "@peeramid-labs/multipass-client";
import { APP_ID, PRIVY_SEED } from "./global-setup.js";

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
});

describe("api e2e", () => {
  it("preflights the deployment it is pointed at", async () => {
    const res = await fetch(`${API}/v1/preflight`);
    expect(res.status).toBe(200);
    const p = await res.json();
    expect(p.ok).toBe(true);
    expect(p.warnings).toEqual([]);
    expect(p.bridge).toMatchObject({ deployed: true, missing: [] });
    // The key this service signs with must be the one Multipass expects for those domains.
    expect(p.registrar.onchain).toEqual([p.registrar.signsAs]);
    expect(BigInt(p.relayer.balance)).toBeGreaterThan(0n);
    expect(p.factory.instances).toContain(deployment.instanceDomain);
    // Every domain the attester may be asked for, platform domains included: an uninitialised one
    // reverts with `invalidDomain` only after the user has signed.
    expect(p.multipass.domains.map((d: { domain: string }) => d.domain)).toEqual([
      deployment.instanceDomain,
      "x",
      "telegram",
      "discord",
      "github",
      "google",
      "linkedin",
      "email",
    ]);
    expect(
      p.multipass.domains.every((d: { initialised: boolean; active: boolean }) => d.initialised && d.active)
    ).toBe(true);
  });

  it("lists the deployed instance", async () => {
    const { instances } = await (await fetch(`${API}/v1/instances`)).json();
    expect(instances).toHaveLength(1);
    expect(instances[0]).toMatchObject({
      domain: deployment.instanceDomain,
      parentName: deployment.instanceParent,
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
    expect(masked.links).toEqual([{ domain: "x", optedIn: true, commitment: attested.record.payload }]);

    const disclosed = await (await fetch(`${API}/v1/verify/${name}?links=x&viewCode=${viewCode}`)).json();
    expect(disclosed.links[0].disclosed).toEqual({ handle: "alice", platformId: "1234567890123456789" });
    expect(disclosed.evidence).toContain("x_account_control");
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

    // A statement needs the candidate's invitation: alice signs one, nobody else can.
    const uninvited = toWire(
      await signedAttestRequest(bob.account, vouchIntent, bobToken, 31337, deployment.multipass)
    );
    const refused = await post("/v1/attest", uninvited);
    expect(refused.status).toBe(422);
    expect((await refused.json()).error).toContain("needs the candidate's invitation");

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
    expect((await post("/v1/attest", forged)).status).toBe(422);

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

    // The index must answer for a record this service wrote a moment ago, with no poll in between.
    const health = await (await fetch(`${API}/healthz`)).json();
    expect(health.index).toMatchObject({ synced: true });
    const aw = await (await fetch(`${API}/v1/wallet/${user.account.address}`)).json();
    const bw = await (await fetch(`${API}/v1/wallet/${bob.account.address}`)).json();
    console.log(
      "DEBUG idx",
      JSON.stringify(health.index),
      "alice",
      JSON.stringify({ n: aw.names, l: aw.links, g: aw.given }),
      "bob",
      JSON.stringify({ n: bw.names, l: bw.links, g: bw.given })
    );
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
