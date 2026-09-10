/**
 * A stand-in for World's Developer Portal, for the docker e2e stack.
 *
 * It is deliberately not a proof verifier: no zero-knowledge circuit runs here, and none could
 * usefully run against proofs nobody generated. What it does check is the half of the exchange that
 * belongs to this codebase — that the API posts to `/api/v4/verify/<the configured rp_id>`, and that
 * it forwards the proof verbatim as the integration guide requires. Everything the API decides for
 * itself (the action, the signal binding, the nullifier it stores) is checked against a real chain by
 * the test, not here.
 *
 * The identity it answers with comes from the request, so a test can send the same person twice.
 */
import { createHash } from "node:crypto";
import { createServer } from "node:http";

const RP_ID = process.env.WORLD_RP_ID ?? "rp_e2e";
const PORT = Number(process.env.PORT ?? 8080);

/** Whatever the caller says this person is, as a 256-bit nullifier. */
const nullifierFor = (identity) => `0x${createHash("sha256").update(String(identity)).digest("hex")}`;

const server = createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const answer = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method !== "POST" || req.url !== `/api/v4/verify/${RP_ID}`) {
      return answer(404, { success: false, code: "not_found", detail: `no route for ${req.method} ${req.url}` });
    }
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return answer(400, { success: false, code: "invalid_json" });
    }
    // Injected refusal, so a test can exercise the path where World rejects a proof this app
    // considered well formed.
    if (body.e2e_reject) {
      return answer(200, { success: false, code: "invalid_proof", detail: String(body.e2e_reject) });
    }
    const nullifier = nullifierFor(body.e2e_identity ?? "anonymous");
    answer(200, {
      success: true,
      action: body.action,
      nullifier,
      results: [{ identifier: body.e2e_level ?? "orb", success: true, nullifier }],
    });
  });
});

server.listen(PORT, "0.0.0.0", () => console.log(`world stub on :${PORT} for ${RP_ID}`));
