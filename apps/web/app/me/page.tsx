import { Dashboard } from "./Dashboard";

export const metadata = { title: "Your page" };

export default function MePage() {
  return (
    <>
      <section className="hero">
        <h1>Your page</h1>
        <p>Everything below is a name anybody can read for themselves.</p>
      </section>
      <Dashboard />
    </>
  );
}
