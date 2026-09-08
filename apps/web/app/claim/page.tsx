import { loadWebConfig } from "@/lib/config";
import { ClaimFlow } from "./ClaimFlow";

export const metadata = { title: "Claim your name" };

export default function ClaimPage() {
  const config = loadWebConfig();
  const [root, ...subjects] = config.instances;
  return (
    <>
      <section className="hero">
        <h1>Claim your name</h1>
        <p>
          Three steps: sign in, claim <code>&lt;handle&gt;.{root?.parentName}</code>, then answer{" "}
          {subjects.length === 1 ? "the question" : "the questions"} employers ask. Each answer is its own
          permanent name under yours.
        </p>
      </section>
      <ClaimFlow />
    </>
  );
}
