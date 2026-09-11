import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProfileCard } from "@/app/ProfileCard";
import type { Profile } from "@/lib/profile";

const profile: Profile = {
  handle: "alice",
  identity: undefined,
  wallet: "0xEE4811b9462956C9C3535E79c08776D769CA9F3a",
  answers: [
    {
      domain: "kju-is",
      name: "alice.kju-is.ketsuban.eth",
      answer: "terrible dictator",
      status: "active",
      expiresAt: "2026-10-08T09:14:22.000Z",
    },
  ],
  links: [
    { domain: "x", optedIn: true, commitment: "0x01" },
    { domain: "x.com", optedIn: false, ensName: "alice_x.com.x.www.ketsuban.eth" },
    { domain: "discord.com", optedIn: true, ensName: "alice.com.discord.private-www.ketsuban.eth" },
  ],
  humanity: null,
  vouches: [
    {
      voucher: "bob",
      voucherName: "bob.ketsuban.eth",
      ensName: "bob.alice.ketsuban.eth",
      wallet: "0x1",
      statement: "worked together 2019-22",
      validUntil: "2027-01-01T00:00:00.000Z",
      nonce: "1",
      live: true,
      solicited: true,
      invite: null,
      standing: { claimed: true, given: 4, received: 2 },
      letter: "Bob ran the platform team at Acme while Alice led infra.",
    },
    {
      voucher: "carol",
      voucherName: null,
      wallet: "0x2",
      statement: "old",
      validUntil: "2025-01-01T00:00:00.000Z",
      nonce: "1",
      live: false,
      solicited: true,
      invite: null,
    },
  ],
  checks: [
    { id: "identity", label: "Claimed name", ok: true, detail: "alice.ketsuban.eth → 0xEE48" },
    { id: "answer:kju-is", label: "Answered kju-is", ok: false, detail: "no live answer" },
  ],
  complete: false,
  warning: "This is not identity verification.",
};

