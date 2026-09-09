#!/usr/bin/env bash
# End-to-end curl exercise of GET /api/search — the global search bar's
# one endpoint, fanning out across published templates, published guides,
# and (authenticated only) the requester's own card-design library.
set -u
BASE="${E2E_API_URL:-http://127.0.0.1:8000}"
pass=0; fail=0
check() { # check <label> <expected> <actual>
  if [ "$2" = "$3" ]; then echo "  PASS  $1 ($3)"; pass=$((pass+1));
  else echo "  FAIL  $1 — expected $2, got $3"; fail=$((fail+1)); fi
}
jqr() { python3 -c "import sys,json;d=json.load(sys.stdin);print(eval(sys.argv[1]))" "$1"; }
J=(-H 'Content-Type: application/json' -H 'Accept: application/json')
uuid() { python3 -c "import uuid;print(uuid.uuid4())"; }

STAMP=$(date +%s)
# A term unique to this run, so a shared dev/e2e database's leftovers from
# other suites can never match it — see tests/e2e/README.md's "assert
# shapes, not counts of shared state", the same reasoning applied to a
# search term instead of a row count.
TERM="Zorbquartz$STAMP"

echo "== register two accounts =="
A=$(curl -s -X POST $BASE/api/auth/register "${J[@]}" -d "{\"name\":\"Sia Searcher\",\"email\":\"sia$STAMP@example.com\",\"password\":\"password123\"}")
TOKA=$(echo "$A" | jqr "d['token']")
B=$(curl -s -X POST $BASE/api/auth/register "${J[@]}" -d "{\"name\":\"Bo Bystander\",\"email\":\"bo$STAMP@example.com\",\"password\":\"password123\"}")
TOKB=$(echo "$B" | jqr "d['token']")
AA=(-H "Authorization: Bearer $TOKA"); AB=(-H "Authorization: Bearer $TOKB")
[ -n "$TOKA" ] && [ -n "$TOKB" ] && echo "  ok: got tokens"

DESIGN=$(cat <<JSON
{"schemaVersion":1,"id":"$(uuid)","name":"$TERM layout","size":{"widthMm":69,"heightMm":94,"cutWidthMm":63,"cutHeightMm":88,"safeWidthMm":57,"safeHeightMm":82},"backgroundColor":"#ffffff","groups":[],"sourceCardDesignId":null,
"layers":[
 {"id":"chrome-frame","name":"Frame","type":"frame","assetId":"generic/plain","x":0,"y":0,"width":69,"height":94,"rotationDeg":0,"opacity":1,"visible":true,"locked":true,"contentLocked":true}
]}
JSON
)

echo "== seed: a published template matching the term =="
TID=$(uuid)
CODE=$(curl -s -o /tmp/search_t.json -w '%{http_code}' -X PUT $BASE/api/templates/$TID "${AA[@]}" "${J[@]}" \
  -d "{\"name\":\"$TERM Frame\",\"description\":\"a template\",\"design\":$DESIGN}")
check "template created" 201 "$CODE"
curl -s -o /dev/null -X POST $BASE/api/templates/$TID/publish "${AA[@]}" "${J[@]}" -d '{"visibility":"published"}'

echo "== seed: a private template matching the term (must never surface) =="
TID_PRIVATE=$(uuid)
curl -s -o /dev/null -X PUT $BASE/api/templates/$TID_PRIVATE "${AA[@]}" "${J[@]}" \
  -d "{\"name\":\"$TERM Hidden\",\"design\":$DESIGN}"

echo "== seed: a published guide matching the term =="
PID=$(uuid)
curl -s -o /dev/null -X PUT $BASE/api/posts/$PID "${AA[@]}" "${J[@]}" \
  -d "{\"title\":\"$TERM tips\",\"body\":\"How to work with $TERM stock.\",\"category\":\"materials\"}"
curl -s -o /dev/null -X POST $BASE/api/posts/$PID/publish "${AA[@]}" "${J[@]}" -d '{"visibility":"published"}'

echo "== seed: A's own card design matching the term =="
DID=$(uuid)
curl -s -o /dev/null -X PUT $BASE/api/card-designs/$DID "${AA[@]}" "${J[@]}" \
  -d "{\"name\":\"$TERM design\",\"design\":$DESIGN}"

echo "== seed: B's own card design, same term — must never appear in A's results =="
DID_B=$(uuid)
curl -s -o /dev/null -X PUT $BASE/api/card-designs/$DID_B "${AB[@]}" "${J[@]}" \
  -d "{\"name\":\"$TERM design owned by bo\",\"design\":$DESIGN}"

