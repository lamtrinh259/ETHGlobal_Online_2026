import { describe, expect, it } from "vitest";
import { answer } from "@/e2e/mock-api.mjs";
import {
  contractsSchema,
  ensSchema,
  explainSchema,
  findSchema,
  instanceReadSchema,
  nameStatusSchema,
  profileSchema,
  reverseSchema,
  verifySchema,
  vouchesSchema,
  walletSchema,
} from "@/lib/api";
import { routes } from "@/e2e/mock-api.mjs";

/**
 * The mock attester answers what the real one does.
 *
 * Every page is built to degrade: a read that fails is caught and a fallback rendered. So a fixture
 * that has drifted from the schema does not announce itself — it produces a page that looks like an
 * empty state and passes any assertion loose enough to accept one. That is how `gasTopup` with the
 * wrong field names rendered "this wallet holds no live name" and looked entirely reasonable.
 *
 * Parsing each fixture through the schema the client parses with turns that into a failure here, in
 * the fast suite, naming the field.
 */
const cases: [string, { parse: (v: unknown) => unknown }][] = [
  ["/v1/verify/alice.ketsuban.eth", verifySchema],
  ["/v1/vouches/alice", vouchesSchema],
  ["/v1/profile/alice", profileSchema],
  ["/v1/instance/kju-is", instanceReadSchema],
  ["/v1/wallet/0xEE4811b9462956C9C3535E79c08776D769CA9F3a", walletSchema],
  ["/v1/instances", contractsSchema],
  ["/v1/ens/alice.ketsuban.eth", ensSchema],
  ["/v1/reverse/0xEE4811b9462956C9C3535E79c08776D769CA9F3a", reverseSchema],
  ["/v1/explain/alice.ketsuban.eth", explainSchema],
  ["/v1/find?q=ali", findSchema],
  ["/v1/name/ketsuban/alice", nameStatusSchema],
];

describe("what the mock attester answers", () => {
  for (const [path, schema] of cases) {
    it(`${path} parses as the client would parse it`, () => {
      const body = answer(path);
      expect(body, `no route answered ${path}`).toBeDefined();
      expect(() => schema.parse(body)).not.toThrow();
    });
  }

  it("checks every route it serves, so a new fixture cannot arrive unparsed", () => {
    /*
     * Half of these were unchecked. A route the mock answers and nothing parses is the drift this file
     * exists to catch, arriving by the one door it was not watching.
     */
    expect(routes).toHaveLength(cases.length);
  });

  it("answers nothing for a path it does not serve, rather than something wrong", () => {
    expect(answer("/v1/nothing-here")).toBeUndefined();
  });

  it("refuses a name the tests use to exercise a refusal", () => {
    // `nobody.*` is how a page is tested against an attester that cannot answer.
    expect(answer("/v1/verify/nobody.ketsuban.eth")).toBeUndefined();
  });
});
