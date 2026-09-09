import { Dashboard } from "./Dashboard";

export const metadata = { title: "Your page" };

export default function MePage() {
  return (
    <>
      <section className="hero">
        <h1>Your page</h1>
        <p>
          A reference is worth reading when it carries a name, the accounts behind it, the answers you
          stand by, and the people who spoke for you. Each one below is a name anybody can read for
          themselves.
        </p>
      </section>
      <Dashboard />
    </>
  );
}
