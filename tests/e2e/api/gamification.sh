#!/usr/bin/env bash
# Phase 4: reactions, the points ledger, levels, badges, featuring.
set -u
BASE="${E2E_API_URL:-http://127.0.0.1:8000}"
pass=0; fail=0
check() { if [ "$2" = "$3" ]; then echo "  PASS  $1 ($3)"; pass=$((pass+1)); else echo "  FAIL  $1 — expected $2, got $3"; fail=$((fail+1)); fi; }
jqr() { python3 -c "import sys,json;d=json.load(sys.stdin);print(eval(sys.argv[1]))" "$1"; }
J=(-H 'Content-Type: application/json' -H 'Accept: application/json')
uuid() { python3 -c "import uuid;print(uuid.uuid4())"; }
S=$(date +%s)

A=$(curl -s -X POST $BASE/api/auth/register "${J[@]}" -d "{\"name\":\"Gil Maker\",\"email\":\"gil$S@example.com\",\"password\":\"password123\"}")
TOKA=$(echo "$A" | jqr "d['token']"); UA=$(echo "$A" | jqr "d['user']['username']")
TOKB=$(curl -s -X POST $BASE/api/auth/register "${J[@]}" -d "{\"name\":\"Fan Person\",\"email\":\"fan$S@example.com\",\"password\":\"password123\"}" | jqr "d['token']")
TOKC=$(curl -s -X POST $BASE/api/auth/register "${J[@]}" -d "{\"name\":\"Third Wheel\",\"email\":\"third$S@example.com\",\"password\":\"password123\"}" | jqr "d['token']")
AA=(-H "Authorization: Bearer $TOKA"); AB=(-H "Authorization: Bearer $TOKB"); AC=(-H "Authorization: Bearer $TOKC")
DESIGN='{"schemaVersion":1,"id":"x","name":"n","size":{"widthMm":69,"heightMm":94,"cutWidthMm":63,"cutHeightMm":88,"safeWidthMm":57,"safeHeightMm":82},"layers":[],"groups":[],"backgroundColor":"#fff","sourceCardDesignId":null}'
stats() { curl -s $BASE/api/users/$UA -H 'Accept: application/json' | jqr "d['stats']['$1']"; }

echo "== the badge catalog is public =="
# Asserting the shape, not a count — every phase that adds a badge would
# otherwise break this.
check "catalog is readable signed out" "True" "$(curl -s $BASE/api/badges -H 'Accept: application/json' | jqr "len(d) >= 6")"
check "and includes the seeded rule-based badges" "True" "$(curl -s $BASE/api/badges -H 'Accept: application/json' | jqr "{'first-template','first-collection','well-liked'} <= {b['id'] for b in d}")"
check "both automatic and manual badges exist" "True" "$(curl -s $BASE/api/badges -H 'Accept: application/json' | jqr "any(b['automatic'] for b in d) and any(not b['automatic'] for b in d)")"

echo "== a new account starts at level 1 with nothing =="
check "zero points" 0 "$(stats points)"
check "level 1" 1 "$(stats level)"
check "level has a name" "Newcomer" "$(stats level_name)"
check "and a next threshold" 25 "$(stats next_level_at)"
check "no badges" 0 "$(curl -s $BASE/api/users/$UA -H 'Accept: application/json' | jqr "len(d['badges'])")"

echo "== publishing awards points, exactly once =="
TID=$(uuid)
curl -s -o /dev/null -X PUT $BASE/api/templates/$TID "${AA[@]}" "${J[@]}" -d "{\"name\":\"Gil's layout\",\"design\":$DESIGN}"
check "an unpublished template awards nothing" 0 "$(stats points)"
curl -s -o /dev/null -X POST $BASE/api/templates/$TID/publish "${AA[@]}" "${J[@]}" -d '{"visibility":"published"}'
check "publishing awards 10" 10 "$(stats points)"
curl -s -o /dev/null -X POST $BASE/api/templates/$TID/publish "${AA[@]}" "${J[@]}" -d '{"visibility":"private"}'
curl -s -o /dev/null -X POST $BASE/api/templates/$TID/publish "${AA[@]}" "${J[@]}" -d '{"visibility":"published"}'
check "unpublish/republish can't farm it" 10 "$(stats points)"
check "publishing earned the Template Author badge" "True" "$(curl -s $BASE/api/users/$UA -H 'Accept: application/json' | jqr "any(b['id']=='first-template' for b in d['badges'])")"

