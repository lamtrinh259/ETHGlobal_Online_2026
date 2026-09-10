import Link from "next/link";
import { fmtUtc } from "./ui";

type Instance = {
  domain: string;
  parentName: string;
  description: string | null;
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
      <h3>Answers under {data.parentName}</h3>
      {data.description && <p className="muted">{data.description}</p>}
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
