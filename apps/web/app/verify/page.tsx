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
          {/* Every line here is something the reader will calibrate on, so the enclave is claimed only
              where it holds: on a deployment signing from its own node it is the operator who is
              trusted, and saying otherwise borrows a guarantee this one has not got. */}
          <li>
            <strong>Linked accounts</strong> — control of a platform account at verification time,{" "}
            {config.confidential ? (
              <>
                attested inside a <strong>Chainlink CRE enclave</strong>, so neither this service nor its
                operator saw the handle
              </>
            ) : (
              <>attested by this deployment&apos;s own attester, which reads the handle to mask it</>
            )}
            ; masked ones need the candidate&apos;s view code.
          </li>
          <li>
            <strong>Not</strong> identity, employment, safety, nationality or affiliation verification.
          </li>
        </ul>
      </section>
    </>
  );
}
