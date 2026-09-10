#!/usr/bin/env bash
# Everything CI checks, in CI's order, from one command.
#
# `pnpm test` runs the unit suites and stops there — no browser journeys, no docker loop. That gap is
# how a change passes locally and fails on push: it happened twice in one day here, once when a form
# moved behind a disclosure the journeys still typed into, and once when a fixture kept hashing a
# signal the way the server had stopped hashing it. Neither unit suite could have known.
#
#   ./scripts/verify.sh          # what the `check` job runs
#   ./scripts/verify.sh --e2e    # and the docker loop the `e2e` job runs
set -euo pipefail
cd "$(dirname "$0")/.."

step() { printf "\n\033[1m-- %s\033[0m\n" "$1"; }

step "packages (the apps import what these generate)"
pnpm --filter "./packages/**" run build

step "lint"
pnpm -w lint

step "typecheck"
pnpm -w typecheck

# One at a time, as CI does: a recursive run that hangs says nothing about which package hung.
for pkg in @ketsuban/registrar @ketsuban/contracts @ketsuban/cre-attest @ketsuban/api @ketsuban/web; do
  step "$pkg"
  pnpm --filter "$pkg" test
done

step "browser journeys"
# NEXT_PUBLIC_* are inlined at build, so the app cannot start without them; the example file is a
# complete, public-by-design config and a fresh checkout has no .env.local.
[ -f apps/web/.env.local ] || cp apps/web/.env.example apps/web/.env.local
pnpm --filter @ketsuban/web run test:e2e

if [ "${1:-}" = "--e2e" ]; then
  step "docker: anvil, the contracts, and the api image"
  pnpm --filter @ketsuban/api test:e2e
fi

printf "\n\033[1mall green\033[0m\n"
