import Link from "next/link";
import { fmtUtc } from "./ui";

type Instance = {
  domain: string;
  parentName: string;
  description: string | null;
  /** Who the page is about, read from the name itself so any ENS client shows the same thing */
  records?: { description: string; url: string; avatar: string };
  answers: { handle: string; ensName: string; answer: string; validUntil: string }[];
};

/**
 * A name people answer under.
 *
 * `kju-is.<root>` is not an unclaimed person; it is where answers about one are published. Reporting
 * "no record" here read as though the name were broken, and hid every answer anyone wrote.
 */
export function InstanceAnswers({ data }: { data: Instance }) {
  return (
    <section className="card" data-testid="instance-answers">
      <h2>{data.parentName}</h2>

      {/* Who this page is about, from the name's own records. A page for someone who has claimed
          nothing is only worth reading if it says who they are, and that belongs on chain. */}
      {(data.records?.description || data.records?.url || data.records?.avatar) && (
        <div className="me-head" data-testid="about">
          {data.records.avatar && (
            // eslint-disable-next-line @next/next/no-img-element -- an arbitrary URL, not a bundled asset
            <img src={data.records.avatar} alt="" className="me-avatar-img" width={72} height={72} />
          )}
          <div className="me-head-text">
            {data.records.description && <p>{data.records.description}</p>}
            {data.records.url && (
              <a href={data.records.url} rel="noreferrer nofollow" data-testid="about-url">
                {data.records.url}
              </a>
            )}
          </div>
        </div>
      )}

      {!data.records?.description && data.description && <p className="muted">{data.description}</p>}
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
