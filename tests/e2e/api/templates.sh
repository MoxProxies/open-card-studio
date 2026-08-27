#!/usr/bin/env bash
# End-to-end curl exercise of the templates API against a real running backend.
set -u
BASE="${E2E_API_URL:-http://127.0.0.1:8000}"
pass=0; fail=0
check() { # check <label> <expected> <actual>
  if [ "$2" = "$3" ]; then echo "  PASS  $1 ($3)"; pass=$((pass+1));
  else echo "  FAIL  $1 — expected $2, got $3"; fail=$((fail+1)); fi
}
jqr() { python3 -c "import sys,json;d=json.load(sys.stdin);print(eval(sys.argv[1]))" "$1"; }

STAMP=$(date +%s)
echo "== register two accounts =="
A=$(curl -s -X POST $BASE/api/auth/register -H 'Content-Type: application/json' -H 'Accept: application/json' \
  -d "{\"name\":\"Ana Author\",\"email\":\"ana$STAMP@example.com\",\"password\":\"password123\"}")
TOKA=$(echo "$A" | jqr "d['token']")
B=$(curl -s -X POST $BASE/api/auth/register -H 'Content-Type: application/json' -H 'Accept: application/json' \
  -d "{\"name\":\"Bo Builder\",\"email\":\"bo$STAMP@example.com\",\"password\":\"password123\"}")
TOKB=$(echo "$B" | jqr "d['token']")
[ -n "$TOKA" ] && echo "  ok: got tokens"

TID=$(python3 -c "import uuid;print(uuid.uuid4())")
DESIGN=$(cat <<JSON
{"schemaVersion":1,"id":"$(python3 -c "import uuid;print(uuid.uuid4())")","name":"Woodgrain layout","size":{"widthMm":69,"heightMm":94,"cutWidthMm":63,"cutHeightMm":88,"safeWidthMm":57,"safeHeightMm":82},"backgroundColor":"#ffffff","groups":[],"sourceCardDesignId":null,
"layers":[
 {"id":"chrome-frame","name":"Frame","type":"frame","assetId":"generic/plain","x":0,"y":0,"width":69,"height":94,"rotationDeg":0,"opacity":1,"visible":true,"locked":true,"contentLocked":true},
 {"id":"slot-title","name":"Title","type":"text","fieldId":"title","content":"Card name","x":6,"y":6,"width":50,"height":8,"rotationDeg":0,"opacity":1,"visible":true,"locked":true,"contentLocked":false,"fontFamily":"Beleren","fontSizePt":12,"fontWeight":"normal","italic":false,"color":"#111111","align":"left","lineHeight":1.2},
 {"id":"free-note","name":"Note","type":"text","content":"move me","x":6,"y":80,"width":30,"height":6,"rotationDeg":0,"opacity":1,"visible":true,"locked":false,"contentLocked":false,"fontFamily":"Beleren","fontSizePt":8,"fontWeight":"normal","italic":false,"color":"#111111","align":"left","lineHeight":1.2}
]}
JSON
)

echo "== PUT a private template as Ana =="
CODE=$(curl -s -o /tmp/t1.json -w '%{http_code}' -X PUT $BASE/api/templates/$TID \
  -H "Authorization: Bearer $TOKA" -H 'Content-Type: application/json' -H 'Accept: application/json' \
  -d "{\"name\":\"Woodgrain layout\",\"description\":\"Rustic full-bleed frame\",\"tags\":[\"Rustic\",\" fantasy \",\"rustic\"],\"visibility\":\"private\",\"design\":$DESIGN}")
check "create returns 201" 201 "$CODE"
check "tags normalized+deduped" "['rustic', 'fantasy']" "$(cat /tmp/t1.json | jqr "d['tags']")"
check "version starts at 1" 1 "$(cat /tmp/t1.json | jqr "d['version']")"
check "usage starts at 0" 0 "$(cat /tmp/t1.json | jqr "d['usage_count']")"
check "author attributed" "Ana Author" "$(cat /tmp/t1.json | jqr "d['author']['name']")"
check "design round-trips lock flags" "[True, True]" "$(cat /tmp/t1.json | jqr "[d['design']['layers'][0]['locked'], d['design']['layers'][0]['contentLocked']]")"

