/**
 * What an employer sends somebody who has no page yet.
 *
 * The person is named by the account the employer knows them by, the bar is named, and the link
 * carries a code the attester resolves to the signed invitation — so the page the link opens can say
 * who is asking and for what, and the employer's own page can say later whether they came.
 */
export function policyInviteText(
  inviterName: string,
  policyLabel: string,
  platform: string,
  account: string,
  link: string,
  /** Set where the person already has a page: then there is nothing to connect, only the page to read */
  pageName?: string
): string {
  const begin = pageName
    ? `begin with your page (${pageName})`
    : `begin with connecting your ${platform} account (@${account})`;
  return (
    `${inviterName} is inviting you to pass their ${policyLabel} risk assessment policy, please follow this ` +
    `link and ${begin}: ${link}`
  );
}

/** Where the link goes: the person's own page, carrying the code the way a vouch link does. */
export function policyInviteLink(siteUrl: string, code: string): string {
  return `${siteUrl.replace(/\/$/, "")}/me?invite=${code}`;
}

/** How far the invited person has come, in the employer's list. */
export function policyInviteStatusText(status: "invited" | "linked" | "claimed", expired: boolean): string {
  if (expired && status === "invited") return "expired, never came";
  switch (status) {
    case "invited":
      return "pending — not here yet";
    case "linked":
      return "pending — account linked, no name yet";
    case "claimed":
      return "has a page";
  }
}
