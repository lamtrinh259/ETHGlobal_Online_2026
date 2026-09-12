/**
 * Where a reader checks a claim for themselves: the block explorer and the ENS app for the chain this
 * deployment is on. A chain nobody hosts an explorer for (a local anvil) gets no link rather than a
 * broken one.
 */
const EXPLORERS: Record<number, { explorer: string; ens: string; name: string }> = {
  1: { explorer: "https://etherscan.io", ens: "https://app.ens.domains", name: "Ethereum" },
  11155111: {
    explorer: "https://sepolia.etherscan.io",
    ens: "https://sepolia.app.ens.domains",
    name: "Sepolia",
  },
};

export function chainName(chainId: number): string {
  return EXPLORERS[chainId]?.name ?? `chain ${chainId}`;
}

export function explorerAddress(chainId: number, address: string): string | undefined {
  const e = EXPLORERS[chainId];
  return e ? `${e.explorer}/address/${address}` : undefined;
}

export function explorerTx(chainId: number, hash: string): string | undefined {
  const e = EXPLORERS[chainId];
  return e ? `${e.explorer}/tx/${hash}` : undefined;
}

export function ensAppName(chainId: number, name: string): string | undefined {
  const e = EXPLORERS[chainId];
  return e ? `${e.ens}/${name}` : undefined;
}
