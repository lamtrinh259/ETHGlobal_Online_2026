import { questionTitle } from "./questions";

/**
 * A reference someone is commonly asked to give. The list exists because a blank box asks a visitor
 * to invent something; these are the asks this deployment actually expects.
 *
 * Kept out of the component that renders it: the vouch page is a server component and reads an ask
 * straight from the URL, which it cannot do from a module marked `"use client"`.
 */
export type Ask = { id: string; label: string; placeholder: string };

export const POPULAR_ASKS: Ask[] = [
  { id: "kju-is", label: questionTitle("kju-is"), placeholder: "a terrible dictator" },
  { id: "worked-together", label: "How you worked together", placeholder: "CTO at Acme 2019-22" },
  { id: "know-them", label: "How you know them", placeholder: "co-founded Acme with them" },
];

/** What an `?ask=` in a reference link means. An id nobody offers gives the plain form, not an error. */
export function askById(id: string | undefined): Ask | undefined {
  return id ? POPULAR_ASKS.find((a) => a.id === id) : undefined;
}
