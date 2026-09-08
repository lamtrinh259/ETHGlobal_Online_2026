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
        <Link href="/claim" className="door">
          <span className="door-k">I&apos;m a candidate</span>
          <span className="door-t">Claim your name</span>
          <span className="door-d muted">
            Sign in, pick a handle, answer the questions employers ask, share one link.
          </span>
        </Link>
        <Link href="/vouch" className="door">
          <span className="door-k">I was asked to vouch</span>
          <span className="door-t">Write a reference</span>
          <span className="door-d muted">
            Prove you&apos;re a unique human, link your work account, sign two sentences. Permanent.
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
            <strong>Sign one message.</strong> A Chainlink CRE enclave verifies your identity token and signs
            the record as registrar — your linked-account details never leave it.
          </li>
          <li>
            <strong>It becomes a name.</strong> The record lands in Multipass and resolves under ENSv2 for
            anyone, no app required.
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
