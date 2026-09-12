import { describe, expect, it } from "vitest";
import { chainName, ensAppName, explorerAddress, explorerTx } from "@/lib/explorer";

/** A link a reader can follow to check a claim, on the chains that have somewhere to follow it to. */
describe("where to check a claim", () => {
  it("points at Sepolia's explorer and ENS app for the test deployment", () => {
    expect(explorerAddress(11155111, "0xabc")).toBe("https://sepolia.etherscan.io/address/0xabc");
    expect(explorerTx(11155111, "0xdef")).toBe("https://sepolia.etherscan.io/tx/0xdef");
    expect(ensAppName(11155111, "ketsuban.eth")).toBe("https://sepolia.app.ens.domains/ketsuban.eth");
    expect(chainName(11155111)).toBe("Sepolia");
  });

  it("offers no link at all for a chain nobody hosts an explorer for", () => {
    expect(explorerAddress(31337, "0xabc")).toBeUndefined();
    expect(ensAppName(31337, "ketsuban.eth")).toBeUndefined();
    expect(chainName(31337)).toBe("chain 31337");
  });
});
