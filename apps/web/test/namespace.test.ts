import { describe, expect, it } from "vitest";
import { nameKinds } from "@/lib/namespace";
import type { Contracts } from "@/lib/api";

const mount = (domain: string, parentName: string, maskedParentName?: string) => ({
  domain,
  parentName,
  parentLabel: domain.split(".").pop() as string,
  registry: "0x0000000000000000000000000000000000000001" as const,
  resolver: "0x0000000000000000000000000000000000000002" as const,
  ...(maskedParentName ? { maskedParentName } : {}),
});

const contracts = {
  instances: [
    mount("ketsuban", "ketsuban.eth"),
    mount("x.com", "com.x.www.ketsuban.eth", "com.x.private-www.ketsuban.eth"),
    mount("peeramid.xyz", "xyz.peeramid.@.ketsuban.eth", "xyz.peeramid.private@.ketsuban.eth"),
  ],
  bridge: "0x0000000000000000000000000000000000000003" as const,
  permissionedResolver: null,
} as Contracts;

describe("what every name means", () => {
  it("is read back from the mounts, never from a list this page keeps", () => {
    const kinds = nameKinds(contracts, ["ketsuban"]);
    const shapes = kinds.map((k) => k.pattern);
    expect(shapes).toContain("<name>.ketsuban.eth");
    expect(shapes).toContain("<handle>.com.x.www.ketsuban.eth");
    expect(shapes).toContain("<local part>.xyz.peeramid.@.ketsuban.eth");
    expect(shapes).toContain("<voucher>.<name>.ketsuban.eth");
    // A private account is named after the person: the account's own name is a one-time pad.
    expect(shapes).toContain("<name>.com.x.private-www.ketsuban.eth");
    expect(kinds.find((k) => k.pattern.includes("private-www"))?.detail).toContain("one-time pad");
  });

  it("describes only what a deployment actually holds", () => {
    const flat = { ...contracts, instances: [mount("ketsuban", "ketsuban.eth")] } as Contracts;
    expect(nameKinds(flat, ["ketsuban"]).map((k) => k.what)).toEqual(["A person", "A reference"]);
    // No root instance, nothing to say.
    expect(nameKinds(contracts, ["other"])).toEqual([]);
    expect(nameKinds(undefined, ["ketsuban"])).toEqual([]);
  });
});
