import { redirect } from "next/navigation";

/**
 * Claiming used to be its own page, which split the candidate across two screens that each knew half
 * the state. Everything a candidate does now lives on the profile, so this only forwards old links.
 */
export default async function ClaimPage({ searchParams }: { searchParams: Promise<{ renew?: string }> }) {
  await searchParams;
  redirect("/me");
}
