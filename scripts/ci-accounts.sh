#!/usr/bin/env bash
# Test a real local Worker/D1/R2 with short-lived, independently signed session fixtures.
set -eu
umask 077
test_dir=$(mktemp -d)
config="./wrangler.accounts-test.$$.json"
export PIANORA_TEST_CONFIG="$config"
trap 'if [ -n "${server:-}" ]; then kill "$server" 2>/dev/null || true; wait "$server" 2>/dev/null || true; fi; rm -rf "$test_dir"; rm -f "$config"' EXIT
export PIANORA_TEST_DIR="$test_dir"
export CLERK_PUBLISHABLE_KEY=pk_test_Y2xlcmsucGlhbm9yYS50ZXN0JA
node scripts/account-config.mjs --local
node --input-type=module <<'JS'
import { writeFileSync, readFileSync } from 'node:fs';
import { generateKeyPair, exportSPKI, SignJWT } from 'jose';
const {privateKey,publicKey} = await generateKeyPair('RS256', {extractable:true});
const configPath = process.env.PIANORA_TEST_CONFIG;
const config = JSON.parse(readFileSync(configPath));
config.vars.CLERK_JWT_KEY = await exportSPKI(publicKey);
writeFileSync(configPath,JSON.stringify(config));
const tokens = {};
for (const name of ['owner','other','expired','foreign','pending','wrongIssuer']) {
  tokens[name] = await new SignJWT({sid:'sess_local', azp:name === 'foreign' ? 'https://other.test' : 'http://127.0.0.1:8791', sts:name === 'pending' ? 'pending' : 'active'})
    .setProtectedHeader({alg:'RS256'}).setSubject(name === 'other' ? 'user_other' : 'user_owner')
    .setIssuer(name === 'wrongIssuer' ? 'https://other.test' : 'https://clerk.pianora.test')
    .setIssuedAt().setExpirationTime(name === 'expired' ? '-2m' : '5m').sign(privateKey);
}
writeFileSync(process.env.PIANORA_TEST_DIR+'/sessions.json',JSON.stringify(tokens));
JS
tool=node_modules/.bin/wrangler
"$tool" d1 migrations apply DB --local --persist-to "$test_dir/state" -c "$config"
"$tool" d1 migrations apply CATALOG --local --persist-to "$test_dir/state" -c "$config"
node scripts/import-catalog.mjs --local --persist-to "$test_dir/state" --sql-out "$test_dir/catalog.sql"
"$tool" d1 execute CATALOG --local --persist-to "$test_dir/state" --file "$test_dir/catalog.sql" -c "$config" > "$test_dir/catalog-import.log"
"$tool" dev --local -c "$config" --port 8791 --persist-to "$test_dir/state" >"$test_dir/worker.log" 2>&1 &
server=$!
for attempt in {1..60}; do
  curl -fsS http://127.0.0.1:8791/api/account/options 2>/dev/null | grep -q "$CLERK_PUBLISHABLE_KEY" && break
  sleep 1
done
python3 scripts/verify-accounts.py

PIANORA_BROWSER="${PIANORA_BROWSER:-chromium}" python3 scripts/verify-catalog.py http://127.0.0.1:8791 --output artifacts/catalog.json
