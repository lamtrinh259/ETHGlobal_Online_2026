import { describe, expect, it, vi } from "vitest";
import { seedOnBoot, type Plan } from "../../src/seed.js";

/**
 * A deployment that asks for the demo namespace gets it once it is listening; one that does not asks
 * for nothing; one that asks without a registrar key is told why nothing happened. A seeding that
 * fails is logged, never a crash: the service is up whether or not the namespace is.
 */
const base = {
  SEED_GRAPH: true,
  SEED_SALT: "demo",
  REGISTRAR_KEY: "0x00000000000000000000000000000000000000000000000000000000000000b0" as const,
  MULTIPASS_EIP712_NAME: "MultipassDNS",
  MULTIPASS_EIP712_VERSION: "1.0.0",
};

describe("seeding at boot", () => {
  it("does nothing unless asked", async () => {
    const run = vi.fn();
    const log = vi.fn();
    expect(await seedOnBoot({ config: { ...base, SEED_GRAPH: false }, apiUrl: "http://x", log, run })).toBe(
      "skipped"
    );
    expect(run).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it("says why it wrote nothing when asked without a registrar key", async () => {
    const run = vi.fn();
    const log = vi.fn();
    const r = await seedOnBoot({
      config: { ...base, REGISTRAR_KEY: undefined },
      apiUrl: "http://x",
      log,
      run,
    });
    expect(r).toBe("skipped");
    expect(run).not.toHaveBeenCalled();
    expect(log.mock.calls[0][0]).toMatch(/REGISTRAR_KEY is not/);
  });

  it("writes the plan through the service's own relay with its own key, salt and EIP-712 domain", async () => {
    const run = vi.fn(async (_p: Plan, o: { log?: (s: string) => void }) => {
      o.log?.("name  mira ← 0xabc");
      return { names: 11, humans: 3, references: 32 };
    });
    const log = vi.fn();
    const r = await seedOnBoot({ config: base, apiUrl: "http://127.0.0.1:8787", log, run });
    expect(r).toBe("seeded");
    const [plan, opts] = run.mock.calls[0];
    expect(plan.people.map((p) => p.handle)).toContain("mira");
    expect(opts).toMatchObject({
      api: "http://127.0.0.1:8787",
      registrarKey: base.REGISTRAR_KEY,
      salt: "demo",
      eip712: { name: "MultipassDNS", version: "1.0.0" },
    });
    expect(log).toHaveBeenCalledWith("seed · name  mira ← 0xabc");
    expect(log).toHaveBeenLastCalledWith("seed · done: 11 names, 3 proofs, 32 references written");
  });

  it("logs a failure rather than taking the service down with it", async () => {
    const run = vi.fn(async () => {
      throw new Error("relayer has no funds");
    });
    const log = vi.fn();
    expect(await seedOnBoot({ config: base, apiUrl: "http://x", log, run })).toBe("failed");
    expect(log).toHaveBeenLastCalledWith("seed · failed: relayer has no funds");
  });
});