describe("ProfileCard", () => {
  it("shows the name each account answers at, public or private", () => {
    render(<ProfileCard p={profile} rootParent="ketsuban.eth" />);
    const links = screen.getByTestId("links");
    // The account in the open, and the private one named after the person: both checkable elsewhere.
    expect(links).toHaveTextContent("alice_x.com.x.www.ketsuban.eth");
    expect(links).toHaveTextContent("alice.com.discord.private-www.ketsuban.eth");
    expect(links).toHaveTextContent("verified, masked");
  });

  it("shows each reference as the name it is, linked to its own page", () => {
    render(<ProfileCard p={profile} rootParent="ketsuban.eth" />);
    const vouches = screen.getByTestId("vouches");
    // A reference is a name in the candidate's namespace, readable without this page.
    expect(vouches).toHaveTextContent("bob.alice.ketsuban.eth");
    expect(screen.getByRole("link", { name: "bob.alice.ketsuban.eth" })).toHaveAttribute(
      "href",
      "/v/bob.alice.ketsuban.eth"
    );
  });

  it("says a long letter is checkable against the hash the record names", () => {
    const vouches = [
      { ...profile.vouches[0], voucher: "bob", letter: "the full letter", letterHash: "ab".repeat(32) },
    ];
    render(<ProfileCard p={{ ...profile, vouches }} rootParent="ketsuban.eth" />);
    expect(screen.getByTestId("vouch-bob")).toHaveTextContent("the full letter");
    // The hash is the reason to believe the text: it is on chain, the text is not.
    expect(screen.getByTestId("letter-hash-bob")).toHaveTextContent(/ab/);
  });

  it("says a letter is missing rather than pretending the reference has none", () => {
    // The hash is permanent; the text is only as durable as whoever kept it. Silence here would read
    // as "no letter written", which is a different claim entirely.
    const vouches = [{ ...profile.vouches[0], voucher: "bob", letter: null, letterHash: "cd".repeat(32) }];
    render(<ProfileCard p={{ ...profile, vouches }} rootParent="ketsuban.eth" />);
    expect(screen.getByTestId("vouch-bob")).toHaveTextContent(/letter.*not|cannot be shown|missing/i);
  });

  it("marks a reference nobody asked for, without hiding it", () => {
    // Anyone may refer anyone, so a reader needs to know which references the subject asked for. It is
    // a note on the reference, not a reason to leave it out.
    const vouches = [
      { ...profile.vouches[0], voucher: "bob", solicited: true },
      { ...profile.vouches[0], voucher: "mallory", solicited: false },
    ];
    render(<ProfileCard p={{ ...profile, vouches }} rootParent="ketsuban.eth" />);
    expect(screen.getByTestId("vouch-mallory")).toHaveTextContent(/unsolicited/i);
    expect(screen.getByTestId("vouch-bob")).not.toHaveTextContent(/unsolicited/i);
  });

  it("says what each answer answers, not the domain it happens to live in", () => {
    // A verifier reading "kju-is" learns nothing: an answer without its question cannot be judged.
    render(<ProfileCard p={profile} rootParent="ketsuban.eth" />);
    const answers = screen.getByTestId("answers");
    expect(answers).toHaveTextContent("What do you think of Kim Jong Un?");
    // The name it lives at stays readable — that is what makes the answer checkable without this page.
    expect(answers).toHaveTextContent("alice.kju-is.ketsuban.eth");
  });

  it("renders checks with marks, answers and masked links", () => {
    render(
      <ProfileCard
        p={{
          ...profile,
          identity: {
            profile: {
              avatar: "https://img.example/a.png",
              description: "prof of maths",
              url: "https://alice.example",
              email: null,
            },
            // Always present on a parsed verification, and the page reads it: a fixture cast past the
            // type is the one place it can be missing.
            references: [],
          } as never,
        }}
        rootParent="ketsuban.eth"
      />
    );
    // The same head every page about someone uses, rather than a rendering of its own.
    expect(screen.getByTestId("profile-head")).toHaveTextContent("prof of maths");
    expect(screen.getByRole("link", { name: "https://alice.example" })).toHaveAttribute(
      "href",
      "https://alice.example"
    );
    expect(screen.getByRole("heading", { name: "alice.ketsuban.eth" })).toBeInTheDocument();
    expect(screen.getByTestId("completeness")).toHaveTextContent("incomplete");
    const items = screen.getByTestId("checks").querySelectorAll("li");
    expect(items[0]).toHaveClass("ok");
    expect(items[0]).toHaveTextContent("Claimed name");
    expect(items[1]).toHaveClass("no");
    expect(items[1]).toHaveTextContent("no live answer");
    expect(screen.getByTestId("answers")).toHaveTextContent("terrible dictator");
    expect(screen.getByTestId("answers")).toHaveTextContent("2026-10-08 09:14Z");
    expect(screen.getByTestId("links")).toHaveTextContent("masked");
    expect(screen.getByTestId("humanity")).toHaveTextContent("not attested");
    const vouches = screen.getByTestId("vouches").querySelectorAll("li");
    expect(vouches).toHaveLength(2);
    expect(vouches[0]).toHaveClass("live");
    expect(vouches[0]).toHaveTextContent("bob.ketsuban.eth");
    expect(vouches[0]).toHaveTextContent("worked together 2019-22");
    expect(vouches[0].querySelector("[data-testid=standing]")).toHaveTextContent("gave 4 · received 2");
    expect(vouches[0].querySelector("[data-testid=vouch-letter]")).toHaveTextContent(
      "Bob ran the platform team at Acme while Alice led infra."
    );
    expect(vouches[1].querySelector("[data-testid=vouch-letter]")).toBeNull();
    expect(vouches[1].querySelector("[data-testid=standing]")).toBeNull();
    expect(vouches[1]).toHaveClass("expired");
    expect(vouches[1]).toHaveTextContent("carol");
  });

  it("shows the policy line, the disclosure badge and links vouchers to their own page", () => {
    render(
      <ProfileCard
        p={{
          ...profile,
          links: [{ domain: "x", optedIn: true, disclosed: { handle: "alice_x", platformId: "1" } }],
        }}
        rootParent="ketsuban.eth"
        policy={{ requiredAnswers: ["kju-is"], minLinks: 1, requireHumanity: true, minVouches: 2 }}
      />
    );
    expect(screen.getByTestId("policy-line")).toHaveTextContent(
      "Policy: answers for What do you think of Kim Jong Un? · ≥1 linked account · ≥2 live references · humanity attested"
    );
    expect(screen.getByTestId("links")).toHaveTextContent("@alice_x");
    expect(screen.getByTestId("disclosed")).toHaveTextContent("disclosed to you by the candidate");
    const voucherLink = screen.getByTestId("vouches").querySelector("a");
    expect(voucherLink).toHaveAttribute("href", "/p/bob");
  });

  it("reads a withdrawn statement as withdrawn, not as a quote", () => {
    render(
      <ProfileCard
        p={{ ...profile, vouches: [{ ...profile.vouches[0], statement: "withdrawn" }] }}
        rootParent="ketsuban.eth"
      />
    );
    expect(screen.getByTestId("withdrawn")).toHaveTextContent("withdrawn by the voucher");
    expect(screen.getByTestId("vouches")).not.toHaveTextContent("“withdrawn”");
  });

  it("tells an unclaimed handle that letters are already waiting for it", () => {
    render(<ProfileCard p={{ ...profile, identity: undefined, wallet: null }} rootParent="ketsuban.eth" />);
    const waiting = screen.getByTestId("waiting");
    expect(waiting).toHaveTextContent("1 reference is already written for it");
    expect(waiting.querySelector("a")).toHaveAttribute("href", "/me");

    // Nothing to claim, nothing to say: with no live reference there is no banner.
    const { container } = render(
      <ProfileCard
        p={{ ...profile, identity: undefined, wallet: null, vouches: [profile.vouches[1]] }}
        rootParent="ketsuban.eth"
      />
    );
    expect(container.querySelector("[data-testid=waiting]")).toBeNull();
  });

  it("puts the one number beside the verdict it explains", () => {
    // The badge said "incomplete" at the top and the score that says how incomplete sat under the
    // answers and the accounts, half a page down.
    const { container } = render(<ProfileCard p={profile} rootParent="ketsuban.eth" />);
    const order = [...container.querySelectorAll("[data-testid=checks], [data-testid=score], h3")];
    const at = (t: string) => order.findIndex((el) => el.getAttribute("data-testid") === t);
    expect(at("score")).toBeGreaterThan(at("checks"));
    expect(at("score")).toBeLessThan(order.findIndex((el) => el.textContent === "Answers"));
  });

  it("does not grade a name nobody has ever held or written about", () => {
    /*
     * A column of crosses and 0/100 is a verdict, and there is nothing here to pass judgement on:
     * somebody typed a name nobody holds and opened the page it would make. It is empty, not failing.
     */
    render(
      <ProfileCard
        p={{ ...profile, identity: undefined, wallet: null, answers: [], links: [], vouches: [] }}
        rootParent="ketsuban.eth"
      />
    );
    expect(screen.queryByTestId("checks")).toBeNull();
    expect(screen.queryByTestId("score")).toBeNull();

    // Every other empty section is the same nothing said again.
    expect(screen.queryByTestId("humanity")).toBeNull();
    expect(screen.queryByText("Linked accounts")).toBeNull();

    const blank = screen.getByTestId("blank-page");
    expect(blank).toHaveTextContent("Nobody holds this name");
    // The two things there are to do with it, for the two people who open it.
    expect(blank.querySelector("a[href='/me']")).not.toBeNull();
  });

  it("still grades a name once there is something to grade", () => {
    render(
      <ProfileCard
        p={{ ...profile, identity: undefined, wallet: null, answers: [], links: [] }}
        rootParent="ketsuban.eth"
      />
    );
    expect(screen.getByTestId("checks")).toBeInTheDocument();
    expect(screen.queryByTestId("blank-page")).toBeNull();
  });

  it("renders an unclaimed page", () => {
    render(
      <ProfileCard p={{ ...profile, wallet: null, answers: [], links: [] }} rootParent="ketsuban.eth" />
    );
    expect(screen.getByText("unclaimed")).toBeInTheDocument();
    expect(screen.queryByTestId("answers")).toBeNull();
    expect(screen.getByText("none")).toBeInTheDocument();
  });
});

