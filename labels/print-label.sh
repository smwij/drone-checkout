#!/usr/bin/env bash
# Print drone-checkout QR labels on a Brother PT-D460BT over USB.
#
# Usage:
#   ./print-label.sh "MINI4 Pro 0637"          # one item (searches items.tsv by name/serial)
#   ./print-label.sh "AIR 3S" "NEO 2"          # several items, one label each
#   ./print-label.sh --all                     # every item in items.tsv
#   ./print-label.sh --url "https://any.url"   # ad-hoc QR, no item lookup
#   ./print-label.sh --dry-run "AIR 3S"        # generate PNG only, don't print
#
# The checkout app expects labels to encode  <origin>/?scan=<item-id-no-dashes>
# Base URL comes from $BASE_URL or labels/base-url.txt (one line).
set -euo pipefail
cd "$(dirname "$0")"

PT="${PT:-$HOME/src/ptouch-print/build/ptouch-print}"
command -v qrencode >/dev/null || { echo "qrencode not installed (sudo apt-get install qrencode)"; exit 1; }
[ -x "$PT" ] || command -v "$PT" >/dev/null || { echo "ptouch-print not found at $PT (build it first)"; exit 1; }

DRY=0; ALL=0; ADHOC=""
ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1;;
    --all) ALL=1;;
    --url) ADHOC="$2"; shift;;
    *) ARGS+=("$1");;
  esac
  shift
done

# How many pixels tall can this tape print? (12mm TZe -> 84px, 18mm -> 128px)
if [ "$DRY" = 1 ]; then
  MAX=84   # assume 12mm tape for dry runs
else
  MAX=$("$PT" --info 2>/dev/null | sed -n 's/.*maximum printing width for this tape is \([0-9]*\)px.*/\1/p')
  [ -n "$MAX" ] || { echo "Could not read tape width from printer — is it connected and on?"; exit 1; }
  echo "Tape printable height: ${MAX}px"
fi

OUT=out; mkdir -p "$OUT"

make_qr(){ # $1=payload $2=outfile  — sized to fill the tape height
  local w
  qrencode -m 2 -s 1 -l M -o "$2" "$1"
  w=$(python3 -c "import struct,sys;d=open(sys.argv[1],'rb').read();print(struct.unpack('>I',d[16:20])[0])" "$2")
  local s=$(( MAX / w )); [ "$s" -ge 1 ] || { echo "QR too big for this tape"; exit 1; }
  qrencode -m 2 -s "$s" -l M -o "$2" "$1"
}

print_one(){ # $1=png $2=name $3=serial
  # Compose a compact label: QR on top, name + serial underneath (short labels).
  local lbl="${1%.png}-label.png"
  python3 compose.py "$1" "$lbl" "$MAX" "${2:-}" "${3:-}"
  if [ "$DRY" = 1 ]; then
    echo "dry-run: $lbl  (${2:-ad-hoc})"
    return
  fi
  "$PT" --image "$lbl"
}

if [ -n "$ADHOC" ]; then
  make_qr "$ADHOC" "$OUT/adhoc.png"
  print_one "$OUT/adhoc.png"
  exit 0
fi

BASE_URL="${BASE_URL:-$(cat base-url.txt 2>/dev/null || true)}"
BASE_URL="${BASE_URL%/}"
[ -n "$BASE_URL" ] || { echo "Set BASE_URL env var or put the deployed app URL in labels/base-url.txt"; exit 1; }

match_lines(){
  if [ "$ALL" = 1 ]; then cat items.tsv; return; fi
  local q hits
  for q in "${ARGS[@]}"; do
    hits=$(grep -i -- "$q" items.tsv || true)
    if [ -z "$hits" ]; then echo "No item matches: $q" >&2; exit 1; fi
    if [ "$(wc -l <<<"$hits")" -gt 1 ]; then
      echo "Ambiguous \"$q\" — matches:" >&2; cut -f2,3 <<<"$hits" >&2; exit 1
    fi
    echo "$hits"
  done
}

[ "$ALL" = 1 ] || [ "${#ARGS[@]}" -gt 0 ] || { echo "Nothing to print. See usage at top of script."; exit 1; }

# Compose every requested label, then print them as ONE strip with dotted
# cut-marks between labels — the printer's feed-to-cutter blank happens once
# per batch instead of after every label.
LABELS=()
while IFS=$'\t' read -r id name serial; do
  [ -n "$id" ] || continue
  png="$OUT/$id.png"
  make_qr "$BASE_URL/?scan=$id" "$png"
  lbl="$OUT/$id-label.png"
  python3 compose.py "$png" "$lbl" "$MAX" "$name" "$serial"
  echo "Queued: $name ${serial:+(SN $serial)}"
  LABELS+=("$lbl")
done < <(match_lines)

STRIP="$OUT/strip.png"
python3 concat.py "$STRIP" "${LABELS[@]}"
if [ "$DRY" = 1 ]; then
  echo "dry-run: $STRIP"
else
  "$PT" --image "$STRIP"
fi
