import Link from "next/link";
import { loadWebConfig } from "@/lib/config";
import { SignedIn } from "./SignedIn";

/** Three doors, one per role (spec §3): candidate, voucher, verifier. */
export default function Home() {
  const config = loadWebConfig();
  const root = config.instances[0];
  return (
    <>
      <section className="hero">
        <h1>
          A reference that cannot be <span className="knot">deleted</span>
        </h1>
        <p>
          Verified humans put their permanent name behind yours. Every record is an ENS name anyone can read —{" "}
          <code>&lt;you&gt;.{root?.parentName}</code> — and nothing on it can be quietly removed.
        </p>
      </section>

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
            you. <Link href="/names">What every name means →</Link>
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