/**
 * A page carrying only what others said about somebody reads as a dossier. What they said about
 * anybody else is the half they wrote themselves, and this page did not show it while their own
 * verification did — two routes to one question, answered differently depending on which link a
 * reader happened to follow.
 */
describe("what the candidate has said about others", () => {
  const gave = (refs: unknown[]) => ({
    ...profile,
    identity: { profile: null, references: refs } as never,
  });

  it("lists the references they gave, with where each one is read", () => {
    render(
      <ProfileCard
        p={gave([
          {
            kind: "answer",
            subject: "kju-is",
            subjectName: "kju-is.ketsuban.eth",
            statement: "a terrible dictator",
            ensName: "alice.kju-is.ketsuban.eth",
            validUntil: "2027-01-01T00:00:00.000Z",
          },
        ])}
        rootParent="ketsuban.eth"
      />
    );
    // Given is the second tab now: a reader wants one half of this at a time.
    fireEvent.click(screen.getByTestId("tab-given"));
    const refs = screen.getByTestId("references");
    expect(refs).toHaveTextContent("What do you think of Kim Jong Un?");
    expect(refs).toHaveTextContent("a terrible dictator");
    expect(refs).toHaveTextContent("alice.kju-is.ketsuban.eth");
  });

  it("says nothing at all when they have referred nobody", () => {
    render(<ProfileCard p={gave([])} rootParent="ketsuban.eth" />);
    expect(screen.queryByTestId("references")).toBeNull();
  });

  it("says nothing for a handle nobody holds, which has said nothing", () => {
    render(<ProfileCard p={{ ...profile, identity: undefined }} rootParent="ketsuban.eth" />);
    expect(screen.queryByTestId("references")).toBeNull();
  });
});
