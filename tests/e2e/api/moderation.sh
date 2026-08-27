#!/usr/bin/env bash
# Phase 6b: the report queue, takedowns, suspensions and the audit trail.
set -u
BASE="${E2E_API_URL:-http://127.0.0.1:8000}"
ARTISAN="${E2E_ARTISAN:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../backend" && pwd)/artisan}"
pass=0; fail=0
check() { if [ "$2" = "$3" ]; then echo "  PASS  $1 ($3)"; pass=$((pass+1)); else echo "  FAIL  $1 — expected $2, got $3"; fail=$((fail+1)); fi; }
jqr() { python3 -c "import sys,json;d=json.load(sys.stdin);print(eval(sys.argv[1]))" "$1"; }
J=(-H 'Content-Type: application/json' -H 'Accept: application/json')
uuid() { python3 -c "import uuid;print(uuid.uuid4())"; }
S=$(date +%s)

A=$(curl -s -X POST $BASE/api/auth/register "${J[@]}" -d "{\"name\":\"Mod Erator\",\"email\":\"mod$S@example.com\",\"password\":\"password123\"}")
TOKM=$(echo "$A" | jqr "d['token']"); MID=$(echo "$A" | jqr "d['user']['id']")
B=$(curl -s -X POST $BASE/api/auth/register "${J[@]}" -d "{\"name\":\"Off Ender\",\"email\":\"off$S@example.com\",\"password\":\"password123\"}")
TOKO=$(echo "$B" | jqr "d['token']"); OID=$(echo "$B" | jqr "d['user']['id']"); UO=$(echo "$B" | jqr "d['user']['username']")
TOKR=$(curl -s -X POST $BASE/api/auth/register "${J[@]}" -d "{\"name\":\"Rep Orter\",\"email\":\"rep$S@example.com\",\"password\":\"password123\"}" | jqr "d['token']")
AM=(-H "Authorization: Bearer $TOKM"); AO=(-H "Authorization: Bearer $TOKO"); AR=(-H "Authorization: Bearer $TOKR")
DESIGN='{"schemaVersion":1,"id":"x","name":"n","size":{"widthMm":69,"heightMm":94,"cutWidthMm":63,"cutHeightMm":88,"safeWidthMm":57,"safeHeightMm":82},"layers":[],"groups":[],"backgroundColor":"#fff","sourceCardDesignId":null}'

echo "== the moderation surface is invisible to non-staff =="
check "a normal account gets 404, not 403" 404 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/moderation/reports "${AR[@]}" -H 'Accept: application/json')"
check "so does an anonymous request" 401 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/moderation/reports -H 'Accept: application/json')"
check "takedown too" 404 "$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/moderation/takedown "${AR[@]}" "${J[@]}" -d '{"type":"post","id":"x","removed":true,"reason":"y"}')"

# Promote the moderator the way a founder would.
# Direct assignment, not update(): is_staff is deliberately absent from
# User::$fillable, so a registration payload can never set it.
"$ARTISAN" tinker --execute="\$u = App\Models\User::find($MID); \$u->is_staff = true; \$u->save();" >/dev/null 2>&1
check "staff can now see the queue" 200 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/moderation/reports "${AM[@]}" -H 'Accept: application/json')"

echo "== a reported template reaches the queue =="
TID=$(uuid)
curl -s -o /dev/null -X PUT $BASE/api/templates/$TID "${AO[@]}" "${J[@]}" -d "{\"name\":\"Dodgy layout $S\",\"visibility\":\"published\",\"design\":$DESIGN}"
curl -s -o /dev/null -X POST $BASE/api/reactions "${AR[@]}" "${J[@]}" -d "{\"type\":\"template\",\"id\":\"$TID\"}"
POINTS_BEFORE=$(curl -s $BASE/api/users/$UO -H 'Accept: application/json' | jqr "d['stats']['points']")
RID=$(curl -s -X POST $BASE/api/reports "${AR[@]}" "${J[@]}" -d "{\"type\":\"template\",\"id\":\"$TID\",\"reason\":\"infringement\",\"details\":\"That's my art.\"}" | jqr "d['id']")
Q=$(curl -s $BASE/api/moderation/reports "${AM[@]}" -H 'Accept: application/json')
check "the report is in the open queue" 1 "$(echo "$Q" | jqr "len([r for r in d if r['id']==$RID])")"
check "with enough to judge it without hunting" "Dodgy layout $S" "$(echo "$Q" | jqr "[r['target']['label'] for r in d if r['id']==$RID][0]")"
check "and the reporter's note" "That's my art." "$(echo "$Q" | jqr "[r['details'] for r in d if r['id']==$RID][0]")"

