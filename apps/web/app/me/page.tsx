import Link from "next/link";
import { returnTo, whatIsBack } from "@/lib/journey";
import { Dashboard } from "./Dashboard";

export const metadata = { title: "Your page" };

export default async function MePage({ searchParams }: { searchParams: Promise<{ then?: string }> }) {
  /*
   * The way back from a detour.
   *
   * Linking an account is a one-time step here, asked of somebody halfway through writing a reference
   * for a particular person. That page tells them to come back afterwards and gave them nothing to
   * come back with, so they had to remember who they were referring and find them again.
   */
  const back = returnTo((await searchParams).then);

  return (
    <>
      <section className="hero">
        <h1>Your page</h1>
        <p>Everything below is a name anybody can read for themselves.</p>
      </section>
      {back && (
        <p className="card" data-testid="way-back">
          <Link className="button primary" href={back}>
            ← Back to {whatIsBack(back)}
          </Link>{" "}
          <small className="muted">Finish below and this takes you straight back to it.</small>
        </p>
      )}
      <Dashboard />
    </>
  );
}
