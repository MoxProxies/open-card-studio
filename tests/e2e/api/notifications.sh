#!/usr/bin/env bash
# Every community mechanism is supposed to tell the person it happened to.
# This is that, and the two rules around it: never about your own action,
# and never twice for the same one.
set -u
BASE="${E2E_API_URL:-http://127.0.0.1:8000}"
pass=0; fail=0
check() { if [ "$2" = "$3" ]; then echo "  PASS  $1 ($3)"; pass=$((pass+1)); else echo "  FAIL  $1 — expected $2, got $3"; fail=$((fail+1)); fi; }
jqr() { python3 -c "import sys,json;d=json.load(sys.stdin);print(eval(sys.argv[1]))" "$1"; }
J=(-H 'Content-Type: application/json' -H 'Accept: application/json')
A=(-H 'Accept: application/json')
S=$(date +%s)$RANDOM
uuid() { python3 -c "import uuid;print(uuid.uuid4())"; }
DESIGN='{"schemaVersion":1,"id":"x","name":"n","size":{"widthMm":69,"heightMm":94,"cutWidthMm":63,"cutHeightMm":88,"safeWidthMm":57,"safeHeightMm":82},"layers":[],"groups":[],"backgroundColor":"#fff","sourceCardDesignId":null}'

TOKA=$(curl -s -X POST $BASE/api/auth/register "${J[@]}" -d "{\"name\":\"Ow Ner\",\"email\":\"nown$S@example.com\",\"password\":\"password123\"}" | jqr "d['token']")
TOKB=$(curl -s -X POST $BASE/api/auth/register "${J[@]}" -d "{\"name\":\"Fa N\",\"email\":\"nfan$S@example.com\",\"password\":\"password123\"}" | jqr "d['token']")
AA=(-H "Authorization: Bearer $TOKA"); AB=(-H "Authorization: Bearer $TOKB")

TID=$(uuid)
curl -s -o /dev/null -X PUT $BASE/api/templates/$TID "${AA[@]}" "${J[@]}" -d "{\"name\":\"Noticed layout $S\",\"visibility\":\"published\",\"design\":$DESIGN}"

echo "== the feed starts empty and needs an account =="
check "reading needs an account" 401 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/notifications "${A[@]}")"
check "a new account has nothing" 0 "$(curl -s $BASE/api/notifications "${AB[@]}" "${A[@]}" | jqr "len(d['notifications'])")"

echo "== a like tells the owner, once =="
curl -s -o /dev/null -X POST $BASE/api/reactions "${AB[@]}" "${J[@]}" -d "{\"type\":\"template\",\"id\":\"$TID\"}"
FEED=$(curl -s $BASE/api/notifications "${AA[@]}" "${A[@]}")
check "the owner hears about it" 1 "$(echo "$FEED" | jqr "len([n for n in d['notifications'] if n['type']=='reaction'])")"
check "and everything so far is unread" "True" "$(echo "$FEED" | jqr "str(d['unread'] == len(d['notifications']))")"
check "crediting who did it" "Fa N" "$(echo "$FEED" | jqr "[n for n in d['notifications'] if n['type']=='reaction'][0]['actor']['name']")"
check "and what it was about" "Noticed layout $S" "$(echo "$FEED" | jqr "[n for n in d['notifications'] if n['type']=='reaction'][0]['data']['title']")"
# Unliking and re-liking must not be a second piece of news — the same
# exactly-once rule the points ledger uses.
curl -s -o /dev/null -X POST $BASE/api/reactions "${AB[@]}" "${J[@]}" -d "{\"type\":\"template\",\"id\":\"$TID\"}"
curl -s -o /dev/null -X POST $BASE/api/reactions "${AB[@]}" "${J[@]}" -d "{\"type\":\"template\",\"id\":\"$TID\"}"
check "un-liking and re-liking doesn't repeat it" 1 "$(curl -s $BASE/api/notifications "${AA[@]}" "${A[@]}" | jqr "len([n for n in d['notifications'] if n['type']=='reaction'])")"

echo "== your own actions are not news =="
curl -s -o /dev/null -X POST $BASE/api/reactions "${AA[@]}" "${J[@]}" -d "{\"type\":\"template\",\"id\":\"$TID\"}"
check "liking your own work tells you nothing" 1 "$(curl -s $BASE/api/notifications "${AA[@]}" "${A[@]}" | jqr "len([n for n in d['notifications'] if n['type']=='reaction'])")"

echo "== a remix tells the original's author =="
curl -s -o /dev/null -X POST $BASE/api/templates/$TID/fork "${AB[@]}" "${J[@]}"
check "the author hears about the remix" 1 "$(curl -s $BASE/api/notifications "${AA[@]}" "${A[@]}" | jqr "len([n for n in d['notifications'] if n['type']=='remix'])")"
curl -s -o /dev/null -X POST $BASE/api/templates/$TID/fork "${AB[@]}" "${J[@]}"
check "remixing twice is still one piece of news" 1 "$(curl -s $BASE/api/notifications "${AA[@]}" "${A[@]}" | jqr "len([n for n in d['notifications'] if n['type']=='remix'])")"

