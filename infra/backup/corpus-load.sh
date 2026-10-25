#!/bin/sh
# Loads a corpus archive written by infra/corpus-export.sh from CORPUS_URL: the rows into the
# database, the pictures into /data/images. Rows that are already there do not change, so a
# second load of the same archive changes nothing.
set -eu

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

curl -fsS "$CORPUS_URL" | tar -xz -C "$work"
psql --quiet --set ON_ERROR_STOP=1 --file="$work/corpus.sql" >/dev/null
mkdir -p /data/images
cp "$work"/images/* /data/images/
echo "corpus load: $(grep -c '^INSERT' "$work/corpus.sql") rows and $(ls "$work/images" | wc -l | tr -d ' ') pictures loaded"
