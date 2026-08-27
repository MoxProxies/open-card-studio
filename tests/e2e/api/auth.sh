#!/usr/bin/env bash
# Authentication hardening: password rules, throttling, session control,
# and the social endpoints' behaviour when no provider is configured.
set -u
BASE="${E2E_API_URL:-http://127.0.0.1:8001}"
ARTISAN="${E2E_ARTISAN:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../backend" && pwd)/artisan}"
pass=0; fail=0
check() { if [ "$2" = "$3" ]; then echo "  PASS  $1 ($3)"; pass=$((pass+1)); else echo "  FAIL  $1 — expected $2, got $3"; fail=$((fail+1)); fi; }
jqr() { python3 -c "import sys,json;d=json.load(sys.stdin);print(eval(sys.argv[1]))" "$1"; }
J=(-H 'Content-Type: application/json' -H 'Accept: application/json')
S=$(date +%s)$RANDOM

echo "== password rules =="
reg() { curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/auth/register "${J[@]}" -d "{\"name\":\"P W\",\"email\":\"$1@example.com\",\"password\":\"$2\"}"; }
check "an all-numeric password is refused" 422 "$(reg "num$S" "12345678")"
check "an all-letter password is refused" 422 "$(reg "let$S" "abcdefgh")"
check "a short password is refused" 422 "$(reg "sho$S" "ab1")"
check "letters and numbers is accepted" 201 "$(reg "ok$S" "password123")"

echo "== social endpoints with nothing configured =="
check "the provider list is public" 200 "$(curl -s -o /tmp/p.json -w '%{http_code}' $BASE/api/auth/providers -H 'Accept: application/json')"
check "and empty when unconfigured" 0 "$(cat /tmp/p.json | jqr "len(d)")"
check "starting an unconfigured provider 404s" 404 "$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/auth/google/start "${J[@]}" -d '{}')"
check "its callback 404s too" 404 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/auth/google/callback?code=x&state=y" -H 'Accept: application/json')"
check "an unknown provider 404s" 404 "$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/auth/myspace/start "${J[@]}" -d '{}')"

echo "== session control =="
TOK1=$(curl -s -X POST $BASE/api/auth/login "${J[@]}" -d "{\"email\":\"ok$S@example.com\",\"password\":\"password123\"}" | jqr "d['token']")
TOK2=$(curl -s -X POST $BASE/api/auth/login "${J[@]}" -d "{\"email\":\"ok$S@example.com\",\"password\":\"password123\"}" | jqr "d['token']")
check "two sign-ins give two tokens" "True" "$([ "$TOK1" != "$TOK2" ] && echo True || echo False)"
check "both work" "200 200" "$(curl -s -o /dev/null -w '%{http_code} ' $BASE/api/auth/me -H "Authorization: Bearer $TOK1" -H 'Accept: application/json'; curl -s -o /dev/null -w '%{http_code}' $BASE/api/auth/me -H "Authorization: Bearer $TOK2" -H 'Accept: application/json')"
check "logout ends only its own session" "401 200" "$(curl -s -o /dev/null -X POST $BASE/api/auth/logout -H "Authorization: Bearer $TOK1" -H 'Accept: application/json'; curl -s -o /dev/null -w '%{http_code} ' $BASE/api/auth/me -H "Authorization: Bearer $TOK1" -H 'Accept: application/json'; curl -s -o /dev/null -w '%{http_code}' $BASE/api/auth/me -H "Authorization: Bearer $TOK2" -H 'Accept: application/json')"
TOK3=$(curl -s -X POST $BASE/api/auth/login "${J[@]}" -d "{\"email\":\"ok$S@example.com\",\"password\":\"password123\"}" | jqr "d['token']")
check "logout-everywhere ends all of them" "401 401" "$(curl -s -o /dev/null -X POST $BASE/api/auth/logout-everywhere -H "Authorization: Bearer $TOK2" -H 'Accept: application/json'; curl -s -o /dev/null -w '%{http_code} ' $BASE/api/auth/me -H "Authorization: Bearer $TOK2" -H 'Accept: application/json'; curl -s -o /dev/null -w '%{http_code}' $BASE/api/auth/me -H "Authorization: Bearer $TOK3" -H 'Accept: application/json')"

