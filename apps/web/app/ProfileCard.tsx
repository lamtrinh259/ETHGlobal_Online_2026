import Link from "next/link";
import { describePolicy, type Policy, type Profile } from "@/lib/profile";
import { questionTitle } from "@/lib/questions";
import { ProfileHead } from "./ProfileHead";
import { ReferenceTabs } from "./ReferenceTabs";
import { ScoreRing } from "./me/ScoreRing";
import { profileScore } from "@/lib/score";
import { fmtUtc } from "./ui";

/** The candidate reference page: identity, answers, links, humanity, and the policy checks. */
export function ProfileCard({ p, rootParent, policy }: { p: Profile; rootParent: string; policy?: Policy }) {
  /** Nobody holds it and nobody has written about it: there is nothing here to pass judgement on. */
  const blank = !p.identity && p.vouches.length === 0;
  return (
    <section className="card" aria-label="candidate page">
      {/* The same head as a person's verification and a subject's page: a reader arriving by any
          route is asking who this is first, and was being answered three different ways. */}
      <ProfileHead
        ensName={`${p.handle}.${rootParent}`}
        records={{
          description: p.identity?.profile?.description ?? undefined,
          url: p.identity?.profile?.url ?? undefined,
          avatar: p.identity?.profile?.avatar ?? undefined,
        }}
      >
        <p className="row">
          <span className={`badge ${p.complete ? "ok" : "off"}`} data-testid="completeness">
            {p.complete ? "complete" : "incomplete"}
          </span>
          <small className="muted">
            {p.identity && p.wallet ? (
              <>
                wallet <Link href={`/w/${p.wallet}`}>{p.wallet}</Link>
              </>
            ) : (
              "unclaimed"
            )}
          </small>
        </p>
      </ProfileHead>

      {!p.identity && p.vouches.some((v) => v.live) && (
        <p className="warning" data-testid="waiting">
          Nobody holds this name yet, and {p.vouches.filter((v) => v.live).length} reference
          {p.vouches.filter((v) => v.live).length === 1 ? " is" : "s are"} already written for it. If this is
          you, <Link href="/me">claim the name</Link> and they attach to it — an organisation can write a
          letter before the person has heard of us.
        </p>
      )}

      {/*
        A page with nothing on it is empty, not failing.
        Somebody typed a name nobody holds and opened the page it would make. Grading that produced a
        column of crosses and a score of nothing — a verdict on a person who has never been here, read
        by whichever of the two people opened it: someone about to write the first reference, or the
        person the name is for.
      */}
      {blank ? (
        <p data-testid="blank-page">
          Nobody holds this name and nobody has written about it yet. References written here are real and
          permanent, and none of them can be tied to a real account until whoever this is about{" "}
          <Link href="/me">claims the name</Link> — until then it is a page about a name.
        </p>
      ) : (
        <>
          {policy && (
            <p className="muted" data-testid="policy-line">
              Policy: {describePolicy(policy)}
            </p>
          )}
          <ul className="checks" data-testid="checks">
            {p.checks.map((c) => (
              <li key={c.id} className={c.ok ? "ok" : "no"}>
                <span className="check-mark" aria-hidden>
                  {c.ok ? "✓" : "✗"}
                </span>
                <span className="check-label">{c.label}</span>
                <span className="check-detail muted">{c.detail}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {/*
        The same reading the person gets of themselves, beside the verdict rather than below the page.
        A verifier was left to add up a column of checks; the ring is the one number, and its parts say
        which half of it is thin. It sat under the answers and the accounts, so the badge at the top
        and the number that explains it were half a page apart. Read-only here: the steps that fix
        each part are not a reader's.
      */}
      {!blank && (
        <ScoreRing
          {...profileScore({
            human: !!p.humanity,
            hasName: !!p.identity,
            accounts: p.links.length,
            profile: {
              avatar: p.identity?.profile?.avatar ?? "",
              description: p.identity?.profile?.description ?? "",
              url: p.identity?.profile?.url ?? "",
            },
            references: p.vouches.filter((v) => v.live).length,
          })}
        />
      )}

      {p.answers.length > 0 && (
        <>
          <h3>Answers</h3>
          <dl className="kv" data-testid="answers">
            {p.answers.map((a) => (
              <div key={a.domain} className="kv-row">
                {/* The question, then where it is answered. A verifier cannot judge "kju-is". */}
                <dt>
                  {questionTitle(a.domain)}
                  <br />
                  <small className="muted">
                    <code>{a.name}</code>
                  </small>
                </dt>
                <dd>
                  {a.status === "active" && a.answer ? (
                    <>
                      “{a.answer}” <small className="muted">valid until {fmtUtc(a.expiresAt)}</small>
                    </>
                  ) : (
                    <em>not answered</em>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}

      {!blank && <h3>Linked accounts</h3>}
      {blank ? null : p.links.length === 0 ? (
        <p>
          <em>none</em>
        </p>
      ) : (
        <ul data-testid="links">
          {p.links.map((l) => (
            <li key={l.domain}>
              <code>{l.domain}</code>{" "}
              {l.disclosed ? (
                <>
                  @{l.disclosed.handle}{" "}
                  <span className="badge ok" data-testid="disclosed">
                    disclosed to you by the candidate
                  </span>
                </>
              ) : l.optedIn ? (
                "verified, masked — needs a view code"
              ) : (
                "verified"
              )}
              {/* The name it answers at: a reader can check the account without trusting this page. */}
              {l.ensName && (
                <>
                  {" · "}
                  <Link href={`/v/${l.ensName}`}>
                    <code>{l.ensName}</code>
                  </Link>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* What they said about others, alongside what others said about them: one question with two
          halves, and a reader wants one of them at a time. */}
      <ReferenceTabs handle={p.handle} vouches={p.vouches} references={p.identity?.references} />

      {!blank && (
        <>
          <h3>Humanity</h3>
          <p data-testid="humanity">{p.humanity ? `attested (${p.humanity.level})` : "not attested"}</p>
        </>
      )}
    </section>
  );
}
