#!/bin/sh
# Writes the recipe corpus of the local database, and its pictures, to a directory outside the
# repository, ready to load into a server. Loading the same export twice changes nothing.
#
#   infra/corpus-export.sh <directory>
#
# It also packs both into corpus.tar.gz. To load it, put the archive behind a private link that
# expires and set CORPUS_URL to that link on the server; the backup service loads it at start.
set -eu

out=${1:?usage: infra/corpus-export.sh <directory outside the repository>}
root=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
mkdir -p "$out"
case "$(cd "$out" && pwd -P)/" in
  "$root"/*) echo "the export must not be written inside the repository" >&2; exit 1 ;;
esac

tables="ingredients ingredient_substitutes device_profiles recipes recipe_versions recipe_ingredients recipe_device_variants recipe_images"
flags=""
for table in $tables; do flags="$flags --table=$table"; done

# Rows that are already on the server are left as they are. Triggers are off during the load
# because a recipe and its current version point at each other.
# shellcheck disable=SC2086
docker compose --env-file "$root/.env" -f "$root/infra/docker-compose.yml" exec -T postgres \
  pg_dump -U snapcook -d snapcook --data-only --inserts --on-conflict-do-nothing \
  --disable-triggers $flags > "$out/corpus.sql"

mkdir -p "$out/images"
cp "$root"/data/images/*.webp "$out/images/"
tar -czf "$out/corpus.tar.gz" -C "$out" corpus.sql images
echo "wrote $(grep -c '^INSERT' "$out/corpus.sql") rows and $(ls "$out/images" | wc -l | tr -d ' ') pictures to $out"
