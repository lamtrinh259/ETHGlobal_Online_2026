/**
 * What an IDKit error code means to the person who hit it.
 *
 * The widget answers with a machine code, and the page used to print it: `credential_unavailable` is
 * not a sentence, and it is the code somebody sees when the credential this deployment asked for has
 * not been turned on for the app — a configuration problem they cannot fix and should not be blamed
 * for. Anything unrecognised is passed through rather than dressed up, so a code that means something
 * new is still legible.
 */
export function humanityError(code: string, credential: "proof_of_human" | "selfie"): string {
  const selfie = credential === "selfie";
  switch (code) {
    case "user_rejected":
      return "You cancelled the check. Nothing was written.";
    case "credential_unavailable":
    case "feature_unavailable":
      return selfie
        ? "Selfie Check is not available for this app yet — it is in preview and World has to enable it. Nothing is wrong on your side."
        : "You do not hold the credential this check asks for. An Orb verification is needed.";
    case "world_id_3_not_available":
    case "world_id_4_not_available":
      return "Your World App is too old for this check. Update it and try again.";
    case "max_verifications_reached":
      return "This proof has already been used as many times as the action allows.";
    case "nullifier_replayed":
      return "That proof has already been spent.";
    case "verification_rejected":
      return "World could not verify that proof.";
    case "unknown_rp":
    case "inactive_rp":
      return "World does not recognise this app. Its registration needs checking.";
    case "invalid_rp_signature":
    case "rp_signature_expired":
    case "timestamp_too_old":
      return "The request took too long to answer. Start the check again.";
    case "connection_failed":
      return "Could not reach World. Check your connection and try again.";
    default:
      return code;
  }
}
