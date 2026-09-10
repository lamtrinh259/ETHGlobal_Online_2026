import { groupingFor } from "@ketsuban/registrar";
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
  // Which grouping level a mount sits under comes from the registrar's own rule, not from reading `.www.`
  // out of a string: rename a level there and this follows.
  const web = groupingFor("x");
  const mailGroup = groupingFor("email");
  const level = (mount: { parentName: string }, group: string) => mount.parentName.includes(`.${group}.`);
  const platform = instances.find((i) => level(i, web.open));
  const mail = instances.find((i) => level(i, mailGroup.open));
  const priv = instances.find((i) => i.maskedParentName);

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

// One implementation, two readers: the relay answers the same question at `/v1/explain/:name`.
export { explainName, type NameClaim } from "@ketsuban/registrar";
