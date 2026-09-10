import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Api } from "@/lib/api";

const BOB = "0xd70B5E8A232Bf67F64658cbDDebe32e1443894a0";
const state = { name: null as string | null };
const api = {
  reverse: vi.fn(async (address: string) => ({ address, name: state.name, names: [], primary: null })),
} as unknown as Api;

const { ReaderName } = await import("@/app/me/ReaderName");

const wrapper = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
};

describe("naming the person a permission was given to", () => {
  it("says who they are, not what their wallet is", async () => {
    // An address tells the holder nothing about who they shared with; the name is the whole point of
    // having names.
    state.name = "alice.ketsuban.eth";
    render(<ReaderName api={api} address={BOB} />, { wrapper: wrapper() });
    await waitFor(() => expect(screen.getByTestId("reader-name")).toHaveTextContent("alice.ketsuban.eth"));
    expect(screen.getByRole("link")).toHaveAttribute("href", "/v/alice.ketsuban.eth");
  });

  it("falls back to the address when the wallet answers to no name", async () => {
    state.name = null;
    render(<ReaderName api={api} address={BOB} />, { wrapper: wrapper() });
    await waitFor(() => expect(screen.getByTestId("reader-name")).toHaveTextContent("0xd70B…94a0"));
    // Nothing to link to: a name that does not exist is not a page.
    expect(screen.queryByRole("link")).toBeNull();
  });
});
