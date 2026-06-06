#!/usr/bin/env bash
# Back up a running Inclination stack: a Postgres logical dump + a mirror of the
# MinIO bucket, into backups/<timestamp>/.
#
#   backups/<timestamp>/db.sql      — pg_dump of the application database
#   backups/<timestamp>/minio/      — full copy of the MinIO bucket objects
#
# Run against the live compose stack (services must be up):
#   scripts/backup.sh
#
# Restore with: scripts/restore.sh backups/<timestamp>
#
# Nightly cron suggestion (keep ~14 days, prune older):
#   0 3 * * * cd /opt/inclination && ./scripts/backup.sh >> backups/backup.log 2>&1 \
#     && find backups -maxdepth 1 -type d -mtime +14 -exec rm -rf {} +
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

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

STAMP="$(date +%Y%m%d-%H%M%S)"
DEST="backups/${STAMP}"
mkdir -p "${DEST}/minio"

echo "=== Inclination backup -> ${DEST} ==="

# --- Postgres ---------------------------------------------------------------
echo "--- dumping Postgres (${PG_DB}) ---"
docker compose exec -T postgres pg_dump -U "${PG_USER}" -d "${PG_DB}" \
  --clean --if-exists --no-owner --no-privileges > "${DEST}/db.sql"
echo "    wrote ${DEST}/db.sql ($(wc -c < "${DEST}/db.sql") bytes)"

# --- MinIO bucket -----------------------------------------------------------
# Mirror the bucket to the host using a throwaway mc container that joins the
# compose network and mounts the destination dir. mc reaches MinIO at the
# service name "minio" on the project's default network. We resolve the actual
# network the minio container is attached to (robust to project-name changes).
echo "--- mirroring MinIO bucket (${BUCKET}) ---"
MINIO_CID="$(docker compose ps -q minio)"
if [ -z "${MINIO_CID}" ]; then
  echo "ERROR: minio service is not running (start the stack first)." >&2
  exit 1
fi
NETWORK="$(docker inspect -f '{{range $k, $_ := .NetworkSettings.Networks}}{{$k}}{{end}}' "${MINIO_CID}")"
docker run --rm \
  --network "${NETWORK}" \
  -v "${ROOT}/${DEST}/minio:/backup" \
  --entrypoint /bin/sh \
  minio/mc:latest -c "
    set -e
    mc alias set src http://minio:9000 '${MINIO_USER}' '${MINIO_PW}' >/dev/null
    mc mirror --overwrite --remove src/'${BUCKET}' /backup
  "
echo "    mirrored bucket to ${DEST}/minio"

echo "=== backup complete: ${DEST} ==="
