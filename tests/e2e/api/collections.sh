#!/usr/bin/env bash
# Phase 3: collections — ownership, membership, and the private-designs-in-
# a-public-collection rule.
set -u
BASE="${E2E_API_URL:-http://127.0.0.1:8000}"
pass=0; fail=0
check() { if [ "$2" = "$3" ]; then echo "  PASS  $1 ($3)"; pass=$((pass+1)); else echo "  FAIL  $1 — expected $2, got $3"; fail=$((fail+1)); fi; }
jqr() { python3 -c "import sys,json;d=json.load(sys.stdin);print(eval(sys.argv[1]))" "$1"; }
J=(-H 'Content-Type: application/json' -H 'Accept: application/json')
uuid() { python3 -c "import uuid;print(uuid.uuid4())"; }
S=$(date +%s)

A=$(curl -s -X POST $BASE/api/auth/register "${J[@]}" -d "{\"name\":\"Cora Binder\",\"email\":\"cora$S@example.com\",\"password\":\"password123\"}")
TOKA=$(echo "$A" | jqr "d['token']"); UA=$(echo "$A" | jqr "d['user']['username']")
TOKB=$(curl -s -X POST $BASE/api/auth/register "${J[@]}" -d "{\"name\":\"Otto Other\",\"email\":\"otto$S@example.com\",\"password\":\"password123\"}" | jqr "d['token']")
AUTHA=(-H "Authorization: Bearer $TOKA"); AUTHB=(-H "Authorization: Bearer $TOKB")

DESIGN='{"schemaVersion":1,"id":"x","name":"n","size":{"widthMm":69,"heightMm":94,"cutWidthMm":63,"cutHeightMm":88,"safeWidthMm":57,"safeHeightMm":82},"layers":[],"groups":[],"backgroundColor":"#fff","sourceCardDesignId":null}'
PUB=$(uuid); PRIV=$(uuid); FOREIGN=$(uuid); CID=$(uuid)
curl -s -o /dev/null -X PUT $BASE/api/card-designs/$PUB "${AUTHA[@]}" "${J[@]}" -d "{\"name\":\"Public card\",\"design\":$DESIGN}"
curl -s -o /dev/null -X POST $BASE/api/card-designs/$PUB/publish "${AUTHA[@]}" "${J[@]}" -d '{"visibility":"published"}'
curl -s -o /dev/null -X PUT $BASE/api/card-designs/$PRIV "${AUTHA[@]}" "${J[@]}" -d "{\"name\":\"Private card\",\"design\":$DESIGN}"
curl -s -o /dev/null -X PUT $BASE/api/card-designs/$FOREIGN "${AUTHB[@]}" "${J[@]}" -d "{\"name\":\"Otto's card\",\"design\":$DESIGN}"

echo "== create =="
check "create returns 201" 201 "$(curl -s -o /tmp/c.json -w '%{http_code}' -X PUT $BASE/api/collections/$CID "${AUTHA[@]}" "${J[@]}" -d '{"name":"My binder","description":"Favourites"}')"
check "starts private" "private" "$(cat /tmp/c.json | jqr "d['visibility']")"
check "starts empty" 0 "$(cat /tmp/c.json | jqr "d['design_count']")"
check "author attributed" "$UA" "$(cat /tmp/c.json | jqr "d['author']['username']")"
check "another account can't overwrite it" 409 "$(curl -s -o /dev/null -w '%{http_code}' -X PUT $BASE/api/collections/$CID "${AUTHB[@]}" "${J[@]}" -d '{"name":"stolen"}')"

