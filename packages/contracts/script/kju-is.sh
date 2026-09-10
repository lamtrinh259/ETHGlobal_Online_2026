#!/usr/bin/env bash
# Who the `kju-is` page is about, written onto the name itself.
#
# A page created for someone who has claimed nothing is only worth reading if it says who they are.
# These are ordinary ENS text records on `kju-is.<root>`, so any client reads the same thing without
# this app. Attribution is stated as attribution: Lazarus is attributed to the DPRK by governments,
# which is a different claim from one this deployment would be making on its own account.
#
#   PERMISSIONED_RESOLVER=0x… ROOT=ketsuban.eth PRIVATE_KEY=$OPERATOR_KEY RPC=… ./script/kju-is.sh
set -euo pipefail

: "${PRIVATE_KEY:?set PRIVATE_KEY}"
: "${RPC:?set RPC}"
ROOT="${ROOT:-ketsuban.eth}"
NAME="kju-is.${ROOT}"

# The stock resolver's admin is not ours to write with, so the text lives on our own resolver, which
# already answers for this label. RESOLVER is the AttestationResolver the root name points at.
: "${RESOLVER:?set RESOLVER — cast call \$ETH_REGISTRY 'getResolver(string)(address)' ketsuban}"
write() {
  cast send "$RESOLVER" "setAbout(string,string,string)" "kju-is" "$1" "$2" \
    --private-key "$PRIVATE_KEY" --rpc-url "$RPC"
}

write name "Kim Jong Un"

write description "Kim Jong Un, Supreme Leader of North Korea. The United States and allied governments attribute the Lazarus Group to the DPRK; its operators are known to seek engineering roles under assumed identities. Answering here is something a candidate can do freely and a DPRK-linked operator cannot, which is what makes the answer worth reading."

write url "https://home.treasury.gov/news/press-releases/sm774"

# Wikimedia's own thumbnail, so nothing here has to host or resize a picture. Only the widths
# Wikimedia has already generated are served — 330px answers, 256px does not — so this URL is the
# resized one rather than a size to pick freely.
write avatar "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d0/Kim_Jong-un_and_Vladimir_Putin_%282023-09-13%29_12_%28cropped_2%29.jpg/330px-Kim_Jong-un_and_Vladimir_Putin_%282023-09-13%29_12_%28cropped_2%29.jpg"

echo "written · read it back with:"
echo "  cast call \$UNIVERSAL_RESOLVER 'resolve(bytes,bytes)(bytes,address)' <dns-encoded $NAME> \\"
echo "    \$(cast calldata 'text(bytes32,string)' \$(cast namehash $NAME) 'description') --rpc-url \$RPC"
