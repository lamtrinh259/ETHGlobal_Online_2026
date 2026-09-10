import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Api } from "@/lib/api";

const RESOLVER = "0x4E2d9783cEFF2ed72CD77C14206b29fe246b24F7";

const uploaded: File[] = [];
const api = {
  uploadAvatar: vi.fn(async (file: File) => {
    uploaded.push(file);
    return { id: "abc.png", url: "https://api.test/v1/avatar/abc.png" };
  }),
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

  it("shows the profile as it stands, so the records are a profile and not three inputs", async () => {
    editor();
    await waitFor(() => expect(screen.getByTestId("profile-preview")).toHaveTextContent("a builder"));
    expect(screen.getByTestId("profile-preview")).toHaveTextContent("alice.ketsuban.eth");
  });

  it("names each key as one the resolver lets this wallet write", async () => {
    editor();
    await waitFor(() => expect(screen.getByTestId("profile-avatar")).toBeInTheDocument());
    // The role is per key and per name: worth showing on the field it governs, not only in prose.
    expect(screen.getByTestId("role-description")).toHaveTextContent("description");
  });

  it("saves only what was changed, and offers nothing to save at rest", async () => {
    editor();
    await waitFor(() => expect(screen.getByTestId("profile-description")).toHaveValue("a builder"));
    expect(screen.getByTestId("profile-save")).toBeDisabled();
  });
});

describe("the picture on a profile", () => {
  it("takes a file and puts the URL it was kept at into the record", async () => {
    editor();
    await waitFor(() => expect(screen.getByTestId("profile-avatar")).toBeInTheDocument());
    const file = new File([new Uint8Array([1, 2, 3])], "me.png", { type: "image/png" });
    fireEvent.change(screen.getByTestId("avatar-file"), { target: { files: [file] } });

    await waitFor(() => expect(uploaded).toHaveLength(1));
    // A text record holds a URL, so the picture is kept first and the record points at it.
    await waitFor(() =>
      expect(screen.getByTestId("profile-avatar")).toHaveValue("https://api.test/v1/avatar/abc.png")
    );
    // And the save button now has something to write.
    expect(screen.getByTestId("profile-save")).toBeEnabled();
  });

  it("says what went wrong instead of leaving a picture that never arrived", async () => {
    (api.uploadAvatar as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("that is not a picture this service can serve")
    );
    editor();
    await waitFor(() => expect(screen.getByTestId("profile-avatar")).toBeInTheDocument());
    fireEvent.change(screen.getByTestId("avatar-file"), {
      target: { files: [new File(["x"], "me.txt", { type: "text/plain" })] },
    });
    await waitFor(() => expect(screen.getByTestId("avatar-error")).toHaveTextContent(/not a picture/i));
  });
});
