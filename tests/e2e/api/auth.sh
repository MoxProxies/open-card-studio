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
# A TOTP code, computed here rather than by the backend's own library:
# generating and verifying with the same implementation would pass even
# if that implementation were wrong. `offset` shifts the timestep, for
# testing drift and replay.
totp() {
  python3 - "$1" "${2:-0}" <<'PYCODE'
import base64, hashlib, hmac, struct, sys, time
secret, offset = sys.argv[1], int(sys.argv[2])
key = base64.b32decode(secret.upper() + "=" * ((8 - len(secret) % 8) % 8))
counter = int(time.time()) // 30 + offset
digest = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
start = digest[-1] & 0x0F
print("%06d" % ((struct.unpack(">I", digest[start:start + 4])[0] & 0x7FFFFFFF) % 1000000))
PYCODE
}
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

echo "== two-factor authentication =="
TA=$(curl -s -X POST $BASE/api/auth/register "${J[@]}" -d "{\"name\":\"Two Factor\",\"email\":\"tfa$S@example.com\",\"password\":\"password123\"}")
TOKT=$(echo "$TA" | jqr "d['token']")
AT=(-H "Authorization: Bearer $TOKT")
check "a new account has no second factor" "False" "$(curl -s $BASE/api/auth/me "${AT[@]}" -H 'Accept: application/json' | jqr "str(d['has_two_factor'])")"
SETUP=$(curl -s -X POST $BASE/api/auth/2fa/setup "${AT[@]}" "${J[@]}" -d '{}')
SECRET=$(echo "$SETUP" | jqr "d['secret']")
check "setup returns a secret" "True" "$(echo "$SETUP" | jqr "str(len(d['secret']) >= 16)")"
check "and a scannable otpauth URI naming the account" "True" "$(echo "$SETUP" | jqr "str(d['otpauth_url'].startswith('otpauth://totp/') and 'tfa$S%40example.com' in d['otpauth_url'])")"
check "an unconfirmed secret doesn't gate sign-in yet" "True" "$(curl -s -X POST $BASE/api/auth/login "${J[@]}" -d "{\"email\":\"tfa$S@example.com\",\"password\":\"password123\"}" | jqr "str('token' in d)")"
check "a wrong code is refused" 422 "$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/auth/2fa/confirm "${AT[@]}" "${J[@]}" -d '{"code":"000000"}')"
check "gibberish is refused, not a 500" 422 "$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/auth/2fa/confirm "${AT[@]}" "${J[@]}" -d '{"code":"not-a-code"}')"
CODES=$(curl -s -X POST $BASE/api/auth/2fa/confirm "${AT[@]}" "${J[@]}" -d "{\"code\":\"$(totp "$SECRET")\"}")
check "a real code turns it on" 8 "$(echo "$CODES" | jqr "len(d['recovery_codes'])")"
check "and it's on the account now" "True" "$(curl -s $BASE/api/auth/me "${AT[@]}" -H 'Accept: application/json' | jqr "str(d['has_two_factor'])")"
check "the secret is never served back" "True" "$(curl -s $BASE/api/auth/me "${AT[@]}" -H 'Accept: application/json' | jqr "str(not any('two_factor_secret' in k or 'recovery' in k for k in d))")"

LOGIN=$(curl -s -X POST $BASE/api/auth/login "${J[@]}" -d "{\"email\":\"tfa$S@example.com\",\"password\":\"password123\"}")
check "the password alone now buys a challenge, not a token" "True" "$(echo "$LOGIN" | jqr "str(d.get('two_factor') is True and 'token' not in d)")"
CHAL=$(echo "$LOGIN" | jqr "d['challenge']")
check "a wrong code doesn't complete it" 422 "$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/auth/2fa/challenge "${J[@]}" -d "{\"challenge\":\"$CHAL\",\"code\":\"000000\"}")"
USED=$(totp "$SECRET")
TOK2FA=$(curl -s -X POST $BASE/api/auth/2fa/challenge "${J[@]}" -d "{\"challenge\":\"$CHAL\",\"code\":\"$USED\"}" | jqr "d['token']")
check "the right one does" 200 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/auth/me -H "Authorization: Bearer $TOK2FA" -H 'Accept: application/json')"
check "and the challenge is single-use" 422 "$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/auth/2fa/challenge "${J[@]}" -d "{\"challenge\":\"$CHAL\",\"code\":\"$(totp "$SECRET")\"}")"
# The replay guard: a code stays valid for a whole timestep, so without
# it one observed code works again for up to 90 seconds.
CHAL2=$(curl -s -X POST $BASE/api/auth/login "${J[@]}" -d "{\"email\":\"tfa$S@example.com\",\"password\":\"password123\"}" | jqr "d['challenge']")
check "a code already used can't be replayed" 422 "$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/auth/2fa/challenge "${J[@]}" -d "{\"challenge\":\"$CHAL2\",\"code\":\"$USED\"}")"
check "a code from long ago is refused" 422 "$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/auth/2fa/challenge "${J[@]}" -d "{\"challenge\":\"$CHAL2\",\"code\":\"$(totp "$SECRET" -10)\"}")"
RECOVERY=$(echo "$CODES" | jqr "d['recovery_codes'][0]")
check "a recovery code works instead" 200 "$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/auth/2fa/challenge "${J[@]}" -d "{\"challenge\":\"$CHAL2\",\"code\":\"$RECOVERY\"}")"
CHAL3=$(curl -s -X POST $BASE/api/auth/login "${J[@]}" -d "{\"email\":\"tfa$S@example.com\",\"password\":\"password123\"}" | jqr "d['challenge']")
check "but only once" 422 "$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/auth/2fa/challenge "${J[@]}" -d "{\"challenge\":\"$CHAL3\",\"code\":\"$RECOVERY\"}")"
# Five wrong codes and the challenge is void — otherwise six digits is a
# million tries with one password entry.
for i in $(seq 1 5); do curl -s -o /dev/null -X POST $BASE/api/auth/2fa/challenge "${J[@]}" -d "{\"challenge\":\"$CHAL3\",\"code\":\"00000$i\"}"; done
check "a challenge gives up after enough wrong codes" 422 "$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/auth/2fa/challenge "${J[@]}" -d "{\"challenge\":\"$CHAL3\",\"code\":\"$(totp "$SECRET")\"}")"
check "an unknown challenge is refused" 422 "$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/auth/2fa/challenge "${J[@]}" -d "{\"challenge\":\"made-up\",\"code\":\"$(totp "$SECRET")\"}")"

