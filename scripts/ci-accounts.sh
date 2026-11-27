#!/usr/bin/env bash
# Called in an ephemeral CI checkout with a private temporary directory shared between versions.
set -eu
root="$PWD"
tool="$root/node_modules/.bin/wrangler"
node scripts/account-config.mjs --local
cp "$PIANORA_TEST_DIR/test.env" .dev.vars
"$tool" d1 migrations apply DB --local --persist-to "$PIANORA_TEST_DIR/state" -c wrangler.accounts.generated.json
export PIANORA_LOCAL_MAIL_LOG="$PIANORA_TEST_DIR/wrangler.log"
"$tool" dev --local -c wrangler.accounts.generated.json --port 8791 --persist-to "$PIANORA_TEST_DIR/state" >"$PIANORA_LOCAL_MAIL_LOG" 2>&1 &
server=$!
trap 'kill "$server" 2>/dev/null || true; wait "$server" 2>/dev/null || true; rm -f .dev.vars' EXIT
for attempt in {1..60}; do
  curl -fsS http://127.0.0.1:8791/api/account/options 2>/dev/null | grep -q '"email":true' && break
  sleep 1
done
python "$PIANORA_TEST_SCRIPT"
