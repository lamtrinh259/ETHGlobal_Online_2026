/**
 * A short explanation attached to the thing it explains.
 *
 * Used where a field's behaviour is surprising and the surprise is permanent — what goes on chain and
 * what does not. The text is a `title`, so it is reachable by pointer and by screen reader without
 * spending a paragraph of the page on it.
 */
export function Hint({ text }: { text: string }) {
  return (
    <span className="hint" tabIndex={0} role="note" aria-label={text} title={text} data-testid="hint">
      ?
    </span>
  );
}