echo "== private template is invisible to the public =="
check "anon browse excludes private" 0 "$(curl -s $BASE/api/templates/browse -H 'Accept: application/json' | jqr "len([t for t in d if t['id']=='$TID'])")"
check "anon GET private 404s" 404 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/templates/$TID -H 'Accept: application/json')"
check "other account's GET 404s" 404 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/templates/$TID -H "Authorization: Bearer $TOKB" -H 'Accept: application/json')"
check "owner GET succeeds" 200 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/templates/$TID -H "Authorization: Bearer $TOKA" -H 'Accept: application/json')"

echo "== cross-account write is rejected, not collided =="
check "Bo PUT on Ana's id 409s" 409 "$(curl -s -o /dev/null -w '%{http_code}' -X PUT $BASE/api/templates/$TID \
  -H "Authorization: Bearer $TOKB" -H 'Content-Type: application/json' -H 'Accept: application/json' \
  -d "{\"name\":\"stolen\",\"design\":$DESIGN}")"
check "unauthenticated PUT 401s" 401 "$(curl -s -o /dev/null -w '%{http_code}' -X PUT $BASE/api/templates/$TID \
  -H 'Content-Type: application/json' -H 'Accept: application/json' -d "{\"name\":\"x\",\"design\":$DESIGN}")"

echo "== publish =="
check "publish endpoint 200s" 200 "$(curl -s -o /tmp/t2.json -w '%{http_code}' -X POST $BASE/api/templates/$TID/publish \
  -H "Authorization: Bearer $TOKA" -H 'Content-Type: application/json' -H 'Accept: application/json' -d '{"visibility":"published"}')"
check "visibility is published" published "$(cat /tmp/t2.json | jqr "d['visibility']")"
check "anon browse now finds it" 1 "$(curl -s $BASE/api/templates/browse -H 'Accept: application/json' | jqr "len([t for t in d if t['id']=='$TID'])")"
check "anon GET now 200s" 200 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/templates/$TID -H 'Accept: application/json')"
check "search by name matches" 1 "$(curl -s "$BASE/api/templates/browse?q=woodgrain" -H 'Accept: application/json' | jqr "len([t for t in d if t['id']=='$TID'])")"
check "search miss excludes" 0 "$(curl -s "$BASE/api/templates/browse?q=zzznope" -H 'Accept: application/json' | jqr "len([t for t in d if t['id']=='$TID'])")"
check "tag filter matches (case-insensitive)" 1 "$(curl -s "$BASE/api/templates/browse?tag=Rustic" -H 'Accept: application/json' | jqr "len([t for t in d if t['id']=='$TID'])")"
check "tag filter miss excludes" 0 "$(curl -s "$BASE/api/templates/browse?tag=sci-fi" -H 'Accept: application/json' | jqr "len([t for t in d if t['id']=='$TID'])")"
check "invalid sort 422s" 422 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/templates/browse?sort=bogus" -H 'Accept: application/json')"

echo "== usage count =="
curl -s -o /dev/null -X POST $BASE/api/templates/$TID/use -H 'Accept: application/json'
check "anon use increments" 2 "$(curl -s -X POST $BASE/api/templates/$TID/use -H 'Accept: application/json' | jqr "d['usage_count']")"

echo "== version bumps only on a design change =="
curl -s -o /dev/null -X PUT $BASE/api/templates/$TID -H "Authorization: Bearer $TOKA" -H 'Content-Type: application/json' -H 'Accept: application/json' \
  -d "{\"name\":\"Woodgrain layout\",\"description\":\"Just a description edit\",\"visibility\":\"published\",\"design\":$DESIGN}"
