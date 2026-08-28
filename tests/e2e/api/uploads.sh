#!/usr/bin/env bash
# Stored images: what's accepted, what's done to it before it's kept, and
# who can reach it afterwards.
set -u
BASE="${E2E_API_URL:-http://127.0.0.1:8000}"
pass=0; fail=0
check() { if [ "$2" = "$3" ]; then echo "  PASS  $1 ($3)"; pass=$((pass+1)); else echo "  FAIL  $1 — expected $2, got $3"; fail=$((fail+1)); fi; }
jqr() { python3 -c "import sys,json;d=json.load(sys.stdin);print(eval(sys.argv[1]))" "$1"; }
J=(-H 'Content-Type: application/json' -H 'Accept: application/json')
A=(-H 'Accept: application/json')
S=$(date +%s)$RANDOM
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# Fixtures built here rather than committed: a binary in the repo is a
# thing nobody can review, and these have to carry specific payloads.
php -r "\$i=imagecreatetruecolor(4000,1000);imagefill(\$i,0,0,imagecolorallocate(\$i,10,90,200));imagepng(\$i,'$WORK/big.png');"
php -r "\$i=imagecreatetruecolor(600,400);imagefill(\$i,0,0,imagecolorallocate(\$i,200,40,40));imagejpeg(\$i,'$WORK/plain.jpg',90);"
php -r "\$i=imagecreatetruecolor(300,200);imagefill(\$i,0,0,imagecolorallocate(\$i,20,160,60));imagepng(\$i,'$WORK/poly-base.png');"
python3 - "$WORK" <<'PYCODE'
import struct, sys, zlib
work = sys.argv[1]
# A JPEG carrying an EXIF APP1 segment: phone photos carry these, and
# they carry GPS. Publishing a card must not publish where its art was taken.
data = open(f"{work}/plain.jpg", "rb").read()
marker = b"Exif\x00\x00MM\x00*\x00\x00\x00\x08\x00\x01\x01\x0e\x00\x02\x00\x00\x00\x18\x00\x00\x00\x1aSECRET-GPS-51.5074N-0.1278W\x00"
open(f"{work}/exif.jpg", "wb").write(data[:2] + b"\xff\xe1" + struct.pack(">H", len(marker) + 2) + marker + data[2:])
# A file that is a valid PNG *and* carries PHP source — the shape of
# attack that turns "image upload" into "arbitrary code". Built from its
# own base image, not from big.png: identical pixels would dedupe to
# big.png's existing row and the check would pass without the polyglot
# ever being re-encoded.
png = open(f"{work}/poly-base.png", "rb").read()
payload = b"tEXtpayload\x00<?php system($_GET['c']); ?>"
chunk = struct.pack(">I", len(payload) - 4) + payload + struct.pack(">I", zlib.crc32(payload) & 0xffffffff)
cut = png.rindex(b"IEND") - 4
open(f"{work}/polyglot.png", "wb").write(png[:cut] + chunk + png[cut:])
PYCODE
printf '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>' > "$WORK/vector.svg"
printf 'just some text, not an image at all' > "$WORK/notes.txt"

TOK=$(curl -s -X POST $BASE/api/auth/register "${J[@]}" -d "{\"name\":\"Up Loader\",\"email\":\"up$S@example.com\",\"password\":\"password123\"}" | jqr "d['token']")
AU=(-H "Authorization: Bearer $TOK")

echo "== what's accepted =="
check "uploading needs an account" 401 "$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/uploads "${A[@]}" -F "file=@$WORK/plain.jpg")"
check "an SVG is refused" 422 "$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/uploads "${AU[@]}" "${A[@]}" -F "file=@$WORK/vector.svg")"
check "so is a text file" 422 "$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/uploads "${AU[@]}" "${A[@]}" -F "file=@$WORK/notes.txt")"
check "and a request with no file at all" 422 "$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/uploads "${AU[@]}" "${A[@]}")"

echo "== nothing is stored as it arrived =="
BIG=$(curl -s -X POST $BASE/api/uploads "${AU[@]}" "${A[@]}" -F "file=@$WORK/big.png")
check "a 4000px image is accepted" 2400 "$(echo "$BIG" | jqr "d['width']")"
check "and capped on its longest edge" 600 "$(echo "$BIG" | jqr "d['height']")"
BID=$(echo "$BIG" | jqr "d['id']")

