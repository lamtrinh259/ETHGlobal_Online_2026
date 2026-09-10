import Link from "next/link";
import { ProfileHead } from "./ProfileHead";
import { fmtUtc } from "./ui";

type Instance = {
  domain: string;
  parentName: string;
  description: string | null;
  /** Who the page is about, read from the name itself so any ENS client shows the same thing */
  records?: { name?: string; description: string; url: string; avatar: string };
  answers: { handle: string; ensName: string; answer: string; validUntil: string }[];
};

/**
 * A name people answer under.
 *
 * `kju-is.<root>` is not an unclaimed person; it is where answers about one are published. Reporting
 * "no record" here read as though the name were broken, and hid every answer anyone wrote.
 */
export function InstanceAnswers({
  data,
  texts,
}: {
  data: Instance;
  /** The same keys as ENS itself returned, for when the attester read a resolver ENS has replaced */
  texts?: Record<string, string>;
}) {
  // Prefer what the attester read — the same value by a shorter path — and fall back to the ENS read,
  // which follows the resolver the registry actually names.
  const about = {
    name: data.records?.name || texts?.name || "",
    description: data.records?.description || texts?.description || data.description || "",
    url: data.records?.url || texts?.url || "",
    avatar: data.records?.avatar || texts?.avatar || "",
  };
  return (
    <section className="card" data-testid="instance-answers">
      {/* The same head a person's page uses: a reader arriving at either asks who this is first. */}
      <ProfileHead
        ensName={data.parentName}
        records={{
          name: about.name || undefined,
          description: about.description || undefined,
          url: about.url || undefined,
          avatar: about.avatar || undefined,
        }}
      />
      {!about.description && <p className="muted">Nobody has said who this is about yet.</p>}

      <h3>Answers</h3>
      {data.answers.length === 0 ? (
        <p className="muted">Nobody has answered yet.</p>
      ) : (
        <ul className="acct">
          {data.answers.map((a) => (
            <li key={a.ensName} data-testid={`answer-${a.handle}`}>
              <span className="acct-id">
                <strong>“{a.answer}”</strong>
                <small className="muted">
                  <Link href={`/v/${a.ensName}`}>
                    <code>{a.ensName}</code>
                  </Link>{" "}
                  · until {fmtUtc(a.validUntil)}
                </small>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
