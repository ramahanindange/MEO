#!/usr/bin/env bash
# Quick API check. Start the server first:  MEO_ADMIN_TOKEN=test ./build/meo_server --port 8080
set -e
B=${1:-http://localhost:8080}; T=${MEO_ADMIN_TOKEN:-test}
pass(){ echo "PASS  $1"; }; fail(){ echo "FAIL  $1"; exit 1; }
curl -sf $B/api/health >/dev/null && pass health || fail health
curl -sf $B/api/content | grep -q '"programmes"' && pass content || fail content
[ "$(curl -s -o /dev/null -w '%{http_code}' -X POST $B/api/subscribe -d '{"email":"bad"}')" = 422 ] && pass "subscribe rejects bad email" || fail subscribe-validation
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST $B/api/contact -d '{"name":"Test User","email":"t@example.com","message":"Automated test message"}')
[ "$code" = 201 ] && pass "contact saved" || fail "contact ($code)"
[ "$(curl -s -o /dev/null -w '%{http_code}' $B/api/admin/summary)" = 401 ] && pass "admin needs token" || fail admin-auth
curl -sf -H "Authorization: Bearer $T" $B/api/admin/summary | grep -q '"messages"' && pass "admin summary" || fail admin-summary
