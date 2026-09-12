/**
 * Somebody who proved they are one real person: a green shield, wherever the page said so in words.
 *
 * The words stay for screen readers and for tests; the mark is what a reader scanning a list picks
 * out. Green is the palette's "verified" colour, and the shield is drawn rather than an emoji so it
 * is the same shape and the same green on every platform.
 */
export function HumanMark({ level }: { level?: string }) {
  const said = level === "selfie" ? "proved human (Selfie Check)" : "proved human";
  return (
    <span className="human-mark" role="img" aria-label={said} title={said} data-testid="human-mark">
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
        <path
          d="M12 2.5 4.5 5.4v6.1c0 4.6 3.1 8.6 7.5 10 4.4-1.4 7.5-5.4 7.5-10V5.4L12 2.5Z"
          fill="currentColor"
        />
        <path d="m8.6 12.2 2.3 2.3 4.6-4.8" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <span className="sr-only">proved human</span>
    </span>
  );
}
