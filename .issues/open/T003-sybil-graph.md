# Sybil signal: Selfie Check score, and the reference graph

Asked 2026-09-12. World's hackathon presentation described Selfie Check returning a "Sybil score" — a
similarity signal flagging whether the user has created an abnormal number of accounts on the
platform. The ask is to show that on a profile, and to go further: build the social graph from
references, detect sybil clusters in it, and show a verifier not only how many references somebody
holds but how deep the graph behind them goes (do their referrers refer each other?).

## What World actually gives us

Checked 2026-09-12 against `docs.world.org`: the verify endpoint's documented response carries no
score, and the Selfie Check credential page says outright that it *"returns a proof of the completed
check, not a numeric Sybil or uniqueness score."* The sandbox page says nothing either. So the score is
not something the API hands this deployment today. Recorded in `docs/selfie-check-feedback.md`.

Consequence: the sybil signal we can actually ship is the one we compute ourselves, from the
reference graph on chain, seeded by who has proved humanity. If World later exposes a score, item 1
is where it plugs in.

## Sub-issues, smallest first

1. [ ] **A place for World's score, when there is one.** Parse any `sybil`/`similarity` field out of
       the verify answer if present (the type already tolerates unknown fields), keep it beside the
       humanity record, and show it on the profile as "World: N accounts look like this one" when set.
       Nothing shown when absent — never a made-up zero.
2. [ ] **The reference graph, read from chain.** `GET /v1/graph` (and `/v1/graph/:handle` for one
       neighbourhood): nodes are people, an edge is a live reference voucher → candidate. Built from
       every `~<candidate>` instance the deployment holds. Answers with nodes, edges, and per-node
       facts a verifier can read: in-degree, out-degree, whether the person proved humanity.
3. [ ] **Depth and reciprocity, per person.** For a handle: how many of their referrers refer each
       other (clustering), the share of references that are mutual (A refers B, B refers A), and the
       size of the connected cluster they sit in. These are the numbers "reference graph depth" means.
4. [ ] **A sybil rank.** SybilRank-style trust propagation: seeds are wallets with a live humanity
       proof, trust flows along reference edges with early termination; a low rank in a dense
       mutual cluster is the sybil-ring signature. Exposed per node in the graph read and as one
       number on the profile, with the caveat carried like every other claim here.
5. [ ] **Show it.** On `/p/<handle>`: the numbers from 3 and 4 beside the score ring, and a small
       neighbourhood picture (the person, their referrers, who among those refer each other).
6. [ ] **A namespace worth looking at.** A script that populates a local or Sepolia deployment with a
       few dozen names and references shaped like the real thing — one honest cluster, one
       ring of accounts that only refer each other — so the demo has a graph to show in four minutes.

Order: 2 → 3 → 4 → 5 → 6, with 1 whenever World's field turns up.
