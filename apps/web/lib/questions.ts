/** The prompt shown for a subject instance; a deployment argument in spirit, a table for now. */
export function questionFor(domain: string): string {
  const known: Record<string, string> = {
    "kju-is": "What do you think of Kim Jong Un? (a few words, permanent)",
  };
  return known[domain] ?? `Your answer for ${domain} (a few words, permanent)`;
}