echo "== takedown =="
check "a takedown needs a stated reason" 422 "$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/moderation/takedown "${AM[@]}" "${J[@]}" -d "{\"type\":\"template\",\"id\":\"$TID\",\"removed\":true}")"
check "with one, it works" 200 "$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/moderation/takedown "${AM[@]}" "${J[@]}" -d "{\"type\":\"template\",\"id\":\"$TID\",\"removed\":true,\"reason\":\"Confirmed infringement.\"}")"
check "the template is gone from the gallery" 0 "$(curl -s $BASE/api/templates/browse -H 'Accept: application/json' | jqr "len([t for t in d if t['id']=='$TID'])")"
check "gone by id too" 404 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/templates/$TID -H 'Accept: application/json')"
check "and gone even for its owner" 404 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/templates/$TID "${AO[@]}" -H 'Accept: application/json')"
check "off the owner's profile" 0 "$(curl -s $BASE/api/users/$UO -H 'Accept: application/json' | jqr "len([t for t in d['templates'] if t['id']=='$TID'])")"
check "the points it earned are reversed" 0 "$(curl -s $BASE/api/users/$UO -H 'Accept: application/json' | jqr "d['stats']['points']")"
check "taking it down twice doesn't double-subtract" 0 "$(curl -s -o /dev/null -X POST $BASE/api/moderation/takedown "${AM[@]}" "${J[@]}" -d "{\"type\":\"template\",\"id\":\"$TID\",\"removed\":true,\"reason\":\"again\"}"; curl -s $BASE/api/users/$UO -H 'Accept: application/json' | jqr "d['stats']['points']")"
check "restoring it brings it back" 200 "$(curl -s -o /dev/null -X POST $BASE/api/moderation/takedown "${AM[@]}" "${J[@]}" -d "{\"type\":\"template\",\"id\":\"$TID\",\"removed\":false}"; curl -s -o /dev/null -w '%{http_code}' $BASE/api/templates/$TID -H 'Accept: application/json')"

echo "== resolving the report =="
check "marking it actioned" "actioned" "$(curl -s -X POST $BASE/api/moderation/reports/$RID "${AM[@]}" "${J[@]}" -d '{"state":"actioned","reason":"Taken down."}' | jqr "d['state']")"
check "it leaves the open queue" 0 "$(curl -s $BASE/api/moderation/reports "${AM[@]}" -H 'Accept: application/json' | jqr "len([r for r in d if r['id']==$RID])")"
check "but is still findable" 1 "$(curl -s "$BASE/api/moderation/reports?state=actioned" "${AM[@]}" -H 'Accept: application/json' | jqr "len([r for r in d if r['id']==$RID])")"
check "an invalid state is rejected" 422 "$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/moderation/reports/$RID "${AM[@]}" "${J[@]}" -d '{"state":"vibes"}')"

echo "== suspension =="
check "a suspension needs a reason too" 422 "$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/moderation/users/$OID/suspend "${AM[@]}" "${J[@]}" -d '{"suspended":true}')"
check "suspending works" "suspended" "$(curl -s -X POST $BASE/api/moderation/users/$OID/suspend "${AM[@]}" "${J[@]}" -d '{"suspended":true,"reason":"Repeated infringement."}' | jqr "d['moderation_state']")"
check "their token stops working immediately" 403 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/auth/me "${AO[@]}" -H 'Accept: application/json')"
check "and they can't write anything" 403 "$(curl -s -o /dev/null -w '%{http_code}' -X PUT $BASE/api/card-designs/$(uuid) "${AO[@]}" "${J[@]}" -d "{\"name\":\"x\",\"design\":$DESIGN}")"
check "their profile 404s" 404 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/users/$UO -H 'Accept: application/json')"
check "staff can't be suspended this way" 422 "$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/moderation/users/$MID/suspend "${AM[@]}" "${J[@]}" -d '{"suspended":true,"reason":"x"}')"
check "reinstating restores access without a re-login" 200 "$(curl -s -o /dev/null -X POST $BASE/api/moderation/users/$OID/suspend "${AM[@]}" "${J[@]}" -d '{"suspended":false}'; curl -s -o /dev/null -w '%{http_code}' $BASE/api/auth/me "${AO[@]}" -H 'Accept: application/json')"

