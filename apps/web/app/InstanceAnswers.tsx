import Link from "next/link";
import { questionTitle } from "@/lib/questions";
import { ProfileHead } from "./ProfileHead";
import { fmtUtc } from "./ui";

type Instance = {
  domain: string;
  parentName: string;
  description: string | null;
  /** Who the page is about, read from the name itself so any ENS client shows the same thing */
  records?: { name?: string; description: string; url: string; avatar: string };
  answers: { handle: string; ensName: string; answer: string; validUntil: string }[];
  /** How many have answered, which is not how many came back: the read carries a page of them. */
  total?: number;
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

      {/*
        The question this page collects answers to, which it never said.
        The card that leads here says it, and the answers are only worth reading against it — a reader
        arriving from a link was shown a name, a description and a list of quotes with nothing asked.
      */}
      <h3 data-testid="the-question">{questionTitle(data.domain)}</h3>
      {/* Anybody may answer, so this list has no bound. A page of it that does not say so reads as
          every answer there is. */}
      {(data.total ?? data.answers.length) > data.answers.length && (
        <p className="muted" data-testid="more-answers">
          Showing the newest {data.answers.length} of {data.total}.
        </p>
      )}
      {/* The page exists to be answered, and had no way to. A reader who has just decided what they
          think is the one person most likely to say it, and they were shown the door out. */}
      <p className="row" data-testid="answer-cta">
        <Link className="button primary" href="/me#refer">
          Answer this yourself
        </Link>
        <small className="muted">
          Your answer becomes a name of your own under <code>{data.parentName}</code>, signed by you and
          permanent.
        </small>
      </p>

      {data.answers.length === 0 ? (
        <p className="muted">Nobody has answered yet.</p>
      ) : (
        <ul className="acct">
          {data.answers.map((a) => (
            <li key={a.ensName} data-testid={`answer-${a.handle}`}>
              <span className="acct-id">
                <strong>“{a.answer}”</strong>
                {/*
                  Who said it, as somebody a reader can go and weigh.
                  An answer was attributed to the name of the record holding it, which resolves to a
                  card about that record — so a reader who found an answer worth something could not
                  get from it to the person, which is the only reason the answer is worth reading.
                */}
                <small className="muted">
                  <Link href={`/p/${a.handle}`} data-testid={`answered-by-${a.handle}`}>
                    {a.handle}
                  </Link>{" "}
                  · until {fmtUtc(a.validUntil)}
                </small>
                <small className="muted">
                  {/* The receipt: the name this answer itself resolves at, for a reader checking it. */}
                  <Link href={`/v/${a.ensName}`}>
                    <code>{a.ensName}</code>
                  </Link>
                </small>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
