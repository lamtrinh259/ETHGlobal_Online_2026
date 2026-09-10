/**
 * An answer as a level in the namespace.
 *
 * Multipass keys everything by domain, so "everyone who answered `dictator`" is a domain of its own:
 * `kju-is:dictator`, mounted at `dictator.kju-is.<root>`, holding one record per person named by
 * their handle. That is the same shape a vouch domain uses (`~alice` under `alice.<root>`), and it is
 * what makes `peersky.dictator.kju-is.<root>` a name rather than a collision — two people answering
 * the same thing are two records in one domain, not two claims on one name.
 *
 * A person who answers again lands in a different answer domain; the first record stays where it was
 * until it lapses, because a claim already made is not edited by making another.
 */

/** How an answer domain is written: the question, a colon, the answer's label. */
export const ANSWER_SEPARATOR = ":";

/** The most a Multipass domain name can hold, being a bytes32. */
const DOMAIN_MAX_BYTES = 31;

/**
 * What someone wrote, as a label a name can hold. Nothing is invented: an answer with no letters or
 * digits in it has no label, and is refused rather than turned into something nobody meant.
 */
export function answerSlug(answer: string): string | undefined {
  const slug = answer
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || undefined;
}

/**
 * The Multipass domain an answer lives in, or nothing when it cannot fit one. Refused here rather
 * than on chain, where it would revert after the person had already signed.
 */
export function answerDomain(question: string, answer: string): string | undefined {
  const slug = answerSlug(answer);
  if (!slug) return undefined;
  const domain = `${question.toLowerCase()}${ANSWER_SEPARATOR}${slug}`;
  // Both halves are `[a-z0-9-]`, so one character is one byte. Counted rather than encoded because
  // this runs inside the enclave's runtime, which has no TextEncoder.
  return domain.length <= DOMAIN_MAX_BYTES ? domain : undefined;
}

/** The question and answer a domain stands for, or nothing when it is not an answer domain. */
export function answerOf(domain: string): { question: string; answer: string } | undefined {
  const at = domain.indexOf(ANSWER_SEPARATOR);
  if (at <= 0) return undefined;
  const question = domain.slice(0, at);
  const answer = domain.slice(at + 1);
  return question && answer ? { question, answer } : undefined;
}
