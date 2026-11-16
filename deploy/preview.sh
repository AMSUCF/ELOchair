#!/usr/bin/env bash
# Upload only the static design study, from a manually started GitHub Actions job.
set -euo pipefail

for setting in DEPLOY_SSH_KEY DEPLOY_KNOWN_HOSTS DEPLOY_HOST DEPLOY_USER DEPLOY_PATH PREVIEW_URL; do
  if [[ -z "${!setting:-}" ]]; then
    printf 'Missing GitHub Actions setting: %s\n' "$setting" >&2
    exit 1
  fi
done

if [[ "$DEPLOY_HOST" != 'jtm.io' ]]; then
  printf 'DEPLOY_HOST must be jtm.io for this preview deployment.\n' >&2
  exit 1
fi
if [[ ! "$DEPLOY_USER" =~ ^[a-z_][a-z0-9_-]*$ ]]; then
  printf 'DEPLOY_USER must be a server account name.\n' >&2
  exit 1
fi
# Reserve a separate folder so this cannot overwrite an existing site homepage.
if [[ ! "$DEPLOY_PATH" =~ ^/[a-zA-Z0-9_./-]+/elochair-design-preview/?$ ]] ||
  [[ "/${DEPLOY_PATH#/}/" == *'/../'* || "/${DEPLOY_PATH#/}/" == *'/./'* ]]; then
  printf 'DEPLOY_PATH must be an absolute path ending in /elochair-design-preview.\n' >&2
  exit 1
fi
DEPLOY_PORT="${DEPLOY_PORT:-22}"
if [[ ! "$DEPLOY_PORT" =~ ^[0-9]{1,5}$ ]] ||
  (( 10#$DEPLOY_PORT < 1 || 10#$DEPLOY_PORT > 65535 )); then
  printf 'DEPLOY_PORT must be a valid SSH port.\n' >&2
  exit 1
fi
if [[ ! "$PREVIEW_URL" =~ ^https://([a-zA-Z0-9-]+\.)*jtm\.io/[a-zA-Z0-9_./-]+/?$ ]]; then
  printf 'PREVIEW_URL must be the public HTTPS preview URL on jtm.io or a subdomain.\n' >&2
  exit 1
fi

preview_source="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../docs/design/visitor-preview" && pwd)"
umask 077
preview_temp="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/elochair-preview.XXXXXX")"
trap 'rm -rf -- "$preview_temp"' EXIT

printf '%s\n' "$DEPLOY_SSH_KEY" > "$preview_temp/key"
printf '%s\n' "$DEPLOY_KNOWN_HOSTS" > "$preview_temp/known_hosts"
unset DEPLOY_SSH_KEY DEPLOY_KNOWN_HOSTS
if ! ssh-keygen -y -P '' -f "$preview_temp/key" > /dev/null 2>&1; then
  printf 'DEPLOY_SSH_KEY must contain an SSH private key usable without a passphrase.\n' >&2
  exit 1
fi

cat > "$preview_temp/ssh-config" <<EOF
Host elochair-preview
  HostName $DEPLOY_HOST
  User $DEPLOY_USER
  Port $DEPLOY_PORT
  IdentityFile "$preview_temp/key"
  UserKnownHostsFile "$preview_temp/known_hosts"
  StrictHostKeyChecking yes
  BatchMode yes
  IdentitiesOnly yes
  ConnectTimeout 15
EOF

preview_files=(index.html companion.svg conference.svg pathways.svg)
for preview_file in "${preview_files[@]}"; do
  install -m 644 -- "$preview_source/$preview_file" "$preview_temp/$preview_file"
done

ssh -F "$preview_temp/ssh-config" elochair-preview \
  "mkdir -p -- '$DEPLOY_PATH' && chmod 755 -- '$DEPLOY_PATH'"
for preview_file in "${preview_files[@]}"; do
  scp -F "$preview_temp/ssh-config" -p -- \
    "$preview_temp/$preview_file" "elochair-preview:${DEPLOY_PATH%/}/"
done

curl --fail --silent --show-error --location \
  --proto '=https' --proto-redir '=https' \
  --retry 3 --retry-delay 2 --max-time 20 \
  "${PREVIEW_URL}?preview_commit=${GITHUB_SHA:-manual}" \
  --output "$preview_temp/served.html"
if ! cmp -s "$preview_source/index.html" "$preview_temp/served.html"; then
  printf 'Upload finished, but PREVIEW_URL did not serve the uploaded design preview.\n' >&2
  exit 1
fi

printf 'Verified design preview: %s\n' "$PREVIEW_URL"
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  printf 'Published and verified the [design preview](%s).\n' "$PREVIEW_URL" >> "$GITHUB_STEP_SUMMARY"
fi