echo "== a comment tells the guide's author =="
PID=$(uuid)
curl -s -o /dev/null -X PUT $BASE/api/posts/$PID "${AA[@]}" "${J[@]}" -d "{\"title\":\"Cutting guide $S\",\"body\":\"How to cut card stock.\",\"visibility\":\"published\"}"
SLUG=$(curl -s $BASE/api/my/posts "${AA[@]}" "${A[@]}" | jqr "[p['slug'] for p in d if p['title']=='Cutting guide $S'][0]")
curl -s -o /dev/null -X POST $BASE/api/posts/$SLUG/comments "${AB[@]}" "${J[@]}" -d '{"body":"This worked, thank you."}'
check "the author hears about the comment" 1 "$(curl -s $BASE/api/notifications "${AA[@]}" "${A[@]}" | jqr "len([n for n in d['notifications'] if n['type']=='comment'])")"
# Unlike a like, two comments really are two things to hear about.
curl -s -o /dev/null -X POST $BASE/api/posts/$SLUG/comments "${AB[@]}" "${J[@]}" -d '{"body":"One more thought."}'
check "and about the second one too" 2 "$(curl -s $BASE/api/notifications "${AA[@]}" "${A[@]}" | jqr "len([n for n in d['notifications'] if n['type']=='comment'])")"

echo "== badges arrive with no-one to credit =="
check "earning a badge is news" "True" "$(curl -s $BASE/api/notifications "${AA[@]}" "${A[@]}" | jqr "str(any(n['type']=='badge' for n in d['notifications']))")"
check "with no actor, because the system did it" "None" "$(curl -s $BASE/api/notifications "${AA[@]}" "${A[@]}" | jqr "str([n for n in d['notifications'] if n['type']=='badge'][0]['actor'])")"

echo "== marking read =="
BEFORE=$(curl -s $BASE/api/notifications "${AA[@]}" "${A[@]}" | jqr "d['unread']")
check "there is something unread" "True" "$([ "$BEFORE" -gt 0 ] && echo True || echo False)"
ONE=$(curl -s $BASE/api/notifications "${AA[@]}" "${A[@]}" | jqr "d['notifications'][0]['id']")
check "one row can be marked" "$((BEFORE-1))" "$(curl -s -X POST $BASE/api/notifications/read "${AA[@]}" "${J[@]}" -d "{\"id\":$ONE}" | jqr "d['unread']")"
check "someone else's row can't be" 404 "$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/notifications/read "${AB[@]}" "${J[@]}" -d "{\"id\":$ONE}")"
check "and the rest can be cleared at once" 0 "$(curl -s -X POST $BASE/api/notifications/read "${AA[@]}" "${J[@]}" -d '{}' | jqr "d['unread']")"
check "the rows stay, just read" "True" "$(curl -s $BASE/api/notifications "${AA[@]}" "${A[@]}" | jqr "str(len(d['notifications']) > 0 and all(n['read'] for n in d['notifications']))")"

echo "== a takedown says why =="
"${E2E_ARTISAN:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../backend" && pwd)/artisan}" tinker --execute="\$u = App\Models\User::where('email','nfan$S@example.com')->first(); \$u->is_staff = true; \$u->save();" >/dev/null 2>&1
curl -s -o /dev/null -X POST $BASE/api/moderation/takedown "${AB[@]}" "${J[@]}" -d "{\"type\":\"template\",\"id\":\"$TID\",\"removed\":true,\"reason\":\"Not your artwork.\"}"
TD=$(curl -s $BASE/api/notifications "${AA[@]}" "${A[@]}" | jqr "[n for n in d['notifications'] if n['type']=='moderation']")
check "the owner is told their content went" 1 "$(echo "$TD" | python3 -c "import sys;print(len(eval(sys.stdin.read())))")"
check "with the stated reason" "True" "$(curl -s $BASE/api/notifications "${AA[@]}" "${A[@]}" | jqr "str([n for n in d['notifications'] if n['type']=='moderation'][0]['data']['reason'] == 'Not your artwork.')")"

echo "== the email digest preference =="
ARTISAN="${E2E_ARTISAN:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../backend" && pwd)/artisan}"
check "it's on by default" "True" "$(curl -s $BASE/api/auth/me "${AA[@]}" "${A[@]}" | jqr "str(d['notification_emails'])")"
check "and can be turned off from the profile" "False" "$(curl -s -X PATCH $BASE/api/profile "${AA[@]}" "${J[@]}" -d '{"notification_emails":false}' | jqr "str(d['notification_emails'])")"
check "an unsigned unsubscribe link is refused" 403 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/notifications/unsubscribe/1/deadbeef" "${A[@]}")"
# The digest itself is proven in PHPUnit (who gets one, and never twice);
# what matters over HTTP is that the command runs against a real database
# without blowing up on the way through.
check "the digest command runs" 0 "$("$ARTISAN" notifications:digest >/dev/null 2>&1; echo $?)"
check "turning it back on works" "True" "$(curl -s -X PATCH $BASE/api/profile "${AA[@]}" "${J[@]}" -d '{"notification_emails":true}' | jqr "str(d['notification_emails'])")"

echo
echo "== $pass passed, $fail failed =="
[ "$fail" -eq 0 ]
