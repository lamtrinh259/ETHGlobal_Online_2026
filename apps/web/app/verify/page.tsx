import { loadWebConfig } from "@/lib/config";
import { VerifyForm } from "./VerifyForm";

export const metadata = { title: "Check a candidate" };

export default function VerifyPage() {
  const config = loadWebConfig();
  const [root, ...subjects] = config.instances;
  return (
    <>
      <section className="hero">
        <h1>Check a candidate</h1>
        <p>
          Enter the handle from their &ldquo;Verify me at Ketsuban&rdquo; line. You get the page any wallet
          would read, graded against your policy, plus the raw names to resolve yourself.
        </p>
      </section>
      <VerifyForm subjectDomains={subjects.map((s) => s.domain)} />
      <section className="card">
        <h3>What a page can and cannot tell you</h3>
        <ul>
          <li>
            <strong>Claimed name</strong> — a wallet controls <code>&lt;handle&gt;.{root?.parentName}</code>{" "}
            right now.
          </li>
          <li>
            <strong>Answers</strong> — the candidate signed a statement into a permanent name; polarity
            readings are properties of the text, never of the person.
          </li>
          <li>
            <strong>Linked accounts</strong> — control of a platform account at verification time, attested
            inside an enclave; masked ones need the candidate&apos;s view code.
          </li>
          <li>
            <strong>Not</strong> identity, employment, safety, nationality or affiliation verification.
          </li>
        </ul>
      </section>
    </>
  );
}
