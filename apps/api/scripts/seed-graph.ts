/**
 * A namespace worth looking at.
 *
 * The reference map shows whether the people behind somebody know each other, and a deployment with
 * four names and three references has nothing for it to show. This writes a namespace shaped like the
 * real thing — one honest cluster around people who proved humanity, one ring of accounts that only
 * refer each other, one bridge between them, and a few newcomers — so a four-minute demo has a graph
 * to walk.
 *
 * Every record it writes is a real one: registrar-signed, relayed through `/v1/submit`, readable in
 * any ENS client. What it skips is the identity token, which is why it needs the registrar key and is
 * an operator's tool rather than a route.
 *
 *   API_URL=http://127.0.0.1:18787 REGISTRAR_KEY=0x… pnpm --filter @ketsuban/api seed:graph
 *
 * Idempotent in effect: a name already held is skipped, a reference already standing is left alone.
 */
import { keccak256, stringToBytes, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { signRecord } from "@ketsuban/registrar";
import { toBytes32 } from "@peeramid-labs/multipass-client";

/** Who exists, who proved humanity, and who stands behind whom. */
export type Plan = {
  people: { handle: string; human: boolean }[];
  /** `from` put their name behind `to`, with these words */
  references: { from: string; to: string; says: string }[];
};

/**
 * The shape, chosen so the map has something to say.
 *
 * - `mira`, `theo`, `sana`, `kofi`, `lena`: a team. Three of them proved humanity. They refer each
 *   other the way colleagues do — most pairs, not all, and not always both ways.
 * - `ring-a` … `ring-e`: five accounts wired to each other in every direction and to nobody else,
 *   which is what a bought cluster looks like on chain.
 * - `ring-a` also refers `kofi`: the one bridge, which is how such a ring tries to look connected.
 * - `nadia`: a newcomer with one honest reference from `mira`, who looks exactly like a fake with one
 *   bought reference — which is the point the caveat makes.
 */
export function plan(): Plan {
  const team = ["mira", "theo", "sana", "kofi", "lena"];
  const ring = ["ring-a", "ring-b", "ring-c", "ring-d", "ring-e"];
  const people = [
    ...team.map((h) => ({ handle: h, human: ["mira", "theo", "sana"].includes(h) })),
    ...ring.map((h) => ({ handle: h, human: false })),
    { handle: "nadia", human: false },
  ];
  const references: Plan["references"] = [];
  // A statement is the record's payload, and a Multipass payload is bytes32: 31 bytes is all it holds.
  const say = (from: string, to: string, says: string) => references.push({ from, to, says });

  // The team: most pairs, some both ways, none of them everybody.
  say("theo", "mira", "led the platform team with her");
  say("sana", "mira", "shipped two launches together");
  say("kofi", "mira", "reviewed my code for a year");
  say("mira", "theo", "the steadiest engineer I know");
  say("sana", "theo", "on call together, never dropped");
  say("mira", "sana", "ran incident response with her");
  say("lena", "sana", "hired her, would again");
  say("theo", "kofi", "paired for six months");
  say("mira", "lena", "managed me, fairly");
  say("kofi", "lena", "she unblocked our whole team");

  // The ring: everybody refers everybody, and nobody else.
  for (const a of ring) for (const b of ring) if (a !== b) say(a, b, "great to work with");

  // The bridge, and the newcomer.
  say("ring-a", "kofi", "worked together");
  say("mira", "nadia", "promising, one project in");

  return { people, references };
}

/** A wallet per handle, derived so the same handle always seeds the same wallet. */
export function walletFor(handle: string, salt: string): { key: Hex; address: Address } {
  const key = keccak256(stringToBytes(`ketsuban-seed:${salt}:${handle}`));
  return { key, address: privateKeyToAccount(key).address };
}

type Deployment = {
  chainId: number;
  multipass: Address;
  nameDomains: string[];
  humanityDomain: string;
  vouchPrefix: string;
};

async function deployment(api: string): Promise<Deployment> {
  const h = (await (await fetch(`${api}/healthz`)).json()) as { config: Record<string, unknown> };
  const c = h.config;
  return {
    chainId: Number(c.chainId),
    multipass: c.multipass as Address,
    nameDomains: c.nameDomains as string[],
    humanityDomain: c.humanityDomain as string,
    vouchPrefix: c.vouchPrefix as string,
  };
}

async function nonce(
  api: string,
  wallet: Address,
  domain: string
): Promise<{ next: bigint; ready: boolean; reason: string | null }> {
  const r = (await (
    await fetch(`${api}/v1/nonce?wallet=${wallet}&domain=${encodeURIComponent(domain)}`)
  ).json()) as {
    next: string;
    ready: boolean;
    reason: string | null;
  };
  return { next: BigInt(r.next), ready: r.ready, reason: r.reason };
}

async function held(api: string, domain: string, handle: string): Promise<boolean> {
  const r = (await (await fetch(`${api}/v1/name/${encodeURIComponent(domain)}/${handle}`)).json()) as {
    live?: boolean;
  };
  return !!r.live;
}

/** Write one registrar-signed record through the relay. */
async function write(
  api: string,
  registrarKey: Hex,
  d: Deployment,
  eip712: { name: string; version: string },
  record: { domain: string; name: Hex; id: Hex; wallet: Address; payload: Hex }
): Promise<string> {
  const n = await nonce(api, record.wallet, record.domain);
  if (!n.ready && n.reason && !/vouch/.test(n.reason)) throw new Error(`${record.domain}: ${n.reason}`);
  const message = {
    name: record.name,
    id: record.id,
    domainName: toBytes32(record.domain),
    validUntil: BigInt(Math.floor(Date.now() / 1000) + 30 * 86_400),
    nonce: n.next,
    wallet: record.wallet,
    payload: record.payload,
  };
  const signature = await signRecord(message, registrarKey, {
    chainId: d.chainId,
    multipass: d.multipass,
    eip712,
  });
  const res = await fetch(`${api}/v1/submit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      record: { ...message, validUntil: message.validUntil.toString(), nonce: message.nonce.toString() },
      signature,
    }),
  });
  const body = (await res.json()) as { ok?: boolean; txHash?: string; error?: string };
  if (!body.ok) throw new Error(`${record.domain}/${record.name}: ${body.error ?? res.status}`);
  return body.txHash ?? "";
}

export async function apply(
  p: Plan,
  opts: {
    api: string;
    registrarKey: Hex;
    salt: string;
    eip712: { name: string; version: string };
    log?: (s: string) => void;
  }
): Promise<{ names: number; humans: number; references: number }> {
  const log = opts.log ?? (() => {});
  const d = await deployment(opts.api);
  const root = d.nameDomains[0];
  if (!root) throw new Error("this deployment has no name domain to seed");
  const wallets = new Map(p.people.map((x) => [x.handle, walletFor(x.handle, opts.salt)]));
  let names = 0;
  let humans = 0;
  let references = 0;

  // Names first: a reference lands in the candidate's vouch domain, which their name creates.
  for (const person of p.people) {
    const w = wallets.get(person.handle)!;
    if (await held(opts.api, root, person.handle)) {
      log(`name  ${person.handle} — already held`);
    } else {
      await write(opts.api, opts.registrarKey, d, opts.eip712, {
        domain: root,
        name: toBytes32(person.handle),
        id: keccak256(stringToBytes(`seed-id:${opts.salt}:${person.handle}`)),
        wallet: w.address,
        payload: toBytes32(""),
      });
      names += 1;
      log(`name  ${person.handle} ← ${w.address}`);
    }
    if (person.human) {
      const have = await nonce(opts.api, w.address, d.humanityDomain);
      if (have.next > 1n) {
        log(`human ${person.handle} — already proved`);
      } else {
        await write(opts.api, opts.registrarKey, d, opts.eip712, {
          domain: d.humanityDomain,
          name: toHex(0, { size: 32 }),
          // Where World would put a nullifier: one that nobody else can have, derived the same way.
          id: keccak256(stringToBytes(`seed-nullifier:${opts.salt}:${person.handle}`)),
          wallet: w.address,
          payload: toBytes32("selfie"),
        });
        humans += 1;
        log(`human ${person.handle} — proved`);
      }
    }
  }

  // Then what each of them said about the others.
  for (const r of p.references) {
    const from = wallets.get(r.from)!;
    const domain = `${d.vouchPrefix}${r.to}`;
    if (await held(opts.api, domain, r.from)) {
      log(`ref   ${r.from} → ${r.to} — already standing`);
      continue;
    }
    await write(opts.api, opts.registrarKey, d, opts.eip712, {
      domain,
      name: toBytes32(r.from),
      id: keccak256(stringToBytes(`seed-ref:${opts.salt}:${r.from}>${r.to}`)),
      wallet: from.address,
      payload: toBytes32(r.says),
    });
    references += 1;
    log(`ref   ${r.from} → ${r.to} "${r.says}"`);
  }
  return { names, humans, references };
}

// Run directly: `pnpm --filter @ketsuban/api seed:graph`.
if (process.argv[1] && /seed-graph\.(ts|js)$/.test(process.argv[1])) {
  const api = (process.env.API_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
  const registrarKey = process.env.REGISTRAR_KEY as Hex | undefined;
  if (!registrarKey) {
    console.error("REGISTRAR_KEY is required: every record here is registrar-signed");
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
}
