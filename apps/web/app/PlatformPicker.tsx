"use client";

import { PLATFORM_DNS_NAMES } from "@ketsuban/registrar";
import { PlatformIcon } from "./PlatformIcon";

export type Platform = {
  /** The Privy login method, as the SDK names it */
  id: string;
  /** How a person says it */
  label: string;
  /** The domain a record for this account lives in */
  dns: string;
};

const LABELS: Record<string, string> = {
  x: "X",
  google: "Google",
  github: "GitHub",
  discord: "Discord",
  telegram: "Telegram",
  linkedin: "LinkedIn",
  apple: "Apple",
  instagram: "Instagram",
  tiktok: "TikTok",
  spotify: "Spotify",
  twitch: "Twitch",
  line: "LINE",
  farcaster: "Farcaster",
};

/**
 * Every login method this app can attest, in one list.
 *
 * Written once because it was written three times: the accounts card, the invite requirements and the
 * refer form each had their own subset, and a platform added to one was missing from the others.
 */
export const PLATFORMS: Platform[] = Object.entries(PLATFORM_DNS_NAMES).map(([id, dns]) => ({
  id,
  label: LABELS[id] ?? id,
  dns,
}));

/**
 * Pick platforms, by the domain their records live in. `single` narrows it to asking which one rather
 * than which several; the caller decides what a choice means.
 */
export function PlatformPicker({
  selected,
  onToggle,
  single = false,
  only,
}: {
  selected: readonly string[];
  onToggle: (dns: string) => void;
  single?: boolean;
  /** Limit the list, for a caller that can only act on some of them */
  only?: readonly string[];
}) {
  const shown = only ? PLATFORMS.filter((p) => only.includes(p.dns)) : PLATFORMS;
  return (
    <p className="row platform-picker" role="group" aria-label="platforms">
      {shown.map((p) => (
        <button
          key={p.dns}
          className={selected.includes(p.dns) ? "primary" : ""}
          aria-label={p.label}
          aria-pressed={single ? selected.includes(p.dns) : undefined}
          onClick={() => onToggle(p.dns)}
          data-testid={`platform-${p.dns}`}
          title={p.label}
        >
          <PlatformIcon domain={p.dns} size={16} />
        </button>
      ))}
    </p>
  );
}