echo "== guest search =="
GUEST=$(curl -s "$BASE/api/search?q=$TERM" -H 'Accept: application/json')
check "guest: finds the published template" 1 "$(echo "$GUEST" | jqr "len([t for t in d['templates'] if t['id']=='$TID'])")"
check "guest: template shape has id+name" "True" "$(echo "$GUEST" | jqr "'id' in d['templates'][0] and d['templates'][0]['name'].startswith('$TERM')")"
check "guest: private template never surfaces" 0 "$(echo "$GUEST" | jqr "len([t for t in d['templates'] if t['id']=='$TID_PRIVATE'])")"
check "guest: finds the published guide" 1 "$(echo "$GUEST" | jqr "len([g for g in d['guides'] if g['id']=='$PID'])")"
check "guest: guide shape has title+slug" "True" "$(echo "$GUEST" | jqr "'title' in d['guides'][0] and 'slug' in d['guides'][0]")"
check "guest: designs key is empty" 0 "$(echo "$GUEST" | jqr "len(d['designs'])")"

echo "== authenticated search (A) =="
SA=$(curl -s "$BASE/api/search?q=$TERM" "${AA[@]}" -H 'Accept: application/json')
check "A: still finds the published template" 1 "$(echo "$SA" | jqr "len([t for t in d['templates'] if t['id']=='$TID'])")"
check "A: still finds the published guide" 1 "$(echo "$SA" | jqr "len([g for g in d['guides'] if g['id']=='$PID'])")"
check "A: finds her own design" 1 "$(echo "$SA" | jqr "len([c for c in d['designs'] if c['id']=='$DID'])")"
check "A: design shape has id+name" "$TERM design" "$(echo "$SA" | jqr "[c for c in d['designs'] if c['id']=='$DID'][0]['name']")"
check "A: does NOT see Bo's design" 0 "$(echo "$SA" | jqr "len([c for c in d['designs'] if c['id']=='$DID_B'])")"
check "A: her private template still never surfaces" 0 "$(echo "$SA" | jqr "len([t for t in d['templates'] if t['id']=='$TID_PRIVATE'])")"

echo "== authenticated search (Bo) — cross-account isolation =="
SB=$(curl -s "$BASE/api/search?q=$TERM" "${AB[@]}" -H 'Accept: application/json')
check "Bo: sees the same public template" 1 "$(echo "$SB" | jqr "len([t for t in d['templates'] if t['id']=='$TID'])")"
check "Bo: finds his own design" 1 "$(echo "$SB" | jqr "len([c for c in d['designs'] if c['id']=='$DID_B'])")"
check "Bo: does NOT see A's design" 0 "$(echo "$SB" | jqr "len([c for c in d['designs'] if c['id']=='$DID'])")"

echo "== empty query =="
EMPTY=$(curl -s "$BASE/api/search?q=" -H 'Accept: application/json')
check "empty q: templates empty" 0 "$(echo "$EMPTY" | jqr "len(d['templates'])")"
check "empty q: guides empty" 0 "$(echo "$EMPTY" | jqr "len(d['guides'])")"
check "empty q: designs empty" 0 "$(echo "$EMPTY" | jqr "len(d['designs'])")"
check "empty q: 200s, not an error" 200 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/search?q=" -H 'Accept: application/json')"

echo "== missing query param entirely =="
NOQ=$(curl -s "$BASE/api/search" -H 'Accept: application/json')
check "no q param: 200s" 200 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/search" -H 'Accept: application/json')"
check "no q param: all empty" "[0, 0, 0]" "$(echo "$NOQ" | jqr "[len(d['templates']), len(d['guides']), len(d['designs'])]")"

echo "== no-match query =="
NOMATCH=$(curl -s "$BASE/api/search?q=zzz-nothing-matches-this-$STAMP" "${AA[@]}" -H 'Accept: application/json')
check "no match: 200s, not a 404" 200 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/search?q=zzz-nothing-matches-this-$STAMP" "${AA[@]}" -H 'Accept: application/json')"
check "no match: all empty arrays" "[0, 0, 0]" "$(echo "$NOMATCH" | jqr "[len(d['templates']), len(d['guides']), len(d['designs'])]")"

echo "== cap: at most 8 results per type =="
# Publish 9 more templates matching the term; the cap must still hold.
for i in $(seq 1 9); do
  TX=$(uuid)
  curl -s -o /dev/null -X PUT $BASE/api/templates/$TX "${AA[@]}" "${J[@]}" -d "{\"name\":\"$TERM extra $i\",\"design\":$DESIGN}"
  curl -s -o /dev/null -X POST $BASE/api/templates/$TX/publish "${AA[@]}" "${J[@]}" -d '{"visibility":"published"}'
done
check "template results capped at 8" 8 "$(curl -s "$BASE/api/search?q=$TERM" -H 'Accept: application/json' | jqr "len(d['templates'])")"

echo
echo "== $pass passed, $fail failed =="
[ "$fail" -eq 0 ]
