/** The prompt shown for a subject instance; a deployment argument in spirit, a table for now. */
export function questionFor(domain: string): string {
  const known: Record<string, string> = {
    "kju-is": "What do you think of Kim Jong Un? (a few words, permanent)",
  };
  return known[domain] ?? `Your answer for ${domain} (a few words, permanent)`;
}

/** The same question with nothing appended: a heading, not a form label. */
export function questionTitle(domain: string): string {
  return questionFor(domain).replace(/\s*\([^)]*\)\s*$/, "");
}
