#!/usr/bin/env bash
set -euo pipefail

pilot_image=${1:-}
pilot_registry_prefix='registry.cn-hangzhou.aliyuncs.com/xiagan/bookkeeping-managed-ai-pilot:main-'
pilot_deploy_dir='/var/bookkeeping-managed-ai-pilot'
pilot_release_file="$pilot_deploy_dir/.release.env"
pilot_compose_file="$pilot_deploy_dir/docker-compose.yml"
pilot_lock_file='/var/lock/bookkeeping-managed-ai-pilot-rollout.lock'

if [[ ! "$pilot_image" =~ ^registry\.cn-hangzhou\.aliyuncs\.com/xiagan/bookkeeping-managed-ai-pilot:main-[0-9a-f]{7}$ ]]; then
  printf 'rejected image reference\n' >&2
  exit 2
fi

exec 9>"$pilot_lock_file"
flock -n 9 || { printf 'another pilot rollout is active\n' >&2; exit 3; }

cd "$pilot_deploy_dir"
test -f .env
test -f "$pilot_compose_file"
test -f smoke-feedback.sh

pilot_previous_image=''
if test -f "$pilot_release_file"; then
  pilot_previous_image=$(sed -n 's/^PILOT_IMAGE=//p' "$pilot_release_file")
fi
pilot_timestamp=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p backups
python3 - data/pilot.sqlite "backups/pilot-pre-rollout-$pilot_timestamp.sqlite" <<'PY'
import sqlite3
import sys

source = sqlite3.connect(sys.argv[1], timeout=10)
target = sqlite3.connect(sys.argv[2])
with target:
    source.backup(target)
target.close()
source.close()
PY

pilot_restore() {
  if test -n "$pilot_previous_image"; then
    printf 'PILOT_IMAGE=%s\n' "$pilot_previous_image" > "$pilot_release_file"
    chmod 600 "$pilot_release_file"
    docker compose --env-file "$pilot_release_file" -f "$pilot_compose_file" up -d \
      --no-deps --force-recreate managed-ai-pilot || true
  fi
}
trap pilot_restore ERR

docker pull "$pilot_image"
printf 'PILOT_IMAGE=%s\n' "$pilot_image" > "$pilot_release_file"
chmod 600 "$pilot_release_file"
docker compose --env-file "$pilot_release_file" -f "$pilot_compose_file" up -d \
  --no-deps --force-recreate managed-ai-pilot

pilot_healthy=0
for _ in $(seq 1 45); do
  if curl -fsS --connect-timeout 2 http://127.0.0.1:18084/health >/dev/null; then
    pilot_healthy=1
    break
  fi
  sleep 2
done
if test "$pilot_healthy" -ne 1; then
  docker logs bookkeeping-managed-ai-pilot --tail 100 >&2 || true
  exit 4
fi

./smoke-feedback.sh "$pilot_deploy_dir" https://bookkeeping.holic.work
docker compose --env-file "$pilot_release_file" -f "$pilot_compose_file" ps
trap - ERR
printf 'deployed_image=%s\n' "$pilot_image"
