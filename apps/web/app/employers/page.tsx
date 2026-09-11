import type { Metadata } from "next";
import { loadWebConfig } from "@/lib/config";
import { Employers } from "./Employers";

export const metadata: Metadata = {
  title: "For employers",
  description: "Set one bar, ask people to meet it, and read where each of them stands.",
};

export const dynamic = "force-dynamic";

export default function EmployersPage() {
  const config = loadWebConfig();
  const [, ...subjects] = config.instances;
  return (
    <>
      <section className="hero">
        <h1>
          One bar, and where everyone <span className="knot">stands</span>
        </h1>
        <p>
          Set what you require once, send it to the people you are considering, and read the answers side by
          side. Nothing here is stored by us: the bar and the list are your browser&apos;s.
        </p>
      </section>
      <Employers subjectDomains={subjects.map((s) => s.domain)} />
    </>
  );
}
