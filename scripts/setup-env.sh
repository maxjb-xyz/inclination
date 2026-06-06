#!/usr/bin/env bash
# Configure .env for a self-hosted deployment.
#
# - Copies .env.example -> .env if .env is absent.
# - Generates strong random values for the secrets that ship blank or with a
#   known dev default: JWT_ACCESS_SECRET, POSTGRES_PASSWORD, MINIO_ROOT_PASSWORD,
#   S3_SECRET_KEY — and keeps DATABASE_URL + the S3 creds consistent with them.
# - Idempotent-ish: a value that is already set to a non-default, non-empty
#   secret is left untouched, so re-running won't rotate live credentials.
#
# Usage: scripts/setup-env.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ENV_FILE=".env"
EXAMPLE_FILE=".env.example"

# Known weak dev defaults we should overwrite when first configuring.
DEV_PW="inclination_dev_pw"

gen_secret() {
  # 48 random bytes, base64, URL-safe-ish (strip newlines and characters that
  # would need escaping inside DATABASE_URL / docker env values).
  head -c 48 /dev/urandom | base64 | tr -d '\n' | tr '+/' '-_' | tr -d '='
}

if [ ! -f "$EXAMPLE_FILE" ]; then
  echo "ERROR: $EXAMPLE_FILE not found (run from the repo root)." >&2
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  cp "$EXAMPLE_FILE" "$ENV_FILE"
  echo "Created $ENV_FILE from $EXAMPLE_FILE."
else
  echo "$ENV_FILE already exists; updating only blank/default secrets."
fi

# Read the current value of KEY from .env (empty string if unset/blank).
current() {
  local key="$1"
  sed -n "s/^${key}=//p" "$ENV_FILE" | head -n1
}

# Set KEY=VALUE in .env (replace existing line, else append).
set_kv() {
  local key="$1" val="$2" tmp
  # Escape the replacement for sed (the generated secrets are URL-safe base64,
  # but be safe with & and \).
  local esc
  esc=$(printf '%s' "$val" | sed -e 's/[&\\/]/\\&/g')
  if grep -q "^${key}=" "$ENV_FILE"; then
    tmp="$(mktemp)"
    sed "s/^${key}=.*/${key}=${esc}/" "$ENV_FILE" > "$tmp"
    mv "$tmp" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$val" >> "$ENV_FILE"
  fi
}

# Returns 0 if the current value looks like a placeholder we should replace.
needs_value() {
  local val="$1"
  [ -z "$val" ] || [ "$val" = "$DEV_PW" ] || [ "$val" = "dev_access_secret_change_me" ]
}

# --- JWT signing secret -------------------------------------------------------
if needs_value "$(current JWT_ACCESS_SECRET)"; then
  set_kv JWT_ACCESS_SECRET "$(gen_secret)"
  echo "  set JWT_ACCESS_SECRET"
else
  echo "  kept JWT_ACCESS_SECRET (already configured)"
fi

# --- Postgres password (+ DATABASE_URL) --------------------------------------
PG_USER="$(current POSTGRES_USER)"; PG_USER="${PG_USER:-inclination}"
PG_DB="$(current POSTGRES_DB)"; PG_DB="${PG_DB:-inclination}"
PG_PW="$(current POSTGRES_PASSWORD)"
if needs_value "$PG_PW"; then
  PG_PW="$(gen_secret)"
  set_kv POSTGRES_PASSWORD "$PG_PW"
  set_kv DATABASE_URL "postgresql://${PG_USER}:${PG_PW}@postgres:5432/${PG_DB}?schema=public"
  echo "  set POSTGRES_PASSWORD + DATABASE_URL"
else
  echo "  kept POSTGRES_PASSWORD (already configured)"
fi

# --- MinIO root password (= S3 secret key; same identity) ---------------------
MINIO_PW="$(current MINIO_ROOT_PASSWORD)"
if needs_value "$MINIO_PW"; then
  MINIO_PW="$(gen_secret)"
  set_kv MINIO_ROOT_PASSWORD "$MINIO_PW"
  # The API talks to MinIO with the root creds; keep S3_SECRET_KEY in lockstep.
  set_kv S3_SECRET_KEY "$MINIO_PW"
  echo "  set MINIO_ROOT_PASSWORD + S3_SECRET_KEY"
else
  echo "  kept MINIO_ROOT_PASSWORD (already configured)"
fi

# Keep S3_ACCESS_KEY aligned with the MinIO root user (access identity).
MINIO_USER="$(current MINIO_ROOT_USER)"; MINIO_USER="${MINIO_USER:-inclination}"
set_kv S3_ACCESS_KEY "$MINIO_USER"

echo
echo "Done. Review $ENV_FILE, then: docker compose up -d --build"
