#!/bin/sh
# Re-fetch the csbootcamp fixtures (read-only `gh api`, no clone). See csbootcamp/SOURCE.txt.
set -e
P="$(dirname "$0")/csbootcamp"
SHA=e05b3505f22acbb95ed4531204e08991d29a7da9
mkdir -p "$P/_lib/Check" "$P/01-language-core/exercises" "$P/01-language-core/solutions"
for f in _lib/Check/Check.cs _lib/Check/Check.csproj _lib/FORMAT.md 01-language-core/exercises/01-count-vowels.cs 01-language-core/solutions/01-count-vowels.cs; do
  gh api "repos/elirc/csbootcamp/contents/bootcamp/$f?ref=$SHA" -H "Accept: application/vnd.github.raw" > "$P/$f"
done