echo "== the sessions list =="
SA=$(curl -s -X POST $BASE/api/auth/login "${J[@]}" -H 'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/120 Safari/537' -d "{\"email\":\"ok$S@example.com\",\"password\":\"password123\"}" | jqr "d['token']")
SB=$(curl -s -X POST $BASE/api/auth/login "${J[@]}" -H 'User-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 17) Safari/604' -d "{\"email\":\"ok$S@example.com\",\"password\":\"password123\"}" | jqr "d['token']")
curl -s -o /tmp/sess.json $BASE/api/auth/sessions -H "Authorization: Bearer $SA" -H 'Accept: application/json'
check "lists both live sessions" 2 "$(cat /tmp/sess.json | jqr "len(d)")"
check "labelled by device, not 'api'" "True" "$(cat /tmp/sess.json | jqr "str(sorted(x['device'] for x in d) == ['Chrome on macOS', 'Safari on iPhone'])")"
check "exactly one is marked current" 1 "$(cat /tmp/sess.json | jqr "sum(1 for x in d if x['current'])")"
check "the current one is the caller's" "Chrome on macOS" "$(cat /tmp/sess.json | jqr "[x['device'] for x in d if x['current']][0]")"
check "tokens carry an expiry" "True" "$(cat /tmp/sess.json | jqr "str(all(x['expires_at'] for x in d))")"
check "no token value is ever returned" "True" "$(grep -q '"token"' /tmp/sess.json && echo False || echo True)"
OTHER=$(cat /tmp/sess.json | jqr "[x['id'] for x in d if not x['current']][0]")
check "revoking another session works" 200 "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE $BASE/api/auth/sessions/$OTHER -H "Authorization: Bearer $SA" -H 'Accept: application/json')"
check "and that token is dead" 401 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/auth/me -H "Authorization: Bearer $SB" -H 'Accept: application/json')"
check "while the caller's still works" 200 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/auth/me -H "Authorization: Bearer $SA" -H 'Accept: application/json')"
# Another account's session id must not be revokable. That's the whole
# reason the lookup is scoped to $request->user()'s own tokens.
curl -s -o /dev/null -X POST $BASE/api/auth/register "${J[@]}" -d "{\"name\":\"Ot Her\",\"email\":\"other$S@example.com\",\"password\":\"password123\"}"
OTOK=$(curl -s -X POST $BASE/api/auth/login "${J[@]}" -d "{\"email\":\"other$S@example.com\",\"password\":\"password123\"}" | jqr "d['token']")
MINE=$(curl -s $BASE/api/auth/sessions -H "Authorization: Bearer $SA" -H 'Accept: application/json' | jqr "d[0]['id']")
check "someone else's session id 404s" 404 "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE $BASE/api/auth/sessions/$MINE -H "Authorization: Bearer $OTOK" -H 'Accept: application/json')"
check "and it's still alive" 200 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/auth/me -H "Authorization: Bearer $SA" -H 'Accept: application/json')"
check "revoking your own is a sign-out" "True" "$(curl -s -X DELETE $BASE/api/auth/sessions/$MINE -H "Authorization: Bearer $SA" -H 'Accept: application/json' | jqr "str(d['was_current'])")"
check "the caller's token is now dead" 401 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/auth/me -H "Authorization: Bearer $SA" -H 'Accept: application/json')"

echo "== password reset over real HTTP =="
check "forgot-password answers the same for a known address" 200 "$(curl -s -o /tmp/f1.json -w '%{http_code}' -X POST $BASE/api/auth/password/forgot "${J[@]}" -d "{\"email\":\"ok$S@example.com\"}")"
check "and for one that doesn't exist" 200 "$(curl -s -o /tmp/f2.json -w '%{http_code}' -X POST $BASE/api/auth/password/forgot "${J[@]}" -d "{\"email\":\"nobody-at-all$S@example.com\"}")"
check "with an identical body — no membership oracle" "True" "$([ "$(cat /tmp/f1.json)" = "$(cat /tmp/f2.json)" ] && echo True || echo False)"
check "a bogus reset token is refused" 422 "$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/auth/password/reset "${J[@]}" -d "{\"token\":\"not-a-real-token\",\"email\":\"ok$S@example.com\",\"password\":\"brandnew123\",\"password_confirmation\":\"brandnew123\"}")"

# The token is only ever delivered by email, so mint one the way an
# operator would (php artisan auth:reset-link) and drive the rest of the
# flow over HTTP. Not `tinker --execute`: that prints a PHP error message
# on stdout when anything is off, which then travels downstream as a
# "token" and fails somewhere unrelated.
RESET=$("$ARTISAN" auth:reset-link "ok$S@example.com" | grep -o 'token=[^&]*' | cut -d= -f2)
LIVE=$(curl -s -X POST $BASE/api/auth/login "${J[@]}" -d "{\"email\":\"ok$S@example.com\",\"password\":\"password123\"}" | jqr "d['token']")
check "a session is live before the reset" 200 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/auth/me -H "Authorization: Bearer $LIVE" -H 'Accept: application/json')"
check "resetting with a real token works" 200 "$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/auth/password/reset "${J[@]}" -d "{\"token\":\"$RESET\",\"email\":\"ok$S@example.com\",\"password\":\"brandnew123\",\"password_confirmation\":\"brandnew123\"}")"
check "every existing session is revoked by it" 401 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/auth/me -H "Authorization: Bearer $LIVE" -H 'Accept: application/json')"
check "the old password no longer works" 422 "$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/auth/login "${J[@]}" -d "{\"email\":\"ok$S@example.com\",\"password\":\"password123\"}")"
check "the new one does" 200 "$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/auth/login "${J[@]}" -d "{\"email\":\"ok$S@example.com\",\"password\":\"brandnew123\"}")"
check "and the token can't be replayed" 422 "$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/auth/password/reset "${J[@]}" -d "{\"token\":\"$RESET\",\"email\":\"ok$S@example.com\",\"password\":\"another123\",\"password_confirmation\":\"another123\"}")"

echo "== throttling is targeted, not collective punishment =="
codes=""
for i in $(seq 1 8); do
  codes="$codes$(curl -s -o /dev/null -w '%{http_code} ' -X POST $BASE/api/auth/login "${J[@]}" -d "{\"email\":\"victim$S@example.com\",\"password\":\"wrongpassword1\"}")"
done
check "hammering one address starts returning 429" "True" "$(echo "$codes" | grep -q 429 && echo True || echo False)"
# The point of keying on email+IP: an attacker filling the bucket for one
# address must not lock everyone else out from the same IP.
check "a different account still signs in from the same IP" 200 "$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/auth/login "${J[@]}" -d "{\"email\":\"ok$S@example.com\",\"password\":\"brandnew123\"}")"
check "and registration is unaffected" 201 "$(reg "after$S" "password123")"

echo
echo "== $pass passed, $fail failed =="
[ "$fail" -eq 0 ]
