import { describe, expect, it } from "vitest";

/**
 * Does a deployed site still say what it is for?
 *
 * The schema check next door asks whether the attester answers what this app parses. This asks the
 * question after that: whether the pages built from those answers actually carry what a reader came
 * for. A deploy can be green in every other sense and still serve a page whose content quietly
 * vanished — a read that started failing, a fixture that drifted, a component that stopped rendering.
 *
 * Outside the test run, like everything in this directory: it needs a reachable deployment.
 *
 *   pnpm --filter @ketsuban/web check:live
 *   CHECK_WEB=http://127.0.0.1:3000 pnpm --filter @ketsuban/web check:live
 */
const WEB = (process.env.CHECK_WEB ?? "https://ketsuban.peeramid.xyz").replace(/\/$/, "");
const SUBJECT = process.env.CHECK_SUBJECT ?? "kju-is";
const ROOT = process.env.CHECK_ROOT ?? "ketsuban.eth";

const get = async (path: string) => {
  const res = await fetch(`${WEB}${path}`);
  expect(res.ok, `${path} answered ${res.status}`).toBe(true);
  return res.text();
};

describe(`what ${WEB} serves`, () => {
  it("offers the question anyone can answer, from the subject's own records", async () => {
    const html = await get("/");
    expect(html).toContain("open-questions");
    // Read off the chain rather than written in the page, so its absence means a read stopped working.
    expect(html).toContain("Kim Jong Un");
  });

  it("renders the subject page, with a way in to answer it", async () => {
    const html = await get(`/v/${SUBJECT}.${ROOT}`);
    expect(html).toContain("instance-answers");
    expect(html).toContain("profile-head");
    expect(html).toContain("answer-cta");
  });

  it("says what every name here means", async () => {
    const html = await get("/names");
    expect(html).toContain("name-kinds");
  });

  it("knows which commit it is", async () => {
    // Without this a deploy cannot be told from the one before it, which is when somebody most wants
    // to know: the page looks wrong and nobody can say what is running.
    const health = (await (await fetch(`${WEB}/api/health`)).json()) as { sha?: string };
    expect(health.sha, "no commit reported").toBeTruthy();
  });
});
