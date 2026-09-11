import Link from "next/link";
import { createApi } from "@/lib/api";
import { loadWebConfig } from "@/lib/config";
import { flourish } from "@/lib/patience";
import { questionTitle } from "@/lib/questions";
import { FindPeople } from "./FindPeople";
import { SignedIn } from "./SignedIn";

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
      records: await api
        // The first page anybody sees, and a description is worth having only if it costs nothing.
        .instance(s.domain, { signal: flourish() })
        .then((r) => r.records)
        .catch(() => undefined),
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
        }))}
      />

      <SignedIn />

      <div className="doors">
        <Link href="/me" className="door">
          <span className="door-k">I&apos;m a candidate</span>
          <span className="door-t">Build your profile</span>
          <span className="door-d muted">
            Sign in, pick a handle, answer the questions employers ask, share one link. Letters written for
            you before you arrived attach when you claim it.
          </span>
        </Link>
        <Link href="/vouch" className="door">
          <span className="door-k">I was asked to vouch</span>
          <span className="door-t">Write a reference</span>
          <span className="door-d muted">
            Link the account you worked from, write a title and a letter, sign. Permanent — withdrawable,
            never deletable.
          </span>
        </Link>
        <Link href="/verify" className="door">
          <span className="door-k">I&apos;m hiring</span>
          <span className="door-t">Check a candidate</span>
          <span className="door-d muted">
            Read the page any wallet would, run your policy, verify every field on chain yourself.
          </span>
        </Link>
      </div>

      {/* The one thing a visitor can read and answer without an account. Every other door asks them to
          be somebody first; this asks them what they think, which is the whole product in one page. */}
      <section className="card">
        <h2>How it works</h2>
        <ol className="steps">
          <li>
            <strong>Sign in with Privy.</strong> An embedded wallet is created; you never see gas or a seed
            phrase.
          </li>
          <li>
            {/* Claimed only where it holds. The enclave is a real guarantee to somebody deciding whether
                to sign, so the page reads it off the address the browser will actually post to. */}
            <strong>Sign one message.</strong>{" "}
            {config.confidential ? (
              <>
                Your identity token is verified and the record signed inside a{" "}
                <strong>Chainlink CRE enclave</strong>, on hardware nobody here controls. That token lists
                every account you have linked; the enclave reads all of them and attests the one you chose.
                This service never sees it, and neither does its operator. What reaches the chain is that one
                account — masked, if you asked for that.
              </>
            ) : (
              <>
                The attester checks your Privy identity token and signs the record as registrar. Your account
                handles are masked or hashed before anything reaches the chain. The same step is built to run
                inside a Chainlink CRE enclave, so the attester never sees them either; this deployment signs
                on its own node.
              </>
            )}
          </li>
          <li>
            <strong>It becomes a name.</strong> The record lands in Multipass and resolves under ENSv2 for
            anyone, no app required — your own name, each account you attest, and each reference written for
            you.
          </li>
        </ol>
        <p className="warning">
          Ketsuban attests that accountable humans stood behind a claim. It is not identity, employment,
          safety, nationality or affiliation verification, and it never labels a person.
        </p>
      </section>
    </>
  );
}