echo "== membership =="
check "add own design" 200 "$(curl -s -o /tmp/c.json -w '%{http_code}' -X PUT $BASE/api/collections/$CID/designs/$PUB "${AUTHA[@]}" "${J[@]}" -d '{}')"
check "count is 1" 1 "$(cat /tmp/c.json | jqr "d['design_count']")"
curl -s -o /dev/null -X PUT $BASE/api/collections/$CID/designs/$PRIV "${AUTHA[@]}" "${J[@]}" -d '{}'
check "count is 2" 2 "$(curl -s $BASE/api/collections/$CID "${AUTHA[@]}" -H 'Accept: application/json' | jqr "d['design_count']")"
check "re-adding doesn't duplicate" 2 "$(curl -s -X PUT $BASE/api/collections/$CID/designs/$PUB "${AUTHA[@]}" "${J[@]}" -d '{}' | jqr "d['design_count']")"
check "can't file someone else's design" 404 "$(curl -s -o /dev/null -w '%{http_code}' -X PUT $BASE/api/collections/$CID/designs/$FOREIGN "${AUTHA[@]}" "${J[@]}" -d '{}')"
check "can't file into someone else's collection" 404 "$(curl -s -o /dev/null -w '%{http_code}' -X PUT $BASE/api/collections/$CID/designs/$FOREIGN "${AUTHB[@]}" "${J[@]}" -d '{}')"

echo "== visibility =="
check "private collection 404s for anon" 404 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/collections/$CID -H 'Accept: application/json')"
check "and for another account" 404 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/collections/$CID "${AUTHB[@]}" -H 'Accept: application/json')"
check "off the owner's public profile while private" 0 "$(curl -s $BASE/api/users/$UA -H 'Accept: application/json' | jqr "len(d['collections'])")"
curl -s -o /dev/null -X POST $BASE/api/collections/$CID/publish "${AUTHA[@]}" "${J[@]}" -d '{"visibility":"published"}'
check "published: anon can read it" 200 "$(curl -s -o /tmp/pub.json -w '%{http_code}' $BASE/api/collections/$CID -H 'Accept: application/json')"
check "and it's on the profile" 1 "$(curl -s $BASE/api/users/$UA -H 'Accept: application/json' | jqr "len(d['collections'])")"
# The collection holds one published and one private design. A visitor must
# not learn the private one exists, from the contents *or* the count.
check "profile row counts only what a visitor could open" 1 "$(curl -s $BASE/api/users/$UA -H 'Accept: application/json' | jqr "d['collections'][0]['design_count']")"
check "the owner's own listing still shows the true count" 2 "$(curl -s $BASE/api/collections "${AUTHA[@]}" -H 'Accept: application/json' | jqr "[c for c in d if c['id']=='$CID'][0]['design_count']")"

echo "== a public collection hides the owner's private designs =="
check "anon sees only the published design" "['Public card']" "$(cat /tmp/pub.json | jqr "[x['name'] for x in d['designs']]")"
check "and the count matches what's shown" 1 "$(cat /tmp/pub.json | jqr "d['design_count']")"
check "the owner still sees both" 2 "$(curl -s $BASE/api/collections/$CID "${AUTHA[@]}" -H 'Accept: application/json' | jqr "d['design_count']")"

echo "== removal and delete =="
check "remove a design" 1 "$(curl -s -X DELETE $BASE/api/collections/$CID/designs/$PRIV "${AUTHA[@]}" -H 'Accept: application/json' | jqr "d['design_count']")"
check "another account can't delete it" 204 "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE $BASE/api/collections/$CID "${AUTHB[@]}" -H 'Accept: application/json')"
check "it's still there" 200 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/collections/$CID -H 'Accept: application/json')"
check "owner deletes it" 204 "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE $BASE/api/collections/$CID "${AUTHA[@]}" -H 'Accept: application/json')"
check "gone" 404 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/collections/$CID -H 'Accept: application/json')"
check "deleting a collection doesn't delete its designs" 200 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/card-designs/$PUB "${AUTHA[@]}" -H 'Accept: application/json')"

echo "== reportable =="
C2=$(uuid)
curl -s -o /dev/null -X PUT $BASE/api/collections/$C2 "${AUTHA[@]}" "${J[@]}" -d '{"name":"Reportable"}'
check "a collection can be reported" 201 "$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/reports "${AUTHB[@]}" "${J[@]}" -d "{\"type\":\"collection\",\"id\":\"$C2\",\"reason\":\"spam\"}")"

echo
echo "== $pass passed, $fail failed =="
[ "$fail" -eq 0 ]
