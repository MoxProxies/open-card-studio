#!/usr/bin/env bash
# Authentication hardening: password rules, throttling, session control,
# and the social endpoints' behaviour when no provider is configured.
set -u
BASE="${E2E_API_URL:-http://127.0.0.1:8001}"
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

echo "== throttling is targeted, not collective punishment =="
codes=""
for i in $(seq 1 8); do
  codes="$codes$(curl -s -o /dev/null -w '%{http_code} ' -X POST $BASE/api/auth/login "${J[@]}" -d "{\"email\":\"victim$S@example.com\",\"password\":\"wrongpassword1\"}")"
done
check "hammering one address starts returning 429" "True" "$(echo "$codes" | grep -q 429 && echo True || echo False)"
# The point of keying on email+IP: an attacker filling the bucket for one
# address must not lock everyone else out from the same IP.
check "a different account still signs in from the same IP" 200 "$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/auth/login "${J[@]}" -d "{\"email\":\"ok$S@example.com\",\"password\":\"password123\"}")"
check "and registration is unaffected" 201 "$(reg "after$S" "password123")"

echo
echo "== $pass passed, $fail failed =="
[ "$fail" -eq 0 ]
