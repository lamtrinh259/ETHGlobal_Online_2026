import Link from "next/link";

export default function NotFound() {
  return (
    <section className="card">
      <h2>Not here</h2>
      <p className="muted">
        Names live at <code>/v/&lt;handle&gt;.&lt;instance&gt;.eth</code>.
      </p>
      <Link href="/">Publish a reference</Link>
    </section>
  );
}
