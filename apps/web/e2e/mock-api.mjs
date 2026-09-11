/**
 * A stand-in for the attester, for the browser tests.
 *
 * The content pages are server components: they fetch from Node, not from the page, so `page.route`
 * cannot reach them and every one of them used to degrade to an error card. That made the suite prove
 * the shell fits a phone and nothing about the pages inside it.
 *
 * This answers the reads those pages make, with fixtures chosen to be awkward rather than tidy — long
 * ENS names, a masked account, a withdrawn reference — because a layout only breaks on the content
 * that does not fit. Anything it does not know answers 404, and the pages must survive that too.
 */
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

const PORT = Number(process.env.PORT ?? 8098);
const ROOT = "ketsuban.eth";

const verification = (name) => ({
  name,
  instance: { domain: "ketsuban", parentName: ROOT },
  branch: "open",
  status: "active",
  wallet: "0xEE4811b9462956C9C3535E79c08776D769CA9F3a",
  answer: null,
  expiresAt: "2027-01-01T00:00:00.000Z",
  humanity: { level: "selfie", until: "2027-01-01T00:00:00.000Z" },
  links: [
    { domain: "x.com", optedIn: false, ensName: `averyverylonghandleindeed.com.x.www.${ROOT}` },
    { domain: "google.com", optedIn: true, commitment: "0x02", ensName: `alice.com.google.private-www.${ROOT}` },
  ],
  references: [
    {
      kind: "answer",
      subject: "kju-is",
      subjectName: `kju-is.${ROOT}`,
      statement: "a terrible dictator",
      ensName: `alice.kju-is.${ROOT}`,
      validUntil: "2027-01-01T00:00:00.000Z",
    },
  ],
  profile: {
    avatar: null,
    description: "Platform engineer, previously at a company with a fairly long name.",
    url: "https://alice.example",
    email: null,
  },
  evidence: ["wallet_binding", "humanity_attestation", "x_account_control"],
  decision: "additional_context_available",
  warning: "This is not identity, employment, safety, malware, nationality, or affiliation verification.",
});

const vouches = (handle) => ({
  handle,
  domain: `~${handle}`,
  warning: "This is not identity verification.",
  vouches: [
    {
      voucher: "bob",
      voucherName: `bob.${ROOT}`,
      ensName: `bob.${handle}.${ROOT}`,
      wallet: "0xd70B5E8A232Bf67F64658cbDDebe32e1443894a0",
      statement: "Ran the platform team while I was there",
      validUntil: "2027-01-01T00:00:00.000Z",
      nonce: "1",
      live: true,
      solicited: false,
      invite: null,
      standing: { claimed: true, given: 2, received: 1 },
      letter: "We worked together for three years on the same team.",
    },
  ],
});

