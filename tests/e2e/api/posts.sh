#!/usr/bin/env bash
# Phase 5: knowledge-base posts, edit history and comments.
set -u
BASE="${E2E_API_URL:-http://127.0.0.1:8000}"
pass=0; fail=0
check() { if [ "$2" = "$3" ]; then echo "  PASS  $1 ($3)"; pass=$((pass+1)); else echo "  FAIL  $1 — expected $2, got $3"; fail=$((fail+1)); fi; }
jqr() { python3 -c "import sys,json;d=json.load(sys.stdin);print(eval(sys.argv[1]))" "$1"; }
J=(-H 'Content-Type: application/json' -H 'Accept: application/json')
uuid() { python3 -c "import uuid;print(uuid.uuid4())"; }
S=$(date +%s)

A=$(curl -s -X POST $BASE/api/auth/register "${J[@]}" -d "{\"name\":\"Wri Ter\",\"email\":\"wri$S@example.com\",\"password\":\"password123\"}")
TOKA=$(echo "$A" | jqr "d['token']"); UA=$(echo "$A" | jqr "d['user']['username']")
TOKB=$(curl -s -X POST $BASE/api/auth/register "${J[@]}" -d "{\"name\":\"Rea Der\",\"email\":\"rea$S@example.com\",\"password\":\"password123\"}" | jqr "d['token']")
AA=(-H "Authorization: Bearer $TOKA"); AB=(-H "Authorization: Bearer $TOKB")
PID=$(uuid)
points() { curl -s $BASE/api/users/$UA -H 'Accept: application/json' | jqr "d['stats']['points']"; }

echo "== write a post =="
BODY='# Printing at home\n\nUse **matte** stock.\n\n- Score first\n- Then cut'
check "create returns 201" 201 "$(curl -s -o /tmp/p.json -w '%{http_code}' -X PUT $BASE/api/posts/$PID "${AA[@]}" "${J[@]}" \
  -d "{\"title\":\"Printing at home $S\",\"body\":\"$BODY\",\"category\":\"printing\",\"tags\":[\"Home\",\" ink \"]}")"
SLUG=$(cat /tmp/p.json | jqr "d['slug']")
check "slug derived from the title" "True" "$(cat /tmp/p.json | jqr "d['slug'].startswith('printing-at-home')")"
check "starts private" "private" "$(cat /tmp/p.json | jqr "d['visibility']")"
check "tags normalized" "['home', 'ink']" "$(cat /tmp/p.json | jqr "d['tags']")"
check "category label resolved" "Printing" "$(cat /tmp/p.json | jqr "d['category_label']")"
check "no revisions yet" 0 "$(cat /tmp/p.json | jqr "d['revision_count']")"
check "bad category rejected" 422 "$(curl -s -o /dev/null -w '%{http_code}' -X PUT $BASE/api/posts/$(uuid) "${AA[@]}" "${J[@]}" -d '{"title":"x","body":"y","category":"nope"}')"

echo "== private until published =="
check "anon can't read a draft" 404 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/posts/$SLUG -H 'Accept: application/json')"
check "another account can't either" 404 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/posts/$SLUG "${AB[@]}" -H 'Accept: application/json')"
check "the author can" 200 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/posts/$SLUG "${AA[@]}" -H 'Accept: application/json')"
check "not in the public index" 0 "$(curl -s $BASE/api/posts -H 'Accept: application/json' | jqr "len([p for p in d if p['slug']=='$SLUG'])")"

BEFORE=$(points)
curl -s -o /dev/null -X POST $BASE/api/posts/$PID/publish "${AA[@]}" "${J[@]}" -d '{"visibility":"published"}'
check "publishing awards points" "$((BEFORE + 15))" "$(points)"
check "and earns the knowledge badge" "True" "$(curl -s $BASE/api/users/$UA -H 'Accept: application/json' | jqr "any(b['id']=='first-post' for b in d['badges'])")"
check "now in the public index" 1 "$(curl -s $BASE/api/posts -H 'Accept: application/json' | jqr "len([p for p in d if p['slug']=='$SLUG'])")"
check "and on the author's profile" 1 "$(curl -s $BASE/api/users/$UA -H 'Accept: application/json' | jqr "len([p for p in d['posts'] if p['slug']=='$SLUG'])")"
check "listing carries an excerpt, not the body" "True" "$(curl -s $BASE/api/posts -H 'Accept: application/json' | jqr "all('body' not in p and 'excerpt' in p for p in d)")"

echo "== filters =="
check "by category" 1 "$(curl -s "$BASE/api/posts?category=printing" -H 'Accept: application/json' | jqr "len([p for p in d if p['slug']=='$SLUG'])")"
check "wrong category excludes" 0 "$(curl -s "$BASE/api/posts?category=design" -H 'Accept: application/json' | jqr "len([p for p in d if p['slug']=='$SLUG'])")"
check "by tag, case-insensitively" 1 "$(curl -s "$BASE/api/posts?tag=Home" -H 'Accept: application/json' | jqr "len([p for p in d if p['slug']=='$SLUG'])")"
check "search matches the body" 1 "$(curl -s "$BASE/api/posts?q=matte" -H 'Accept: application/json' | jqr "len([p for p in d if p['slug']=='$SLUG'])")"
check "search miss excludes" 0 "$(curl -s "$BASE/api/posts?q=zzzznope" -H 'Accept: application/json' | jqr "len([p for p in d if p['slug']=='$SLUG'])")"

