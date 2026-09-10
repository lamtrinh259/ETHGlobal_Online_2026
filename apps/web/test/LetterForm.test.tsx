import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Api } from "@/lib/api";

const RESOLVER = "0x4E2d9783cEFF2ed72CD77C14206b29fe246b24F7";
const written: { letter?: string }[] = [];
const stored: string[] = [];

vi.mock("@/lib/hooks", async (orig) => ({
  ...(await orig<typeof import("@/lib/hooks")>()),
  useContracts: () => ({ data: { permissionedResolver: RESOLVER } }),
  useLetterWrite: () => ({
    mutate: (input: { letter: string }) => written.push(input),
    mutateAsync: async (input: { letter: string }) => {
      written.push(input);
      return "0xtx";
    },
    isPending: false,
    isSuccess: false,
    error: null,
    data: undefined,
  }),
}));

const api = {
  storeLetter: vi.fn(async (text: string) => {
    stored.push(text);
    return { hash: "a".repeat(64), ref: `sha256:${"a".repeat(64)}`, bytes: text.length };
  }),
} as unknown as Api;

const { LetterForm } = await import("@/app/vouch/[handle]/LetterForm");

const wrapper = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
};
const form = () =>
  render(
    <LetterForm
      api={api}
      candidate="alice"
      name="bob.alice.ketsuban.eth"
      getSigner={async () => ({}) as never}
    />,
    { wrapper: wrapper() }
  );

describe("the letter behind a reference", () => {
  beforeEach(() => {
    written.length = 0;
    stored.length = 0;
  });

  it("writes a short letter straight onto the record, where it is permanent", async () => {
    form();
    fireEvent.change(screen.getByLabelText("letter"), { target: { value: "Worked with Alice at Acme." } });
    fireEvent.click(screen.getByTestId("letter-save"));

    await waitFor(() => expect(written).toHaveLength(1));
    expect(written[0].letter).toBe("Worked with Alice at Acme.");
    // Nothing is kept off chain when it did not need to be.
    expect(stored).toHaveLength(0);
  });

  it("keeps a long letter by its hash, and writes the hash onto the record", async () => {
    // A text record costs gas by the byte, so a full reference cannot live on chain. The hash can,
    // and it is what lets a reader check the copy they were handed.
    const long = "Alice ran infrastructure at Acme for three years. ".repeat(30);
    form();
    fireEvent.change(screen.getByLabelText("letter"), { target: { value: long } });
    fireEvent.click(screen.getByTestId("letter-save"));

    // Trimmed, as it is written: what is hashed must be exactly what goes on the record.
    await waitFor(() => expect(stored).toEqual([long.trim()]));
    await waitFor(() => expect(written).toHaveLength(1));
    expect(written[0].letter).toBe(`sha256:${"a".repeat(64)}`);
  });

  it("says which of the two will happen before the wallet is asked", async () => {
    form();
    const box = screen.getByLabelText("letter");
    fireEvent.change(box, { target: { value: "short" } });
    expect(screen.getByTestId("letter-count")).toHaveTextContent(/on the record/i);

    fireEvent.change(box, { target: { value: "x".repeat(700) } });
    // The trade is worth stating: the hash is permanent, the text is only as durable as the service.
    expect(screen.getByTestId("letter-count")).toHaveTextContent(/hash/i);
  });
});