export const routes = [
  [
    /^\/v1\/instances$/,
    () => ({
      // Shaped as the attester answers: a mount carries the contracts a wallet writes to itself, and
      // the bridge is an address rather than nothing. Parsed here by `mock-api.test.ts`, because the
      // page catches a failed read and renders an empty state that reads exactly like a working one.
      instances: [
        {
          domain: "ketsuban",
          registry: "0x254D9c7601BD8fa6b6FA7f5A42c860d184E053A7",
          resolver: "0xa2602ce1A469d7FF1090aE4b876BA4ec566D3873",
          parentName: ROOT,
          parentLabel: "ketsuban",
        },
      ],
      bridge: "0xC7283bD9Aad1B08947C841536946Ce4dA9c99929",
      permissionedResolver: null,
      ethRegistry: null,
      paymentToken: null,
      humanity: true,
    }),
  ],
  // `nobody.*` is the name the attester cannot answer for, so a page can be tested against a refusal
  // as well as against an answer.
  [/^\/v1\/verify\/(?!nobody)([^/?]+)/, (m) => verification(decodeURIComponent(m[1]))],
  [/^\/v1\/vouches\/([^/?]+)/, (m) => vouches(decodeURIComponent(m[1]))],
  // The subject page: a name people answer under, which the deployment is built around. Without this
  // the route falls through to a person's card and the page the demo turns on is never rendered.
  [
    /^\/v1\/instance\/([^/?]+)/,
    (m) => ({
      domain: decodeURIComponent(m[1]),
      parentName: `${decodeURIComponent(m[1])}.${ROOT}`,
      description: "Kim Jong Un, Supreme Leader of North Korea.",
      records: {
        name: "Kim Jong Un",
        description:
          "Kim Jong Un, Supreme Leader of North Korea. The United States and allied governments attribute the Lazarus Group to the DPRK.",
        url: "https://home.treasury.gov/news/press-releases/sm774",
        avatar: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d0/x.jpg/330px-x.jpg",
      },
      answers: [
        {
          handle: "alice",
          ensName: `alice.${decodeURIComponent(m[1])}.${ROOT}`,
          answer: "a terrible dictator",
          validUntil: "2027-01-01T00:00:00.000Z",
        },
      ],
      warning: "This is not identity verification.",
    }),
  ],
  /*
   * The independent read: the same names resolved through the UniversalResolver rather than through
   * this service. It is the product's own claim about itself, and without a route here the appendix
   * that makes it silently does not render.
   */
  [
    /^\/v1\/ens\/([^/?]+)/,
    (m) => {
      const name = decodeURIComponent(m[1].split("?")[0]);
      return {
        name,
        universalResolver: "0x4A1817d13E9cF196f471725176355C1234b63C70",
        resolver: "0x178ff1589Be8Af3B19426Aa1d2Bd07cd178E215e",
        addr: "0xEE4811b9462956C9C3535E79c08776D769CA9F3a",
        texts: { name: "", avatar: "" },
        status: "active",
        warning: "This is not identity verification.",
      };
    },
  ],
  /*
   * A wallet, and what it holds. The page was only ever seen degraded, because nothing here answered
   * for it — so every list it renders was untested while the error card it falls back to was not.
   */
  [
    /^\/v1\/wallet\/([^/?]+)/,
    (m) => ({
      address: decodeURIComponent(m[1]),
      org: null,
      humanity: { level: "selfie", until: "2027-01-01T00:00:00.000Z" },
      names: [
        {
          domain: "ketsuban",
          name: "alice",
          payload: "",
          validUntil: "2027-01-01T00:00:00.000Z",
          nonce: "1",
          live: true,
          ensName: `alice.${ROOT}`,
        },
      ],
      links: [
        {
          domain: "google.com",
          name: "",
          payload: "",
          validUntil: "2027-01-01T00:00:00.000Z",
          nonce: "2",
          live: true,
          optedIn: true,
          ensName: null,
          nameless: "private",
        },
      ],
      given: [
        {
          domain: "~bob",
          name: "alice",
          payload: "worked with them for years",
          validUntil: "2027-01-01T00:00:00.000Z",
          nonce: "1",
          live: true,
          candidate: "bob",
          ensName: `alice.bob.${ROOT}`,
        },
      ],
      balance: "1000000000000000000",
      gasTopup: { enabled: false, amount: "0", available: false },
      warning: "This is not identity verification.",
    }),
  ],
  [
    /^\/v1\/reverse\/([^/?]+)/,
    (m) => ({
      address: decodeURIComponent(m[1]),
      name: `alice.${ROOT}`,
      // Each name carries where it was read and what kind it is; the wallet page groups by that, and
      // a bare list of strings quietly produced a page with nothing on it.
      names: [
        {
          domain: "ketsuban",
          name: `alice.${ROOT}`,
          resolver: "0xa2602ce1A469d7FF1090aE4b876BA4ec566D3873",
          kind: "name",
        },
      ],
      primary: `alice.${ROOT}`,
      note: "answered from the Multipass record, not from a reverse registry",
    }),
  ],
  // The search the front page opens on, and the first step of checking a candidate.
  [
    /^\/v1\/find/,
    (m, url) => {
      const q = (new URL(url, "http://x").searchParams.get("q") ?? "").toLowerCase();
      const people = [
        { handle: "alice", wallet: "0xEE4811b9462956C9C3535E79c08776D769CA9F3a", claimed: true, given: 0, received: 2 },
        { handle: "bob", wallet: "0xEE4811b9462956C9C3535E79c08776D769CA9F3a", claimed: true, given: 1, received: 0 },
      ];
      return { q, matches: people.filter((p) => p.handle.includes(q)) };
    },
  ],
  [/^\/v1\/explain\/([^/?]+)/, (m) => ({ name: decodeURIComponent(m[1]), says: "alice is a person's name here.", kind: "person" })],
  [
    /^\/v1\/name\/([^/]+)\/([^/?]+)/,
    (m) => ({
      domain: m[1],
      handle: m[2],
      // `lapsed` is how a page is tested against a name whose record ran out: held once, live no
      // longer, which is the one state a reference cannot be written against.
      taken: true,
      live: m[2] !== "lapsed",
      wallet: "0xEE4811b9462956C9C3535E79c08776D769CA9F3a",
    }),
  ],
  [
    /^\/v1\/profile\/([^/?]+)/,
    (m) => {
      const handle = decodeURIComponent(m[1]);
      return {
        handle,
        names: [{ instance: "ketsuban", name: `${handle}.${ROOT}`, verification: verification(`${handle}.${ROOT}`) }],
        vouches: vouches(handle).vouches,
        standing: { claimed: true, given: 1, received: 1 },
        warning: verification("x").warning,
      };
    },
  ],
];

/** What this mock answers for one path, or undefined when it answers nothing. */
export function answer(url) {
  const hit = routes.find(([re]) => re.test(url));
  return hit ? hit[1](url.match(hit[0]), url) : undefined;
}

// Imported by a test that checks these fixtures still parse; only listens when run as a program.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createServer((req, res) => {
    const url = req.url ?? "/";
    const body = answer(url);
    res.writeHead(body ? 200 : 404, {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
    });
    res.end(JSON.stringify(body ?? { error: "not found" }));
  }).listen(PORT, "127.0.0.1", () => console.log(`mock api on :${PORT}`));
}
