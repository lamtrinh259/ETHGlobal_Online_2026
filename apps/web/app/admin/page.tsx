import type { Metadata } from "next";
import { Admin } from "./Admin";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin (demo)", robots: { index: false, follow: false } };

/**
 * Demo only. Not linked from anywhere. The API is the gate: it answers 501 wherever the registrar is
 * an enclave, and 401 without the token, and the page shows the refusal as it is.
 */
export default function AdminPage() {
  return (
    <>
      <section className="hero">
        <h1>Admin</h1>
        <p>For the demo: run the Selfie Check again on the same person.</p>
      </section>
      <Admin />
    </>
  );
}
