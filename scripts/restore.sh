#!/usr/bin/env bash
# Restore an Inclination backup produced by scripts/backup.sh into the running
# compose stack: apply the Postgres dump and mirror the MinIO bucket back.
#
#   scripts/restore.sh backups/<timestamp>
#
# The stack must be up (postgres + minio healthy). The DB dump was taken with
# --clean --if-exists, so applying it drops and recreates the app's objects;
# existing data in the target database is replaced. MinIO is mirrored with
# --remove so the bucket ends up identical to the backup.
#
# WARNING: this overwrites current data. Take a fresh backup first if unsure.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SRC="${1:-}"
if [ -z "${SRC}" ]; then
  echo "Usage: scripts/restore.sh <backup-dir>   (e.g. backups/20260606-031500)" >&2
  exit 1
fi
# Allow either a relative or absolute path.
case "${SRC}" in /*) : ;; *) SRC="${ROOT}/${SRC}" ;; esac
[ -f "${SRC}/db.sql" ] || { echo "ERROR: ${SRC}/db.sql not found." >&2; exit 1; }
[ -d "${SRC}/minio" ] || { echo "ERROR: ${SRC}/minio not found." >&2; exit 1; }

# Read a single KEY from .env without sourcing it (values may contain shell
# metacharacters like the <...> in MAIL_FROM, which `source` would choke on).
envval() {
  [ -f .env ] || return 0
  sed -n "s/^$1=//p" .env | head -n1
}
PG_USER="$(envval POSTGRES_USER)"; PG_USER="${PG_USER:-inclination}"
PG_DB="$(envval POSTGRES_DB)"; PG_DB="${PG_DB:-inclination}"
BUCKET="$(envval MINIO_BUCKET)"; BUCKET="${BUCKET:-inclination}"
MINIO_USER="$(envval MINIO_ROOT_USER)"; MINIO_USER="${MINIO_USER:-inclination}"
MINIO_PW="$(envval MINIO_ROOT_PASSWORD)"
[ -n "${MINIO_PW}" ] || { echo "ERROR: MINIO_ROOT_PASSWORD not set in .env" >&2; exit 1; }

echo "=== Inclination restore from ${SRC} ==="

# --- Postgres ---------------------------------------------------------------
echo "--- restoring Postgres (${PG_DB}) ---"
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U "${PG_USER}" -d "${PG_DB}" < "${SRC}/db.sql"
echo "    database restored"

# --- MinIO bucket -----------------------------------------------------------
echo "--- mirroring MinIO bucket back (${BUCKET}) ---"
MINIO_CID="$(docker compose ps -q minio)"
if [ -z "${MINIO_CID}" ]; then
  echo "ERROR: minio service is not running (start the stack first)." >&2
  exit 1
fi
NETWORK="$(docker inspect -f '{{range $k, $_ := .NetworkSettings.Networks}}{{$k}}{{end}}' "${MINIO_CID}")"
docker run --rm \
  --network "${NETWORK}" \
  -v "${SRC}/minio:/backup:ro" \
  --entrypoint /bin/sh \
  minio/mc:latest -c "
    set -e
    mc alias set dst http://minio:9000 '${MINIO_USER}' '${MINIO_PW}' >/dev/null
    mc mb --ignore-existing dst/'${BUCKET}' >/dev/null
    mc mirror --overwrite --remove /backup dst/'${BUCKET}'
  "
echo "    bucket restored"

echo "=== restore complete ==="
echo "Tip: restart the app services so any cached state reloads:"
echo "  docker compose restart api sync"
