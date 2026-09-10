import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VerifyCard } from "@/app/VerifyCard";
import type { Verification } from "@/lib/api";

const base: Verification = {
  name: "alice.ketsuban.eth",
  instance: { domain: "ketsuban", parentName: "ketsuban.eth" },
  status: "active",
  wallet: "0xEE4811b9462956C9C3535E79c08776D769CA9F3a",
  answer: "terrible dictator",
  expiresAt: "2026-10-08T09:14:22.000Z",
  humanity: { level: "medium", until: null },
  links: [
    { domain: "x", optedIn: true, commitment: "0x01", disclosed: { handle: "alice", platformId: "42" } },
    { domain: "telegram", optedIn: true, commitment: "0x02" },
    { domain: "github", optedIn: false },
  ],
  references: [],
  evidence: ["wallet_binding", "humanity_attestation", "x_account_control"],
  decision: "additional_context_available",
  warning: "This is not identity verification.",
};

describe("VerifyCard", () => {
  it("says what a private-branch name claims, which is less than it appears to", () => {
    render(
      <VerifyCard
        v={{
          ...base,
          name: "alice.com.discord.private-www.ketsuban.eth",
          instance: { domain: "discord.com", parentName: "com.discord.private-www.ketsuban.eth" },
          branch: "private",
        }}
      />
    );
    expect(screen.getByTestId("private-branch")).toHaveTextContent("holds an account there and nothing else");
    expect(screen.getByTestId("private-branch")).toHaveTextContent("behind a view code");
  });

  it("says nothing of the sort for a name in the open", () => {
    render(<VerifyCard v={{ ...base, branch: "open" }} />);
    expect(screen.queryByTestId("private-branch")).toBeNull();
  });

  it("shows the name each account answers at, so a verifier can read it back themselves", () => {
    render(
      <VerifyCard
        v={{
          ...base,
          links: [
            { domain: "x.com", optedIn: false, ensName: "alice_x.com.x.www.ketsuban.eth" },
            {
              domain: "google.com",
              optedIn: true,
              commitment: "0x02",
              ensName: "alice.com.google.private-www.ketsuban.eth",
            },
          ],
        }}
      />
    );
    const links = screen.getByTestId("links");
    expect(links).toHaveTextContent("alice_x.com.x.www.ketsuban.eth");
    // Even the private one has a name: it says the person is there, not which account.
    expect(links).toHaveTextContent("alice.com.google.private-www.ketsuban.eth");
    expect(links).toHaveTextContent("masked");
  });

  it("renders an active record with disclosed, masked and public links, and the warning", () => {
    render(<VerifyCard v={base} />);
    expect(screen.getByRole("heading", { name: "alice.ketsuban.eth" })).toBeInTheDocument();
    expect(screen.getByTestId("status")).toHaveTextContent("active");
    expect(screen.getByTestId("humanity")).toHaveTextContent("medium");
    const links = screen.getByTestId("links").querySelectorAll("li");
    expect(links[0]).toHaveTextContent("@alice");
    expect(links[0]).toHaveTextContent("id 42");
    expect(links[1]).toHaveTextContent("masked");
    expect(links[2]).toHaveTextContent("verified");
    expect(screen.getByRole("note")).toHaveTextContent(base.warning);
    // Said, rather than named after the field that carries it.
    expect(screen.getByTestId("evidence")).toHaveTextContent("wallet binding");
    expect(screen.getByTestId("evidence")).toHaveTextContent("proof of humanity");
    expect(screen.getByTestId("evidence")).toHaveTextContent("x account");
  });

  it("renders an inactive record without details but still with the warning", () => {
    render(
      <VerifyCard
        v={{ ...base, status: "inactive", wallet: null, answer: null, links: [], humanity: null }}
      />
    );
    expect(screen.getByTestId("status")).toHaveTextContent("no record");
    expect(screen.queryByTestId("links")).toBeNull();
    expect(screen.getByRole("note")).toHaveTextContent(base.warning);
  });
});

describe("a person's page reads as a profile", () => {
  it("leads with the picture and the profile records, not with a table of fields", () => {
    // The page opened on `wallet / answer / expires` — true, and not what a reader came for.
    const v = {
      ...base,
      profile: {
        avatar: "https://i.example/p.png",
        description: "infra lead",
        url: "https://p.example",
        email: null,
      },
    };
    render(<VerifyCard v={v} />);
    expect(screen.getByTestId("head-avatar")).toHaveAttribute("src", "https://i.example/p.png");
    expect(screen.getByTestId("profile-head")).toHaveTextContent("infra lead");
    // The verification itself is still there, below the identity.
    expect(screen.getByTestId("status")).toHaveTextContent("active");
    expect(screen.getByTestId("evidence")).toBeInTheDocument();
  });

  it("keeps its shape for a name with no profile at all", () => {
    render(<VerifyCard v={base} />);
    expect(screen.getByTestId("head-avatar")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(base.name);
  });
});

/**
 * A page that shows only what others said about a person reads as a dossier. What they said about
 * anybody else is the half they wrote themselves, and it replaced a bare `answer` field that stopped
 * meaning anything once one person could answer about more than one subject.
 */
describe("references given", () => {
  const gave = (...refs: Verification["references"]) => ({ ...base, references: refs });

  it("names the subject by its question, not by the domain that holds it", () => {
    render(
      <VerifyCard
        v={gave({
          kind: "answer",
          subject: "kju-is",
          subjectName: "kju-is.ketsuban.eth",
          statement: "a terrible dictator",
          ensName: "alice.kju-is.ketsuban.eth",
          validUntil: "2026-10-08T09:14:22.000Z",
        })}
      />
    );
    const refs = screen.getByTestId("references");
    expect(refs).toHaveTextContent("What do you think of Kim Jong Un?");
    expect(refs).toHaveTextContent("a terrible dictator");
    // The receipt: it resolves for anyone, and this page is not the source.
    expect(refs).toHaveTextContent("alice.kju-is.ketsuban.eth");
  });

  it("shows a reference about a person under that person's own handle", () => {
    render(
      <VerifyCard
        v={gave({
          kind: "reference",
          subject: "bob",
          subjectName: "bob.ketsuban.eth",
          statement: "worked with them for years",
          ensName: "alice.bob.ketsuban.eth",
          validUntil: "2026-10-08T09:14:22.000Z",
        })}
      />
    );
    expect(screen.getByTestId("references")).toHaveTextContent("bob");
    expect(screen.getByTestId("references")).toHaveTextContent("worked with them for years");
  });

  it("keeps the order it was given, so the subject everyone answers stays on top", () => {
    const at = "2026-10-08T09:14:22.000Z";
    render(
      <VerifyCard
        v={gave(
          {
            kind: "answer",
            subject: "kju-is",
            subjectName: null,
            statement: "a terrible dictator",
            ensName: null,
            validUntil: at,
          },
          {
            kind: "reference",
            subject: "bob",
            subjectName: null,
            statement: "solid",
            ensName: null,
            validUntil: at,
          }
        )}
      />
    );
    const rows = screen.getByTestId("references").querySelectorAll("li");
    expect(rows[0]).toHaveTextContent("Kim Jong Un");
    expect(rows[1]).toHaveTextContent("bob");
  });

  it("says nothing at all when this person has referred nobody", () => {
    render(<VerifyCard v={base} />);
    expect(screen.queryByTestId("references")).toBeNull();
  });
});
