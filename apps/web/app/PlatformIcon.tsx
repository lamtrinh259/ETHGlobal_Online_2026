import {
  siApple,
  siDiscord,
  siFarcaster,
  siGithub,
  siGoogle,
  siInstagram,
  siLine,
  siSpotify,
  siTelegram,
  siTiktok,
  siTwitch,
  siX,
} from "simple-icons";

/**
 * The brand mark for a platform, by the domain a record lives in. Both the DNS name (`github.com`) and
 * the flat platform (`github`) mean the same account, because records written before the namespace
 * existed still live in the flat domain.
 *
 * Any domain can be attested — an ordinary mail host has no brand — so anything unknown falls back to a
 * monogram rather than a missing image.
 */
const BRANDS: Record<string, { title: string; hex: string; path: string }> = {
  x: siX,
  "x.com": siX,
  github: siGithub,
  "github.com": siGithub,
  telegram: siTelegram,
  "t.me": siTelegram,
  discord: siDiscord,
  "discord.com": siDiscord,
  google: siGoogle,
  "google.com": siGoogle,
  apple: siApple,
  "apple.com": siApple,
  instagram: siInstagram,
  "instagram.com": siInstagram,
  tiktok: siTiktok,
  "tiktok.com": siTiktok,
  spotify: siSpotify,
  "spotify.com": siSpotify,
  twitch: siTwitch,
  "twitch.tv": siTwitch,
  line: siLine,
  "line.me": siLine,
  farcaster: siFarcaster,
  "farcaster.xyz": siFarcaster,
  // LinkedIn is not in simple-icons — the set drops brands on trademark request — so it takes the
  // monogram, which is what that fallback is for.
};

export function PlatformIcon({ domain, size = 20 }: { domain: string; size?: number }) {
  const brand = BRANDS[domain.toLowerCase()];
  if (!brand) {
    return (
      <span className="p-icon p-mono" data-testid={`icon-${domain}`} aria-label={domain} role="img">
        {domain.slice(0, 1).toLowerCase()}
      </span>
    );
  }
  return (
    <svg
      className="p-icon"
      data-testid={`icon-${domain}`}
      role="img"
      aria-label={brand.title}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      // The brand's own colour, so a row of accounts is scannable at a glance.
      fill={`#${brand.hex}`}
    >
      <path d={brand.path} />
    </svg>
  );
}
