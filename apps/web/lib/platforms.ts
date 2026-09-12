/**
 * Named by Privy but not linkable on this deployment's Privy app: Telegram needs a bot registered
 * there, and a button that fails is worse than none. One list, read by the picker, the link buttons
 * and the invitation rule, so a platform dropped here is dropped everywhere it could be asked for.
 */
export const UNLINKABLE_PLATFORMS: ReadonlySet<string> = new Set(["telegram"]);
