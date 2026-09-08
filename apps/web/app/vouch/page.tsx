import { VouchLookup } from "./VouchLookup";

export const metadata = { title: "Write a reference" };

export default function VouchIndex() {
  return (
    <>
      <section className="hero">
        <h1>Write a reference</h1>
        <p>Who asked you? Enter their handle, or open the link they sent you.</p>
      </section>
      <VouchLookup />
    </>
  );
}
