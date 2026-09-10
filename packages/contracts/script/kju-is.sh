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

: "${PERMISSIONED_RESOLVER:?set PERMISSIONED_RESOLVER}"
: "${PRIVATE_KEY:?set PRIVATE_KEY}"
: "${RPC:?set RPC}"
ROOT="${ROOT:-ketsuban.eth}"
NAME="kju-is.${ROOT}"

write() {
  NAME="$NAME" KEY="$1" VALUE="$2" \
  PERMISSIONED_RESOLVER="$PERMISSIONED_RESOLVER" PRIVATE_KEY="$PRIVATE_KEY" \
  forge script script/SetInstanceText.s.sol --rpc-url "$RPC" --broadcast
}

write description "Kim Jong Un, Supreme Leader of North Korea. The United States and allied governments attribute the Lazarus Group to the DPRK; its operators are known to seek engineering roles under assumed identities. Answering here is something a candidate can do freely and a DPRK-linked operator cannot, which is what makes the answer worth reading."

write url "https://home.treasury.gov/news/press-releases/sm774"

echo "written · read it back with:"
echo "  cast call \$UNIVERSAL_RESOLVER 'resolve(bytes,bytes)(bytes,address)' <dns-encoded $NAME> \\"
echo "    \$(cast calldata 'text(bytes32,string)' \$(cast namehash $NAME) 'description') --rpc-url \$RPC"
