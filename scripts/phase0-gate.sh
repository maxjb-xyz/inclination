#!/usr/bin/env bash
# Phase 0 "Done when" gate: a clean `docker compose up` boots all services
# healthy and /health + /ready pass for API and sync. Reproducible from scratch.
#
# Usage: scripts/phase0-gate.sh
# Requires: docker, docker compose, curl. Run from the repo root.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PORT="${CADDY_HTTP_PORT:-8080}"
BASE="http://localhost:${PORT}"

cleanup() {
  echo "--- tearing down ---"
  docker compose -f docker-compose.yml -f docker-compose.build.yml down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

[ -f .env ] || cp .env.example .env
# The containers run NODE_ENV=production, which requires a real JWT secret.
if ! grep -q '^JWT_ACCESS_SECRET=.\+' .env; then
  echo "JWT_ACCESS_SECRET=$(head -c 48 /dev/urandom | base64 | tr -d '\n')" >> .env
fi

echo "=== building + starting stack ==="
# Build the images from source (the base compose pulls prebuilt GHCR images).
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build

echo "=== waiting for api + sync to report healthy ==="
deadline=$(( $(date +%s) + 180 ))
while true; do
  api_state=$(docker inspect -f '{{.State.Health.Status}}' inclination-api-1 2>/dev/null || echo "starting")
  sync_state=$(docker inspect -f '{{.State.Health.Status}}' inclination-sync-1 2>/dev/null || echo "starting")
  echo "api=${api_state} sync=${sync_state}"
  if [ "$api_state" = "healthy" ] && [ "$sync_state" = "healthy" ]; then
    break
  fi
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "TIMED OUT waiting for healthy services"
    docker compose -f docker-compose.yml -f docker-compose.build.yml ps
    exit 1
  fi
  sleep 3
done

fail=0
check() {
  local path="$1"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" "${BASE}${path}")
  if [ "$code" = "200" ]; then
    echo "PASS  ${path} -> ${code}"
  else
    echo "FAIL  ${path} -> ${code}"
    fail=1
  fi
}

echo "=== gate assertions ==="
check /api/health
check /api/ready
check /sync/health
check /sync/ready
check /

if [ "$fail" -ne 0 ]; then
  echo "=== GATE FAILED ==="
  exit 1
fi

echo "=== GATE PASSED ==="
