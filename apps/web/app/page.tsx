import { createApi } from "@/lib/api";
import { loadWebConfig } from "@/lib/config";
import { flourish } from "@/lib/patience";
import { questionTitle } from "@/lib/questions";
import { FindPeople } from "./FindPeople";

/** Three doors, one per role (spec §3): candidate, voucher, verifier. */
// Reads each subject's own records, so the door says who it is about rather than what this file guesses.
export const dynamic = "force-dynamic";

export default async function Home() {
  const config = loadWebConfig();
  const [root, ...subjects] = config.instances;
  const api = createApi(config.apiUrl, config.attestUrl);
  /*
   * Who each subject is, read from the name itself.
   *
   * The question is a table in this codebase; the subject's name and description are records on chain
   * that anyone can read. A door saying "Kim Jong Un — attributed by the United States and allied
   * governments" is the page arguing for itself, where "Your answer for kju-is" is this file admitting
   * it was never told. An attester that cannot answer costs the description, not the door.
   */
  const about = await Promise.all(
    subjects.map(async (s) => ({
      ...s,
      ...(await api
        // The first page anybody sees, and a description is worth having only if it costs nothing.
        .instance(s.domain, { signal: flourish() })
        .then((r) => ({ records: r.records, answers: r.answers.length }))
        .catch(() => ({ records: undefined, answers: undefined }))),
    }))
  );
  return (
    <>
      <section className="hero">
        <h1>
          A reference that cannot be <span className="knot">deleted</span>
        </h1>
        <p>Verified humans put their permanent name behind yours, as an ENS name anyone can read.</p>
      </section>

      <FindPeople
        subjects={about.map((s) => ({
          domain: s.domain,
          parentName: s.parentName,
          title: questionTitle(s.domain),
          name: s.records?.name,
          about: s.records?.description,
          answers: s.answers,
        }))}
      />
    </>
  );
}