check "metadata-only edit keeps v1" 1 "$(curl -s $BASE/api/templates/$TID -H 'Accept: application/json' | jqr "d['version']")"
check "description updated" "Just a description edit" "$(curl -s $BASE/api/templates/$TID -H 'Accept: application/json' | jqr "d['description']")"
check "tags survive an omitted-tags update" "['rustic', 'fantasy']" "$(curl -s $BASE/api/templates/$TID -H 'Accept: application/json' | jqr "d['tags']")"
CHANGED=$(echo "$DESIGN" | python3 -c "import sys,json;d=json.load(sys.stdin);d['layers'][2]['locked']=True;print(json.dumps(d))")
curl -s -o /dev/null -X PUT $BASE/api/templates/$TID -H "Authorization: Bearer $TOKA" -H 'Content-Type: application/json' -H 'Accept: application/json' \
  -d "{\"name\":\"Woodgrain layout\",\"visibility\":\"published\",\"design\":$CHANGED}"
check "layout change bumps to v2" 2 "$(curl -s $BASE/api/templates/$TID -H 'Accept: application/json' | jqr "d['version']")"
check "usage count survives an update" 2 "$(curl -s $BASE/api/templates/$TID -H 'Accept: application/json' | jqr "d['usage_count']")"

echo "== usage_count / moderation_state can't be mass-assigned =="
curl -s -o /dev/null -X PUT $BASE/api/templates/$TID -H "Authorization: Bearer $TOKA" -H 'Content-Type: application/json' -H 'Accept: application/json' \
  -d "{\"name\":\"Woodgrain layout\",\"visibility\":\"published\",\"usage_count\":9999,\"design\":$CHANGED}"
check "usage_count not client-settable" 2 "$(curl -s $BASE/api/templates/$TID -H 'Accept: application/json' | jqr "d['usage_count']")"

echo "== my templates listing =="
check "Ana sees her template" 1 "$(curl -s $BASE/api/templates -H "Authorization: Bearer $TOKA" -H 'Accept: application/json' | jqr "len([t for t in d if t['id']=='$TID'])")"
check "Bo doesn't" 0 "$(curl -s $BASE/api/templates -H "Authorization: Bearer $TOKB" -H 'Accept: application/json' | jqr "len([t for t in d if t['id']=='$TID'])")"
check "my-list omits the design blob" "False" "$(curl -s $BASE/api/templates -H "Authorization: Bearer $TOKA" -H 'Accept: application/json' | jqr "any('design' in t for t in d)")"

echo "== validation =="
check "missing design 422s" 422 "$(curl -s -o /dev/null -w '%{http_code}' -X PUT $BASE/api/templates/$(python3 -c "import uuid;print(uuid.uuid4())") \
  -H "Authorization: Bearer $TOKA" -H 'Content-Type: application/json' -H 'Accept: application/json' -d '{"name":"no design"}')"
check "bad visibility 422s" 422 "$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/templates/$TID/publish \
  -H "Authorization: Bearer $TOKA" -H 'Content-Type: application/json' -H 'Accept: application/json' -d '{"visibility":"everyone"}')"
check "9 tags 422s" 422 "$(curl -s -o /dev/null -w '%{http_code}' -X PUT $BASE/api/templates/$(python3 -c "import uuid;print(uuid.uuid4())") \
  -H "Authorization: Bearer $TOKA" -H 'Content-Type: application/json' -H 'Accept: application/json' \
  -d "{\"name\":\"too many tags\",\"tags\":[\"a\",\"b\",\"c\",\"d\",\"e\",\"f\",\"g\",\"h\",\"i\"],\"design\":$DESIGN}")"

echo "== delete =="
check "Bo can't delete Ana's" 1 "$(curl -s -o /dev/null -X DELETE $BASE/api/templates/$TID -H "Authorization: Bearer $TOKB" -H 'Accept: application/json'; curl -s $BASE/api/templates/$TID -H 'Accept: application/json' | jqr "1 if d['id']=='$TID' else 0")"
check "Ana's delete 204s" 204 "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE $BASE/api/templates/$TID -H "Authorization: Bearer $TOKA" -H 'Accept: application/json')"
check "gone from browse" 404 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/templates/$TID -H 'Accept: application/json')"

echo
echo "== $pass passed, $fail failed =="
[ "$fail" -eq 0 ]