echo "== reactions =="
R=$(curl -s -X POST $BASE/api/reactions "${AB[@]}" "${J[@]}" -d "{\"type\":\"template\",\"id\":\"$TID\"}")
check "toggling on reports reacted" "True" "$(echo "$R" | jqr "d['reacted']")"
check "and a count of 1" 1 "$(echo "$R" | jqr "d['reaction_count']")"
check "the owner gained a point" 11 "$(stats points)"
R=$(curl -s -X POST $BASE/api/reactions "${AB[@]}" "${J[@]}" -d "{\"type\":\"template\",\"id\":\"$TID\"}")
check "toggling off reports un-reacted" "False" "$(echo "$R" | jqr "d['reacted']")"
check "count back to 0" 0 "$(echo "$R" | jqr "d['reaction_count']")"
check "points are NOT taken back" 11 "$(stats points)"
curl -s -o /dev/null -X POST $BASE/api/reactions "${AB[@]}" "${J[@]}" -d "{\"type\":\"template\",\"id\":\"$TID\"}"
check "re-reacting doesn't re-award" 11 "$(stats points)"
check "a second person's reaction does" 12 "$(curl -s -o /dev/null -X POST $BASE/api/reactions "${AC[@]}" "${J[@]}" -d "{\"type\":\"template\",\"id\":\"$TID\"}"; stats points)"
check "liking your own work awards nothing" 12 "$(curl -s -o /dev/null -X POST $BASE/api/reactions "${AA[@]}" "${J[@]}" -d "{\"type\":\"template\",\"id\":\"$TID\"}"; stats points)"
check "but still counts as a reaction" 3 "$(curl -s $BASE/api/templates/$TID -H 'Accept: application/json' | jqr "d['reaction_count']")"
check "anonymous reaction 401s" 401 "$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/reactions "${J[@]}" -d "{\"type\":\"template\",\"id\":\"$TID\"}")"
check "bad type 422s" 422 "$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/reactions "${AB[@]}" "${J[@]}" -d "{\"type\":\"planet\",\"id\":\"$TID\"}")"

echo "== you can't react to what you can't see =="
PRIV=$(uuid)
curl -s -o /dev/null -X PUT $BASE/api/card-designs/$PRIV "${AA[@]}" "${J[@]}" -d "{\"name\":\"Private\",\"design\":$DESIGN}"
check "a stranger can't react to a private design" 404 "$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/reactions "${AB[@]}" "${J[@]}" -d "{\"type\":\"design\",\"id\":\"$PRIV\"}")"
check "the owner can" 200 "$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/reactions "${AA[@]}" "${J[@]}" -d "{\"type\":\"design\",\"id\":\"$PRIV\"}")"

echo "== the same endpoint works for every type =="
CID=$(uuid)
curl -s -o /dev/null -X PUT $BASE/api/collections/$CID "${AA[@]}" "${J[@]}" -d '{"name":"Gil binder"}'
curl -s -o /dev/null -X POST $BASE/api/collections/$CID/publish "${AA[@]}" "${J[@]}" -d '{"visibility":"published"}'
check "collections are reactable" 1 "$(curl -s -X POST $BASE/api/reactions "${AB[@]}" "${J[@]}" -d "{\"type\":\"collection\",\"id\":\"$CID\"}" | jqr "d['reaction_count']")"
DID=$(uuid)
curl -s -o /dev/null -X PUT $BASE/api/card-designs/$DID "${AA[@]}" "${J[@]}" -d "{\"name\":\"Gil card\",\"design\":$DESIGN}"
curl -s -o /dev/null -X POST $BASE/api/card-designs/$DID/publish "${AA[@]}" "${J[@]}" -d '{"visibility":"published"}'
check "designs are reactable" 1 "$(curl -s -X POST $BASE/api/reactions "${AB[@]}" "${J[@]}" -d "{\"type\":\"design\",\"id\":\"$DID\"}" | jqr "d['reaction_count']")"
check "earned the Curator badge for the collection" "True" "$(curl -s $BASE/api/users/$UA -H 'Accept: application/json' | jqr "any(b['id']=='first-collection' for b in d['badges'])")"

echo "== template use awards the author, once per user =="
BEFORE=$(stats points)
curl -s -o /dev/null -X POST $BASE/api/templates/$TID/use -H 'Accept: application/json'
check "an anonymous use awards nothing" "$BEFORE" "$(stats points)"
curl -s -o /dev/null -X POST $BASE/api/templates/$TID/use "${AB[@]}" -H 'Accept: application/json'
check "a signed-in use awards 2" "$((BEFORE + 2))" "$(stats points)"
curl -s -o /dev/null -X POST $BASE/api/templates/$TID/use "${AB[@]}" -H 'Accept: application/json'
check "the same person using it again doesn't" "$((BEFORE + 2))" "$(stats points)"

