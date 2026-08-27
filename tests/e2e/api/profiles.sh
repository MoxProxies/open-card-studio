#!/usr/bin/env bash
# Phase 2: profiles, visibility on designs, and the report path.
set -u
BASE="${E2E_API_URL:-http://127.0.0.1:8000}"
pass=0; fail=0
check() { if [ "$2" = "$3" ]; then echo "  PASS  $1 ($3)"; pass=$((pass+1)); else echo "  FAIL  $1 — expected $2, got $3"; fail=$((fail+1)); fi; }
jqr() { python3 -c "import sys,json;d=json.load(sys.stdin);print(eval(sys.argv[1]))" "$1"; }
J=(-H 'Content-Type: application/json' -H 'Accept: application/json')
S=$(date +%s)

echo "== registration assigns a username =="
A=$(curl -s -X POST $BASE/api/auth/register "${J[@]}" -d "{\"name\":\"Ada Lovelace\",\"email\":\"ada$S@example.com\",\"password\":\"password123\"}")
TOKA=$(echo "$A" | jqr "d['token']"); UA=$(echo "$A" | jqr "d['user']['username']")
matches() { [[ "$1" =~ $2 ]] && echo true || echo false; }
check "username generated from the display name" "true" "$(matches "$UA" '^ada-lovelace(-[0-9]+)?$')"
check "own account still sees its email" "ada$S@example.com" "$(echo "$A" | jqr "d['user']['email']")"

A2=$(curl -s -X POST $BASE/api/auth/register "${J[@]}" -d "{\"name\":\"Ada Lovelace\",\"email\":\"ada2$S@example.com\",\"password\":\"password123\"}")
TOKB=$(echo "$A2" | jqr "d['token']")
UB=$(echo "$A2" | jqr "d['user']['username']")
check "a colliding name gets a suffixed handle" "true" "$(matches "$UB" '^ada-lovelace-[0-9]+$')"
check "and it differs from the first" "true" "$([ "$UB" != "$UA" ] && echo true || echo false)"

echo "== editing your profile =="
U="ada-$S"
P=$(curl -s -X PATCH $BASE/api/profile -H "Authorization: Bearer $TOKA" "${J[@]}" \
  -d "{\"username\":\"$U\",\"bio\":\"I make card layouts.\",\"avatar_url\":\"https://example.com/a.png\"}")
check "username updated" "$U" "$(echo "$P" | jqr "d['username']")"
check "bio updated" "I make card layouts." "$(echo "$P" | jqr "d['bio']")"
check "reserved username rejected" 422 "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH $BASE/api/profile -H "Authorization: Bearer $TOKA" "${J[@]}" -d '{"username":"admin"}')"
check "uppercase username rejected" 422 "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH $BASE/api/profile -H "Authorization: Bearer $TOKA" "${J[@]}" -d '{"username":"NotLower"}')"
check "taken username rejected" 422 "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH $BASE/api/profile -H "Authorization: Bearer $TOKB" "${J[@]}" -d "{\"username\":\"$U\"}")"
check "http avatar rejected" 422 "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH $BASE/api/profile -H "Authorization: Bearer $TOKA" "${J[@]}" -d '{"avatar_url":"http://example.com/a.png"}')"
check "unauthenticated PATCH 401s" 401 "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH $BASE/api/profile "${J[@]}" -d '{"bio":"x"}')"

echo "== the public profile =="
PROF=$(curl -s $BASE/api/users/$U -H 'Accept: application/json')
check "profile is public (no token)" "$U" "$(echo "$PROF" | jqr "d['profile']['username']")"
check "profile never exposes the email" "False" "$(echo "$PROF" | jqr "'email' in d['profile']")"
check "unknown username 404s" 404 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/users/nobody-$S -H 'Accept: application/json')"
check "starts with nothing published" "[0, 0]" "$(echo "$PROF" | jqr "[len(d['templates']), len(d['designs'])]")"

echo "== only published content reaches a profile =="
DESIGN='{"schemaVersion":1,"id":"x","name":"n","size":{"widthMm":69,"heightMm":94,"cutWidthMm":63,"cutHeightMm":88,"safeWidthMm":57,"safeHeightMm":82},"layers":[],"groups":[],"backgroundColor":"#fff","sourceCardDesignId":null}'
DID=$(python3 -c "import uuid;print(uuid.uuid4())"); TID=$(python3 -c "import uuid;print(uuid.uuid4())")
curl -s -o /dev/null -X PUT $BASE/api/card-designs/$DID -H "Authorization: Bearer $TOKA" "${J[@]}" -d "{\"name\":\"Private sketch\",\"design\":$DESIGN}"
curl -s -o /dev/null -X PUT $BASE/api/templates/$TID -H "Authorization: Bearer $TOKA" "${J[@]}" -d "{\"name\":\"Draft layout\",\"design\":$DESIGN}"
check "private design stays off the profile" "[0, 0]" "$(curl -s $BASE/api/users/$U -H 'Accept: application/json' | jqr "[len(d['templates']), len(d['designs'])]")"

