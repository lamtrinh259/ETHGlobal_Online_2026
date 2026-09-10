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

const routes = [
  [/^\/v1\/instances$/, () => ({ instances: [{ domain: "ketsuban", parentName: ROOT, parentLabel: "ketsuban" }], bridge: null, permissionedResolver: null, ethRegistry: null, registrar: false, paymentToken: null, humanity: true })],
  // `nobody.*` is the name the attester cannot answer for, so a page can be tested against a refusal
  // as well as against an answer.
  [/^\/v1\/verify\/(?!nobody)([^/?]+)/, (m) => verification(decodeURIComponent(m[1]))],
  [/^\/v1\/vouches\/([^/?]+)/, (m) => vouches(decodeURIComponent(m[1]))],
  [/^\/v1\/explain\/([^/?]+)/, (m) => ({ name: decodeURIComponent(m[1]), says: "alice is a person's name here.", kind: "person" })],
  [/^\/v1\/name\/([^/]+)\/([^/?]+)/, (m) => ({ domain: m[1], handle: m[2], taken: true, live: true, wallet: "0xEE4811b9462956C9C3535E79c08776D769CA9F3a" })],
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

createServer((req, res) => {
  const url = req.url ?? "/";
  const hit = routes.find(([re]) => re.test(url));
  const body = hit ? hit[1](url.match(hit[0])) : { error: "not found" };
  res.writeHead(hit ? 200 : 404, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
  });
  res.end(JSON.stringify(body));
}).listen(PORT, "127.0.0.1", () => console.log(`mock api on :${PORT}`));