echo "== edit history =="
curl -s -o /dev/null -X PUT $BASE/api/posts/$PID "${AA[@]}" "${J[@]}" -d "{\"title\":\"Printing at home $S\",\"body\":\"Rewritten entirely.\",\"visibility\":\"published\"}"
check "editing records the old version" 1 "$(curl -s $BASE/api/posts/$PID/revisions "${AA[@]}" -H 'Accept: application/json' | jqr "len(d)")"
check "the revision holds what it said before" "True" "$(curl -s $BASE/api/posts/$PID/revisions "${AA[@]}" -H 'Accept: application/json' | jqr "'matte' in d[0]['body']")"
check "the post itself is the new text" "Rewritten entirely." "$(curl -s $BASE/api/posts/$SLUG -H 'Accept: application/json' | jqr "d['body']")"
curl -s -o /dev/null -X PUT $BASE/api/posts/$PID "${AA[@]}" "${J[@]}" -d "{\"title\":\"Printing at home $S\",\"body\":\"Rewritten entirely.\",\"visibility\":\"published\",\"category\":\"cutting\"}"
check "a metadata-only edit records nothing" 1 "$(curl -s $BASE/api/posts/$PID/revisions "${AA[@]}" -H 'Accept: application/json' | jqr "len(d)")"
check "history is owner-only" 404 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/posts/$PID/revisions "${AB[@]}" -H 'Accept: application/json')"
check "renaming keeps the original slug" "$SLUG" "$(curl -s -X PUT $BASE/api/posts/$PID "${AA[@]}" "${J[@]}" -d "{\"title\":\"A completely different title $S\",\"body\":\"Rewritten entirely.\",\"visibility\":\"published\"}" | jqr "d['slug']")"

echo "== comments =="
check "a reader can comment" 201 "$(curl -s -o /tmp/c.json -w '%{http_code}' -X POST $BASE/api/posts/$SLUG/comments "${AB[@]}" "${J[@]}" -d '{"body":"This helped, thanks."}')"
CID=$(cat /tmp/c.json | jqr "d['id']")
check "the comment is attributed" "Rea Der" "$(cat /tmp/c.json | jqr "d['author']['name']")"
check "comments are public to read" 1 "$(curl -s $BASE/api/posts/$SLUG/comments -H 'Accept: application/json' | jqr "len(d)")"
check "the listing counts them" 1 "$(curl -s $BASE/api/posts -H 'Accept: application/json' | jqr "[p for p in d if p['slug']=='$SLUG'][0]['comment_count']")"
check "anonymous comments 401" 401 "$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/posts/$SLUG/comments "${J[@]}" -d '{"body":"spam"}')"
check "empty comments rejected" 422 "$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/posts/$SLUG/comments "${AB[@]}" "${J[@]}" -d '{"body":""}')"
C2=$(curl -s -X POST $BASE/api/posts/$SLUG/comments "${AA[@]}" "${J[@]}" -d '{"body":"Glad it helped."}' | jqr "d['id']")
check "the post author can delete a reader's comment" 204 "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE $BASE/api/comments/$CID "${AA[@]}" -H 'Accept: application/json')"
check "a reader can't delete the author's" 404 "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE $BASE/api/comments/$C2 "${AB[@]}" -H 'Accept: application/json')"
check "one comment left" 1 "$(curl -s $BASE/api/posts/$SLUG/comments -H 'Accept: application/json' | jqr "len(d)")"

echo "== posts reuse the generic systems =="
check "posts are reactable" 1 "$(curl -s -X POST $BASE/api/reactions "${AB[@]}" "${J[@]}" -d "{\"type\":\"post\",\"id\":\"$PID\"}" | jqr "d['reaction_count']")"
check "the reaction awarded the author" "True" "$(curl -s $BASE/api/users/$UA -H 'Accept: application/json' | jqr "d['stats']['points'] > $((BEFORE + 15))")"
check "posts are reportable" 201 "$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/reports "${AB[@]}" "${J[@]}" -d "{\"type\":\"post\",\"id\":\"$PID\",\"reason\":\"spam\"}")"
check "comments are reportable" 201 "$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/reports "${AB[@]}" "${J[@]}" -d "{\"type\":\"comment\",\"id\":\"$C2\",\"reason\":\"inappropriate\"}")"

echo "== ownership =="
check "another account can't overwrite it" 409 "$(curl -s -o /dev/null -w '%{http_code}' -X PUT $BASE/api/posts/$PID "${AB[@]}" "${J[@]}" -d '{"title":"stolen","body":"x"}')"
check "or delete it" 204 "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE $BASE/api/posts/$PID "${AB[@]}" -H 'Accept: application/json')"
check "it's still there" 200 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/posts/$SLUG -H 'Accept: application/json')"
check "the author can delete it" 204 "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE $BASE/api/posts/$PID "${AA[@]}" -H 'Accept: application/json')"
check "and its comments go with it" 404 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/posts/$SLUG/comments -H 'Accept: application/json')"

echo
echo "== $pass passed, $fail failed =="
[ "$fail" -eq 0 ]
