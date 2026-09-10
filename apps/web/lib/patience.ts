/**
 * How long a page waits for a read it can render without.
 *
 * A page makes two kinds of read: the ones it is about, and the ones that improve it. The second kind
 * should never be able to delay the page as long as the first — an appendix nobody scrolled to, or a
 * description beside a link, is not worth twenty seconds of somebody looking at nothing. The default
 * timeout stays where it is for reads a page genuinely depends on.
 */
export const FLOURISH_MS = 2_000;

/** A signal for a read the page would rather skip than wait for. */
export const flourish = (): AbortSignal => AbortSignal.timeout(FLOURISH_MS);