echo "== levels are a pure function of the ledger =="
# 23 points at this point: 10 published + 5 collection + 2 design + 4
# reactions + 2 use. Level 2 starts at 25, so this is still level 1 —
# the boundary is what's worth testing, not a fixed number.
check "below the threshold, still level 1" 1 "$(stats level)"
check "points_to_next is the gap" "True" "$(curl -s $BASE/api/users/$UA -H 'Accept: application/json' | jqr "d['stats']['points_to_next'] == d['stats']['next_level_at'] - d['stats']['points']")"
# Two more reactions from the third account cross 25.
curl -s -o /dev/null -X POST $BASE/api/reactions "${AC[@]}" "${J[@]}" -d "{\"type\":\"collection\",\"id\":\"$CID\"}"
curl -s -o /dev/null -X POST $BASE/api/reactions "${AC[@]}" "${J[@]}" -d "{\"type\":\"design\",\"id\":\"$DID\"}"
check "crossing the threshold levels up" 2 "$(stats level)"
check "and the level name follows the table" "Maker" "$(stats level_name)"
check "the level-three badge isn't awarded yet" "False" "$(curl -s $BASE/api/users/$UA -H 'Accept: application/json' | jqr "any(b['id']=='level-three' for b in d['badges'])")"

echo "== featuring =="
check "feature a published template" 200 "$(curl -s -o /tmp/f.json -w '%{http_code}' -X POST $BASE/api/featured "${AA[@]}" "${J[@]}" -d "{\"type\":\"template\",\"id\":\"$TID\",\"featured\":true}")"
check "it reports featured" "True" "$(cat /tmp/f.json | jqr "d['featured']")"
check "it shows on the profile's shelf" 1 "$(curl -s $BASE/api/users/$UA -H 'Accept: application/json' | jqr "len(d['featured'])")"
check "the shelf row says what type it is" "template" "$(curl -s $BASE/api/users/$UA -H 'Accept: application/json' | jqr "d['featured'][0]['type']")"
check "you can't feature someone else's" 404 "$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/featured "${AB[@]}" "${J[@]}" -d "{\"type\":\"template\",\"id\":\"$TID\",\"featured\":true}")"
# A fresh account with its own published template: 10 points, level 1,
# so the refusal is the level gate rather than the ownership check.
TOKD=$(curl -s -X POST $BASE/api/auth/register "${J[@]}" -d "{\"name\":\"New Bee\",\"email\":\"bee$S@example.com\",\"password\":\"password123\"}" | jqr "d['token']")
AD=(-H "Authorization: Bearer $TOKD"); TID2=$(uuid)
curl -s -o /dev/null -X PUT $BASE/api/templates/$TID2 "${AD[@]}" "${J[@]}" -d "{\"name\":\"Bee layout\",\"visibility\":\"published\",\"design\":$DESIGN}"
check "a level-1 account is refused its own content" 403 "$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/featured "${AD[@]}" "${J[@]}" -d "{\"type\":\"template\",\"id\":\"$TID2\",\"featured\":true}")"
check "and the refusal explains the gate" "True" "$(curl -s -X POST $BASE/api/featured "${AD[@]}" "${J[@]}" -d "{\"type\":\"template\",\"id\":\"$TID2\",\"featured\":true}" | jqr "'level 2' in d['message']")"
check "un-featuring works" "False" "$(curl -s -X POST $BASE/api/featured "${AA[@]}" "${J[@]}" -d "{\"type\":\"template\",\"id\":\"$TID\",\"featured\":false}" | jqr "d['featured']")"
check "and clears the shelf" 0 "$(curl -s $BASE/api/users/$UA -H 'Accept: application/json' | jqr "len(d['featured'])")"

echo "== reaction state travels with listings =="
check "browse rows carry a count" "True" "$(curl -s $BASE/api/templates/browse -H 'Accept: application/json' | jqr "'reaction_count' in [t for t in d if t['id']=='$TID'][0]")"
check "and whether the viewer reacted" "True" "$(curl -s $BASE/api/templates/browse "${AB[@]}" -H 'Accept: application/json' | jqr "[t for t in d if t['id']=='$TID'][0]['reacted']")"
check "signed out, reacted is false" "False" "$(curl -s $BASE/api/templates/browse -H 'Accept: application/json' | jqr "[t for t in d if t['id']=='$TID'][0]['reacted']")"
check "sort=popular still works with counts" 200 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/templates/browse?sort=popular" -H 'Accept: application/json')"

echo "== the ledger is auditable =="
check "reactions_received is reported" "True" "$(curl -s $BASE/api/users/$UA -H 'Accept: application/json' | jqr "d['stats']['reactions_received'] >= 3")"

echo
echo "== $pass passed, $fail failed =="
[ "$fail" -eq 0 ]