echo "== manual badges =="
check "granting a manual badge" "True" "$(curl -s -X POST $BASE/api/moderation/users/$OID/badges "${AM[@]}" "${J[@]}" -d '{"badge":"pillar","granted":true,"reason":"Years of help."}' | jqr "any(b['id']=='pillar' for b in d['badges'])")"
check "it shows on their public profile" "True" "$(curl -s $BASE/api/users/$UO -H 'Accept: application/json' | jqr "any(b['id']=='pillar' for b in d['badges'])")"
check "an earned badge can't be hand-granted" 422 "$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/moderation/users/$OID/badges "${AM[@]}" "${J[@]}" -d '{"badge":"first-template","granted":true}')"
check "an unknown badge is rejected" 422 "$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/moderation/users/$OID/badges "${AM[@]}" "${J[@]}" -d '{"badge":"nonesuch","granted":true}')"
check "revoking it" "False" "$(curl -s -X POST $BASE/api/moderation/users/$OID/badges "${AM[@]}" "${J[@]}" -d '{"badge":"pillar","granted":false}' | jqr "any(b['id']=='pillar' for b in d['badges'])")"

echo "== the audit trail =="
LOG=$(curl -s $BASE/api/moderation/actions "${AM[@]}" -H 'Accept: application/json')
check "every action was recorded" "True" "$(echo "$LOG" | jqr "{'takedown','restore','suspend','reinstate','report_state','badge_grant','badge_revoke'} <= {a['action'] for a in d}")"
check "with the moderator's name" "Mod Erator" "$(echo "$LOG" | jqr "[a['actor'] for a in d if a['action']=='takedown'][0]")"
check "and the stated reason" "Confirmed infringement." "$(echo "$LOG" | jqr "[a['reason'] for a in d if a['action']=='takedown'][-1]")"
check "the trail is staff-only" 404 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/moderation/actions "${AR[@]}" -H 'Accept: application/json')"

echo "== comments and posts can be taken down too =="
PID=$(uuid)
curl -s -o /dev/null -X PUT $BASE/api/posts/$PID "${AM[@]}" "${J[@]}" -d '{"title":"Staff guide '"$S"'","body":"Body text.","visibility":"published"}'
PSLUG=$(curl -s $BASE/api/my/posts "${AM[@]}" -H 'Accept: application/json' | jqr "[p['slug'] for p in d if p['id']=='$PID'][0]")
CMT=$(curl -s -X POST $BASE/api/posts/$PSLUG/comments "${AR[@]}" "${J[@]}" -d '{"body":"Rude remark."}' | jqr "d['id']")
curl -s -o /dev/null -X POST $BASE/api/moderation/takedown "${AM[@]}" "${J[@]}" -d "{\"type\":\"comment\",\"id\":\"$CMT\",\"removed\":true,\"reason\":\"Abuse.\"}"
check "a removed comment disappears from the thread" 0 "$(curl -s $BASE/api/posts/$PSLUG/comments -H 'Accept: application/json' | jqr "len([c for c in d if c['id']==$CMT])")"
curl -s -o /dev/null -X POST $BASE/api/moderation/takedown "${AM[@]}" "${J[@]}" -d "{\"type\":\"post\",\"id\":\"$PID\",\"removed\":true,\"reason\":\"Off topic.\"}"
check "a removed post 404s" 404 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/posts/$PSLUG -H 'Accept: application/json')"

echo
echo "== $pass passed, $fail failed =="
[ "$fail" -eq 0 ]