check "turning it off needs the password" 422 "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE $BASE/api/auth/2fa -H "Authorization: Bearer $TOK2FA" "${J[@]}" -d '{"password":"wrongpassword1"}')"
check "regenerating replaces the old codes" "True" "$(curl -s -X POST $BASE/api/auth/2fa/recovery-codes -H "Authorization: Bearer $TOK2FA" "${J[@]}" -d '{"password":"password123"}' | jqr "str(len(d['recovery_codes']) == 8 and '$RECOVERY' not in d['recovery_codes'])")"
check "turning it off works with it" 200 "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE $BASE/api/auth/2fa -H "Authorization: Bearer $TOK2FA" "${J[@]}" -d '{"password":"password123"}')"
check "and the password alone signs in again" "True" "$(curl -s -X POST $BASE/api/auth/login "${J[@]}" -d "{\"email\":\"tfa$S@example.com\",\"password\":\"password123\"}" | jqr "str('token' in d)")"

echo "== taking your data with you, and closing the account =="
DA=$(curl -s -X POST $BASE/api/auth/register "${J[@]}" -d "{\"name\":\"Lea Ving\",\"email\":\"leave$S@example.com\",\"password\":\"password123\"}")
TOKD=$(echo "$DA" | jqr "d['token']"); DUSER=$(echo "$DA" | jqr "d['user']['username']")
AD=(-H "Authorization: Bearer $TOKD")
DESIGN='{"schemaVersion":1,"id":"x","name":"n","size":{"widthMm":69,"heightMm":94,"cutWidthMm":63,"cutHeightMm":88,"safeWidthMm":57,"safeHeightMm":82},"layers":[],"groups":[],"backgroundColor":"#fff","sourceCardDesignId":null}'
DID=$(python3 -c "import uuid;print(uuid.uuid4())")
curl -s -o /dev/null -X PUT $BASE/api/card-designs/$DID "${AD[@]}" "${J[@]}" -d "{\"name\":\"Keepsake $S\",\"design\":$DESIGN}"
curl -s -o /tmp/export.json -D /tmp/export.headers $BASE/api/account/export "${AD[@]}" -H 'Accept: application/json'
check "the export includes the account" "leave$S@example.com" "$(cat /tmp/export.json | jqr "d['account']['email']")"
check "and the designs it owns" "Keepsake $S" "$(cat /tmp/export.json | jqr "d['designs'][0]['name']")"
check "with the design blob itself, not a summary" "True" "$(cat /tmp/export.json | jqr "str('layers' in d['designs'][0]['design'])")"
check "every section is present" "True" "$(cat /tmp/export.json | jqr "str({'templates','collections','posts','comments','reactions','point_events','badges','reports_you_filed','appeals','moderation_actions_about_you'} <= set(d))")"
check "it downloads as a file" "True" "$(grep -qi 'content-disposition: attachment' /tmp/export.headers && echo True || echo False)"
check "and needs an account" 401 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/account/export -H 'Accept: application/json')"
check "deleting needs the password" 422 "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE $BASE/api/account "${AD[@]}" "${J[@]}" -d '{}')"
check "and the right one" 422 "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE $BASE/api/account "${AD[@]}" "${J[@]}" -d '{"password":"notmypassword1"}')"
check "the account still exists after a wrong guess" 200 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/auth/me "${AD[@]}" -H 'Accept: application/json')"
check "deleting works with it" 200 "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE $BASE/api/account "${AD[@]}" "${J[@]}" -d '{"password":"password123"}')"
check "the token dies with the account" 401 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/auth/me "${AD[@]}" -H 'Accept: application/json')"
check "the profile is gone" 404 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/users/$DUSER -H 'Accept: application/json')"
check "signing in again is impossible" 422 "$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/auth/login "${J[@]}" -d "{\"email\":\"leave$S@example.com\",\"password\":\"password123\"}")"
check "and their designs went with them" 0 "$("$ARTISAN" tinker --execute="echo App\Models\CardDesign::where('name','Keepsake $S')->count();" | tail -1)"
check "the address can be reused" 201 "$(reg "leave$S" "password123")"

echo
echo "== $pass passed, $fail failed =="
[ "$fail" -eq 0 ]