check "design publish endpoint 200s" 200 "$(curl -s -o /tmp/p.json -w '%{http_code}' -X POST $BASE/api/card-designs/$DID/publish -H "Authorization: Bearer $TOKA" "${J[@]}" -d '{"visibility":"published"}')"
check "publish returns the summary" "published" "$(cat /tmp/p.json | jqr "d['visibility']")"
curl -s -o /dev/null -X POST $BASE/api/templates/$TID/publish -H "Authorization: Bearer $TOKA" "${J[@]}" -d '{"visibility":"published"}'
PROF=$(curl -s $BASE/api/users/$U -H 'Accept: application/json')
check "published design and template both appear" "[1, 1]" "$(echo "$PROF" | jqr "[len(d['templates']), len(d['designs'])]")"
check "profile design rows omit the design blob" "False" "$(echo "$PROF" | jqr "any('design' in x for x in d['designs'])")"
check "old 'public' visibility value is rejected" 422 "$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/card-designs/$DID/publish -H "Authorization: Bearer $TOKA" "${J[@]}" -d '{"visibility":"public"}')"
check "someone else can't publish your design" 404 "$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/card-designs/$DID/publish -H "Authorization: Bearer $TOKB" "${J[@]}" -d '{"visibility":"private"}')"

echo "== unlisted is reachable but unlisted =="
curl -s -o /dev/null -X POST $BASE/api/templates/$TID/publish -H "Authorization: Bearer $TOKA" "${J[@]}" -d '{"visibility":"unlisted"}'
check "unlisted template drops off the profile" 0 "$(curl -s $BASE/api/users/$U -H 'Accept: application/json' | jqr "len(d['templates'])")"
check "but is still fetchable by id" 200 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/templates/$TID -H 'Accept: application/json')"

echo "== template rows carry the author's handle =="
curl -s -o /dev/null -X POST $BASE/api/templates/$TID/publish -H "Authorization: Bearer $TOKA" "${J[@]}" -d '{"visibility":"published"}'
check "browse row links to a profile" "$U" "$(curl -s $BASE/api/templates/browse -H 'Accept: application/json' | jqr "[t for t in d if t['id']=='$TID'][0]['author']['username']")"

echo "== reports =="
check "report a template" 201 "$(curl -s -o /tmp/r.json -w '%{http_code}' -X POST $BASE/api/reports -H "Authorization: Bearer $TOKB" "${J[@]}" -d "{\"type\":\"template\",\"id\":\"$TID\",\"reason\":\"infringement\",\"details\":\"Looks like a licensed layout.\"}")"
check "report arrives open" "open" "$(cat /tmp/r.json | jqr "d['state']")"
R1=$(cat /tmp/r.json | jqr "d['id']")
R2=$(curl -s -X POST $BASE/api/reports -H "Authorization: Bearer $TOKB" "${J[@]}" -d "{\"type\":\"template\",\"id\":\"$TID\",\"reason\":\"spam\"}" | jqr "d['id']")
check "re-reporting updates, doesn't duplicate" "$R1" "$R2"
check "report a user" 201 "$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/reports -H "Authorization: Bearer $TOKB" "${J[@]}" -d "{\"type\":\"user\",\"id\":\"1\",\"reason\":\"impersonation\"}")"
check "unknown target 404s" 404 "$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/reports -H "Authorization: Bearer $TOKB" "${J[@]}" -d '{"type":"template","id":"00000000-0000-0000-0000-000000000000","reason":"spam"}')"
check "bad reason 422s" 422 "$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/reports -H "Authorization: Bearer $TOKB" "${J[@]}" -d "{\"type\":\"template\",\"id\":\"$TID\",\"reason\":\"vibes\"}")"
check "bad type 422s" 422 "$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/reports -H "Authorization: Bearer $TOKB" "${J[@]}" -d "{\"type\":\"planet\",\"id\":\"$TID\",\"reason\":\"spam\"}")"
check "anonymous report 401s" 401 "$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/reports "${J[@]}" -d "{\"type\":\"template\",\"id\":\"$TID\",\"reason\":\"spam\"}")"

echo
echo "== $pass passed, $fail failed =="
[ "$fail" -eq 0 ]