EXIF=$(curl -s -X POST $BASE/api/uploads "${AU[@]}" "${A[@]}" -F "file=@$WORK/exif.jpg")
EID=$(echo "$EXIF" | jqr "d['id']")
curl -s -o "$WORK/served.jpg" $BASE/api/uploads/$EID
check "the EXIF block is gone from what's served" "False" "$(grep -q 'SECRET-GPS' "$WORK/served.jpg" && echo True || echo False)"
check "including its APP1 header" "False" "$(grep -qa 'Exif' "$WORK/served.jpg" && echo True || echo False)"

POLY=$(curl -s -X POST $BASE/api/uploads "${AU[@]}" "${A[@]}" -F "file=@$WORK/polyglot.png")
PID=$(echo "$POLY" | jqr "d['id']")
curl -s -o "$WORK/served.png" $BASE/api/uploads/$PID
check "a polyglot's payload doesn't survive re-encoding" "False" "$(grep -qa '<?php' "$WORK/served.png" && echo True || echo False)"

echo "== serving =="
check "an upload is readable without a token" 200 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/uploads/$BID)"
check "with the type it was stored as" "image/png" "$(curl -s -o /dev/null -w '%{content_type}' $BASE/api/uploads/$BID)"
check "and cached hard, since bytes never change per id" "True" "$(curl -s -D - -o /dev/null $BASE/api/uploads/$BID | grep -qi 'cache-control:.*immutable' && echo True || echo False)"
check "an unknown id 404s" 404 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/uploads/2b7f0d84-0000-4000-8000-000000000000 "${A[@]}")"

echo "== the same file twice is the same upload =="
AGAIN=$(curl -s -o /tmp/again.json -w '%{http_code}' -X POST $BASE/api/uploads "${AU[@]}" "${A[@]}" -F "file=@$WORK/big.png")
check "a re-upload isn't a second row" 200 "$AGAIN"
check "it's the same id" "$BID" "$(cat /tmp/again.json | jqr "d['id']")"
check "and the listing agrees" 3 "$(curl -s $BASE/api/uploads "${AU[@]}" "${A[@]}" | jqr "len(d['uploads'])")"
check "with a quota to spend" "True" "$(curl -s $BASE/api/uploads "${AU[@]}" "${A[@]}" | jqr "str(0 < d['used_bytes'] < d['quota_bytes'])")"

echo "== ownership =="
TOK2=$(curl -s -X POST $BASE/api/auth/register "${J[@]}" -d "{\"name\":\"Some One\",\"email\":\"other-up$S@example.com\",\"password\":\"password123\"}" | jqr "d['token']")
AO=(-H "Authorization: Bearer $TOK2")
check "someone else's upload isn't in your listing" 0 "$(curl -s $BASE/api/uploads "${AO[@]}" "${A[@]}" | jqr "len(d['uploads'])")"
check "and they can't delete it" 404 "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE $BASE/api/uploads/$BID "${AO[@]}" "${A[@]}")"
check "it's still there" 200 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/uploads/$BID)"
check "the owner can delete it" 200 "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE $BASE/api/uploads/$BID "${AU[@]}" "${A[@]}")"
check "and then it's gone" 404 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/uploads/$BID "${A[@]}")"

echo "== an upload can be an avatar =="
AV=$(curl -s -X POST $BASE/api/uploads "${AU[@]}" "${A[@]}" -F "file=@$WORK/plain.jpg" -F "kind=avatar" | jqr "d['url']")
check "its own URL is accepted as an avatar" 200 "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH $BASE/api/profile "${AU[@]}" "${J[@]}" -d "{\"avatar_url\":\"$AV\"}")"
check "an http link elsewhere still isn't" 422 "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH $BASE/api/profile "${AU[@]}" "${J[@]}" -d '{"avatar_url":"http://elsewhere.example/a.png"}')"

echo
echo "== $pass passed, $fail failed =="
[ "$fail" -eq 0 ]
