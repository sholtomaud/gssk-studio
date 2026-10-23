#!/bin/sh
# Re-vendor GSSK from a commit on its `dist` branch and rewrite the pin
# (SPEC §15, ADR 0002). Upgrading the kernel is a deliberate PR:
#
#   npm run gssk:update -- <dist-commit-sha>
#   npm run gssk:verify && npm test
set -eu

REPO="${GSSK_REPO:-https://github.com/energese-project/GSSK-Giannantoni}"
REF="${1:?usage: npm run gssk:update -- <dist-commit-sha>}"
DEST="vendor/gssk"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

git clone --quiet --branch dist --single-branch "$REPO" "$TMP/gssk"
git -C "$TMP/gssk" checkout --quiet "$REF"
COMMIT="$(git -C "$TMP/gssk" rev-parse HEAD)"
VERSION="$(node -p "require('$TMP/gssk/package.json').version")"

cp "$TMP/gssk/dist/gssk.wasm" "$TMP/gssk/dist/gssk.js" "$TMP/gssk/dist/gssk.d.ts" \
   "$TMP/gssk/dist/gssk.schema.json" "$TMP/gssk/include/gssk.h" "$DEST/"

REPO="$REPO" COMMIT="$COMMIT" VERSION="$VERSION" node --input-type=module -e '
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
const files = ["gssk.wasm", "gssk.js", "gssk.d.ts", "gssk.h", "gssk.schema.json"];
const sha256 = Object.fromEntries(files.map((f) => [f,
  createHash("sha256").update(readFileSync(`vendor/gssk/${f}`)).digest("hex")]));
const pin = { repo: process.env.REPO, branch: "dist", commit: process.env.COMMIT,
  tag: null, version: process.env.VERSION, sha256 };
writeFileSync("vendor/gssk/GSSK_PIN.json", JSON.stringify(pin, null, 2) + "\n");
'
echo "Pinned GSSK $VERSION at dist@$COMMIT. Review the diff, run the tests, open a PR."
