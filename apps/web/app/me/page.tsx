import { Dashboard } from "./Dashboard";

export const metadata = { title: "Your names" };

export default function MePage() {
  return (
    <>
      <section className="hero">
        <h1>Your names</h1>
        <p>
          Everything your wallet has signed: names, answers, linked accounts, and the references you gave.
        </p>
      </section>
      <Dashboard />
    </>
  );
}
