import { Dashboard } from "./Dashboard";

export const metadata = { title: "Your page" };

export default function MePage() {
  return (
    <>
      <section className="hero">
        <h1>Your page</h1>
        <p>
          Four things make a reference worth reading: your name, your answers, the accounts that back you, and
          who spoke for you.
        </p>
      </section>
      <Dashboard />
    </>
  );
}
