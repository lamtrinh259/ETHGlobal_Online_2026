import type { Contracts } from "./api";

export type NameKind = {
  /** What lives here, in the reader's words */
  what: string;
  /** The shape of the name, with `<>` standing for what varies */
  pattern: string;
  detail: string;
};

/**
 * The namespace a deployment holds, read back from its own mounts. Nothing here is a convention this
 * page invented: every pattern comes from a `parentName` the factory recorded on chain.
 */
export function nameKinds(contracts: Contracts | undefined, nameDomains: readonly string[]): NameKind[] {
  const instances = contracts?.instances ?? [];
  const root = instances.find((i) => nameDomains.includes(i.domain));
  if (!root) return [];
  const platform = instances.find((i) => i.parentName.includes(".www.")) ?? undefined;
  const mail = instances.find((i) => i.maskedParentName?.includes("private@")) ?? undefined;
  const priv = instances.find((i) => i.maskedParentName) ?? undefined;

  return [
    {
      what: "A person",
      pattern: `<name>.${root.parentName}`,
      detail: "The handle they claimed. Everything else hangs off levels reserved beside it.",
    },
    ...(platform
      ? [
          {
            what: `An account on ${platform.domain}`,
            pattern: `<handle>.${platform.parentName}`,
            detail:
              "A platform is the DNS name it actually is, mounted first label first, so a service that hands out subdomains keeps its own chain.",
          },
        ]
      : []),
    ...(mail
      ? [
          {
            what: `An address at ${mail.domain}`,
            pattern: `<local part>.${mail.parentName}`,
            detail: "Mail hosts are grouped apart, because an address is not a handle.",
          },
        ]
      : []),
    ...(priv?.maskedParentName
      ? [
          {
            what: "An account kept private",
            pattern: `<name>.${priv.maskedParentName}`,
            detail:
              "Named after the person, never the account: the stored name is a one-time pad over the handle. It says they are there and stops.",
          },
        ]
      : []),
    {
      what: "A reference",
      pattern: `<voucher>.<name>.${root.parentName}`,
      detail: "Written in the candidate's own namespace, by someone they invited.",
    },
  ];
}

export type NameClaim = {
  /** What this name says, in a sentence */
  says: string;
  /** The part of the namespace it belongs to, when it belongs to one */
  kind: "person" | "account" | "private" | "reference" | "unknown";
  /** The domain it lives in, for an account */
  domain?: string;
  /** The label that varies: a person's handle, an account's handle */
  label?: string;
};

/**
 * What a name would claim, read from the mounts rather than from its shape. A reader pasting a name
 * deserves an answer even when nothing resolves there — "nobody holds this" and "this is not a name this
 * deployment could ever answer" are different facts.
 */
export function explainName(
  input: string,
  contracts: Contracts | undefined,
  nameDomains: readonly string[]
): NameClaim {
  const name = input.trim().toLowerCase().replace(/\.$/, "");
  const instances = contracts?.instances ?? [];
  const root = instances.find((i) => nameDomains.includes(i.domain));
  if (!name || !root) return { says: "", kind: "unknown" };

  const under = (parent: string) => {
    const suffix = `.${parent.toLowerCase()}`;
    if (!name.endsWith(suffix)) return undefined;
    const rest = name.slice(0, -suffix.length);
    return rest && !rest.includes(".") ? rest : undefined;
  };

  for (const mount of instances) {
    const open = under(mount.parentName);
    if (open && !nameDomains.includes(mount.domain)) {
      return {
        says: `${open} is an account at ${mount.domain}, attested in the open by whoever holds it.`,
        kind: "account",
        domain: mount.domain,
        label: open,
      };
    }
    const masked = mount.maskedParentName ? under(mount.maskedParentName) : undefined;
    if (masked) {
      return {
        says: `The person called ${masked} holds an account at ${mount.domain}. Which account stays behind a view code.`,
        kind: "private",
        domain: mount.domain,
        label: masked,
      };
    }
  }

  const person = under(root.parentName);
  if (person) return { says: `${person} is a person's name here.`, kind: "person", label: person };

  // `<voucher>.<candidate>.<root>`: a reference lives in the candidate's own namespace.
  const suffix = `.${root.parentName.toLowerCase()}`;
  if (name.endsWith(suffix)) {
    const rest = name.slice(0, -suffix.length).split(".");
    if (rest.length === 2)
      return {
        // Two labels under the root is the shape of a reference, whoever holds them: only a lookup can
        // say whether that candidate exists, and the verify page is the place that does it.
        says: `A reference written for ${rest[1]} by ${rest[0]}, in ${rest[1]}'s own namespace — if ${rest[1]} holds that name.`,
        kind: "reference",
        label: rest[0],
      };
  }
  return {
    says: `Nothing in this deployment answers for ${name}. It ends outside every namespace it holds.`,
    kind: "unknown",
  };
}
