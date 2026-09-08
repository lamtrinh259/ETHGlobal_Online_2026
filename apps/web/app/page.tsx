import { AttestFlow } from "./AttestFlow";
import { loadWebConfig } from "@/lib/config";

export default function Home() {
  const config = loadWebConfig();
  return (
    <>
      <section className="hero">
        <h1>
          A reference that cannot be <span className="knot">deleted</span>
        </h1>
        <p>
          Sign in, link an account, sign one message. An enclave verifies your identity token and signs a
          record that becomes <code>&lt;handle&gt;.{config.instances[0]?.parentName}</code> — readable by any
          wallet, permanent.
        </p>
      </section>
      <AttestFlow />
    </>
  );
}
