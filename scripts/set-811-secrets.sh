#!/usr/bin/env bash
# Push the 811 automation secrets into Firebase Secret Manager. Run once per
# project (and again whenever a value rotates). Values are read from your shell
# so they never land in git — export them first or paste when prompted.
#
#   ITIC_USERNAME   ITIC portal login (e.g. wkeesee@northskyComm.com)
#   ITIC_PASSWORD   ITIC portal password
#   GEMINI_API_KEY  Google AI Studio key for marking-instruction generation
#   SMARTSHEET_ACCESS_TOKEN  Smartsheet API token (Master Schedule write-back)
#   PUSHOVER_TOKEN  Pushover application token (optional — phone push)
#   PUSHOVER_USER   Pushover user/group key (optional)
#
# Usage:
#   ITIC_USERNAME=... ITIC_PASSWORD=... GEMINI_API_KEY=... \
#   SMARTSHEET_ACCESS_TOKEN=... ./scripts/set-811-secrets.sh
set -euo pipefail

REQUIRED=(ITIC_USERNAME ITIC_PASSWORD GEMINI_API_KEY SMARTSHEET_ACCESS_TOKEN)
OPTIONAL=(PUSHOVER_TOKEN PUSHOVER_USER)

set_secret() {
  local name="$1" value="$2"
  if [[ -z "$value" ]]; then
    echo "  skip $name (empty)"
    return
  fi
  printf '%s' "$value" | firebase functions:secrets:set "$name" --data-file - >/dev/null
  echo "  set  $name"
}

echo "Setting required 811 secrets…"
for name in "${REQUIRED[@]}"; do
  value="${!name:-}"
  if [[ -z "$value" ]]; then
    read -rsp "  enter $name: " value; echo
  fi
  set_secret "$name" "$value"
done

echo "Setting optional secrets (blank to skip)…"
for name in "${OPTIONAL[@]}"; do
  set_secret "$name" "${!name:-}"
done

echo "Done. Redeploy functions to pick up new values: npm --prefix functions run deploy"
