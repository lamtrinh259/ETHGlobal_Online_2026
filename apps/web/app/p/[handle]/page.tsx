import type { Metadata } from "next";
import Link from "next/link";
import { EnsProof } from "@/app/EnsProof";
import { PolicyForm } from "@/app/PolicyForm";
import { ProfileCard } from "@/app/ProfileCard";
import { Revealed } from "@/app/Revealed";
import { CopyButton } from "@/app/CopyButton";
import { createApi, type Verification } from "@/lib/api";
import { loadWebConfig } from "@/lib/config";
import { flourish } from "@/lib/patience";
import { assessProfile, HANDLE_RE, policyFromQuery, profileNames, shareSnippet } from "@/lib/profile";

export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ handle: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
};

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { handle } = await params;
  return {
    title: `${handle} — reference page`,
    description: "Ketsuban candidate page, read through the ENS resolver.",
  };
}

export default async function ProfilePage({ params, searchParams }: Params) {
  const { handle: raw } = await params;
  const handle = decodeURIComponent(raw).toLowerCase();
  const q = await searchParams;
  const config = loadWebConfig();
  const [root, ...subjects] = config.instances;
  const api = createApi(config.apiUrl, config.attestUrl);

  if (!HANDLE_RE.test(handle) || !root) {
    return (
      <section className="card">
        <h2>{handle}</h2>
        <p className="error" role="alert">
          not a valid handle
        </p>
      </section>
    );
  }

  const names = profileNames(handle, config);
  let error: string | undefined;
  // One composed read instead of one per instance plus the references (`GET /v1/profile/:handle`).
  let read: Awaited<ReturnType<typeof api.profile>> | undefined;
  /*
   * Whether this label is somebody's to hold.
   *
   * A mount hangs one label under the root, which is also where a person's name goes, so `x` grades as
   * a candidate: unclaimed, incomplete, a column of failed checks. That is a verdict on a name the
   * registrar will never let anybody claim. The deployment knows which labels those are; this page
   * cannot, because its own config lists only the name domains.
   */
  const [composed, claim] = await Promise.all([
    api
      .profile(handle, {
        links: q.links?.split(","),
        viewCode: q.viewCode as `0x${string}` | undefined,
      })
      .catch((e: Error) => e),
    api.explain(`${handle}.${root.parentName}`, { signal: flourish() }).catch(() => null),
  ]);
  if (composed instanceof Error) error = composed.message;
  else read = composed;

  if (claim?.kind === "mount") {
    return (
      <section className="card" data-testid="mount-name">
        <h2>{`${handle}.${root.parentName}`}</h2>
        <p className="muted">{claim.says}</p>
      </section>
    );
  }
  const results = names.map((name, i) => ({
    instanceDomain: config.instances[i].domain,
    name,
    v: (read?.names.find((n) => n.name === name)?.verification ?? null) as Verification | null,
  }));
  const policy = policyFromQuery(
    q,
    subjects.map((s) => s.domain)
  );
  const ens = await api.ens(names[0], undefined, { signal: flourish() }).catch(() => null);
  const vouches = read?.vouches ?? [];
  const profile = assessProfile(handle, results, policy, vouches);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "";

  return (
    <>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <ProfileCard p={profile} rootParent={root.parentName} policy={policy} />

      {/* The bar this reading was graded against, adjustable where the reading is. Folded away: most
          readers take the default, and the ones who do not are looking for it. */}
      <details className="card" data-testid="policy-editor">
        <summary>Your policy</summary>
        <PolicyForm handle={handle} subjectDomains={subjects.map((s) => s.domain)} />
      </details>

      {/* One link can open several accounts: the grant was one signature over the whole selection.
          Followed here rather than at `/v/`, which now sends a person's name to this page. */}
      {q.reveal
        ?.split(",")
        .filter(Boolean)
        .map((domain) => (
          <Revealed key={domain} name={names[0]} domain={domain} audience={q.for} />
        ))}
      {/*
        One appendix, not three cards between the references and the bottom of the page.
        Resolving the names and reading the JSON are the same claim said twice — that this page is a
        formatting of records anybody can read without it — and they were sitting where a reader was
        still deciding about a person. The third card told whoever opened the page how to alias their
        own `.eth` name, which is the subject's business and lives on the subject's dashboard.
      */}
      <details className="card" data-testid="read-it-raw">
        <summary>Read it without this app</summary>
        <p className="muted">
          Every field above is a resolver read. Any ENS client resolves the same names; the API only formats
          them.
        </p>
        <ul>
          {names.map((n) => (
            <li key={n}>
              <Link href={`/v/${n}`}>{n}</Link>
            </li>
          ))}
        </ul>
        <p className="muted">
          The same page as JSON, conservative and bounded — never authorisation to execute anything:
        </p>
        <p>
          <code>
            GET {config.apiUrl}/v1/verify/{names[0]}
          </code>{" "}
          ·{" "}
          <code>
            GET {config.apiUrl}/v1/vouches/{handle}
          </code>
        </p>
      </details>
      <EnsProof ens={ens} name={names[0]} />
      <section className="card">
        <h3>Share</h3>
        <code>{shareSnippet(handle, siteUrl, root.parentName)}</code>
        <p>
          <CopyButton text={shareSnippet(handle, siteUrl, root.parentName)} label="Copy" />
        </p>
      </section>
    </>
  );
}
