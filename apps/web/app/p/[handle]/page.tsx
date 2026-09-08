import type { Metadata } from "next";
import Link from "next/link";
import { ProfileCard } from "@/app/ProfileCard";
import { CopyButton } from "@/app/CopyButton";
import { createApi, type Verification } from "@/lib/api";
import { loadWebConfig } from "@/lib/config";
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
  const results = await Promise.all(
    names.map(async (name, i) => {
      let v: Verification | null = null;
      try {
        v = await api.verify(name, {
          links: q.links?.split(","),
          viewCode: q.viewCode as `0x${string}` | undefined,
        });
      } catch (e) {
        error ??= (e as Error).message;
      }
      return { instanceDomain: config.instances[i].domain, name, v };
    })
  );
  const policy = policyFromQuery(
    q,
    subjects.map((s) => s.domain)
  );
  const profile = assessProfile(handle, results, policy);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "";

  return (
    <>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <ProfileCard p={profile} rootParent={root.parentName} />
      <section className="card">
        <h3>Verify it yourself</h3>
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
          Policy:{" "}
          {policy.requiredAnswers.length
            ? `answers ${policy.requiredAnswers.join(", ")}`
            : "no answers required"}
          , ≥{policy.minLinks} linked account{policy.minLinks === 1 ? "" : "s"}
          {policy.requireHumanity ? ", humanity attested" : ""}. Change it with{" "}
          <code>?answers=&amp;minLinks=&amp;humanity=1</code>.
        </p>
      </section>
      <section className="card">
        <h3>Share</h3>
        <code>{shareSnippet(handle, siteUrl, root.parentName)}</code>
        <p>
          <CopyButton text={shareSnippet(handle, siteUrl, root.parentName)} label="Copy" />{" "}
          <Link href={`/vouch/${handle}`}>Ask someone to vouch →</Link>
        </p>
      </section>
    </>
  );
}
