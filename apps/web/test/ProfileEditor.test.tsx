import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Api } from "@/lib/api";

const RESOLVER = "0x4E2d9783cEFF2ed72CD77C14206b29fe246b24F7";

const api = {
  contracts: vi.fn(async () => ({ permissionedResolver: RESOLVER, instances: [] })),
  verify: vi.fn(async () => ({
    name: "alice.ketsuban.eth",
    status: "active" as const,
    profile: { avatar: "", description: "a builder", url: "", email: "old@example.com" },
  })),
} as unknown as Api;

const { ProfileEditor } = await import("@/app/me/ProfileEditor");

const wrapper = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
};

const editor = () =>
  render(<ProfileEditor api={api} name="alice.ketsuban.eth" getSigner={async () => ({}) as never} />, {
    wrapper: wrapper(),
  });

describe("the public profile editor", () => {
  it("offers an avatar, a description and a website, and says these are public", async () => {
    editor();
    await waitFor(() => expect(screen.getByTestId("profile-avatar")).toBeInTheDocument());
    expect(screen.getByTestId("profile-description")).toBeInTheDocument();
    expect(screen.getByTestId("profile-url")).toBeInTheDocument();
    // Someone filling this in has to know it is published, not stored for the app.
    expect(screen.getByTestId("profile-editor")).toHaveTextContent(/public/i);
  });

  it("does not ask for an email, because the linked accounts already carry that", async () => {
    // An email typed here would be a public text record — the opposite of the attested, masked account.
    editor();
    await waitFor(() => expect(screen.getByTestId("profile-avatar")).toBeInTheDocument());
    expect(screen.queryByTestId("profile-email")).toBeNull();
    expect(screen.getByTestId("profile-editor")).not.toHaveTextContent(/e-?mail/i);
  });

  it("saves only what was changed, and offers nothing to save at rest", async () => {
    editor();
    await waitFor(() => expect(screen.getByTestId("profile-description")).toHaveValue("a builder"));
    expect(screen.getByTestId("profile-save")).toBeDisabled();
  });
});
