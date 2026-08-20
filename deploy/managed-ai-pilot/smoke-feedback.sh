#!/usr/bin/env bash
set -euo pipefail

pilot_deploy_dir=${1:-/var/bookkeeping-managed-ai-pilot}
pilot_base_url=${2:-http://127.0.0.1:18084}
cd "$pilot_deploy_dir"

pilot_admin_user=$(sed -n 's/^PILOT_ADMIN_USERNAME=//p' .env)
pilot_admin_password=$(sed -n 's/^PILOT_ADMIN_PASSWORD=//p' .env)
pilot_origin=$(sed -n 's/^PILOT_PUBLIC_ORIGIN=//p' .env)
pilot_default_days=$(sed -n 's/^PILOT_ENTITLEMENT_DAYS=//p' .env)
pilot_default_total=$(sed -n 's/^PILOT_ENTITLEMENT_TOTAL=//p' .env)
pilot_default_daily=$(sed -n 's/^PILOT_ENTITLEMENT_DAILY=//p' .env)
pilot_issue_days=${3:-$pilot_default_days}
pilot_issue_total=${4:-$pilot_default_total}
pilot_issue_daily=${5:-$pilot_default_daily}

pilot_admin_get() {
  curl -fsS -u "$pilot_admin_user:$pilot_admin_password" "$pilot_base_url$1"
}

pilot_admin_post() {
  curl -fsS -u "$pilot_admin_user:$pilot_admin_password" \
    -H "origin: $pilot_origin" -H 'content-type: application/json' \
    --data "$2" "$pilot_base_url$1"
}

pilot_purge_smoke_data() {
  python3 - "$pilot_deploy_dir/data/pilot.sqlite" <<'PY'
import sqlite3
import sys

database = sqlite3.connect(sys.argv[1], timeout=5)
database.execute("PRAGMA foreign_keys = ON")
subjects = [
    row[0]
    for row in database.execute(
        "SELECT subject_id FROM invites WHERE recipient_label LIKE '自动验收-付费意愿-%' AND subject_id IS NOT NULL"
    )
]
with database:
    for subject in subjects:
        database.execute("DELETE FROM access_tokens WHERE subject_id = ?", (subject,))
        database.execute("DELETE FROM usage_requests WHERE subject_id = ?", (subject,))
        database.execute("DELETE FROM pilot_feedback WHERE subject_id = ?", (subject,))
        database.execute("DELETE FROM entitlements WHERE subject_id = ?", (subject,))
    database.execute("DELETE FROM invites WHERE recipient_label LIKE '自动验收-付费意愿-%'")
    for subject in subjects:
        database.execute("DELETE FROM subjects WHERE id = ?", (subject,))
database.close()
PY
}

# Dedicated operational cleanup: smoke metadata must never affect real willingness counts.
pilot_purge_smoke_data

pilot_label="自动验收-付费意愿-$(date -u +%Y%m%dT%H%M%SZ)"
pilot_issue=$(pilot_admin_post /admin/api/invites "{\"recipient_label\":\"$pilot_label\",\"entitlement_days\":$pilot_issue_days,\"total_limit\":$pilot_issue_total,\"daily_limit\":$pilot_issue_daily}")
pilot_code=$(printf '%s' "$pilot_issue" | python3 -c 'import json,sys; print(json.load(sys.stdin)["inviteCode"])')
pilot_invite=$(printf '%s' "$pilot_issue" | python3 -c 'import json,sys; print(json.load(sys.stdin)["inviteId"])')

pilot_cleanup() {
  pilot_admin_post "/admin/api/invites/$pilot_invite/revoke" '{}' >/dev/null || true
  pilot_purge_smoke_data || true
}
trap pilot_cleanup EXIT

pilot_activation=$(curl -fsS "$pilot_base_url/activate" \
  -H 'content-type: application/json' -H 'x-request-id: smoke_activate_feedback' \
  --data "{\"invite_code\":\"$pilot_code\",\"activation_id\":\"installation_feedback_smoke_20260820\"}")
pilot_token=$(printf '%s' "$pilot_activation" | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')
pilot_subject=$(printf '%s' "$pilot_activation" | python3 -c 'import json,sys; print(json.load(sys.stdin)["subject_id"])')
printf '%s' "$pilot_activation" | python3 -c 'import json,sys
body=json.load(sys.stdin)
assert body["entitlement"]["total_limit"] == int(sys.argv[1])
assert body["entitlement"]["daily_limit"] == int(sys.argv[2])' "$pilot_issue_total" "$pilot_issue_daily"

pilot_before=$(curl -fsS "$pilot_base_url/feedback" \
  -H "authorization: Bearer $pilot_token" -H 'x-request-id: smoke_feedback_before')
printf '%s' "$pilot_before" | python3 -c 'import json,sys
body=json.load(sys.stdin)
assert body["willingness"] is None and body["updated_at"] is None'

pilot_saved=$(curl -fsS -X PUT "$pilot_base_url/feedback" \
  -H "authorization: Bearer $pilot_token" -H 'content-type: application/json' \
  -H 'x-request-id: smoke_feedback_save' --data '{"willingness":"willing"}')
printf '%s' "$pilot_saved" | python3 -c 'import json,sys
body=json.load(sys.stdin)
assert body["willingness"] == "willing" and isinstance(body["updated_at"], str)'

pilot_after=$(curl -fsS "$pilot_base_url/feedback" \
  -H "authorization: Bearer $pilot_token" -H 'x-request-id: smoke_feedback_after')
printf '%s' "$pilot_after" | python3 -c 'import json,sys; assert json.load(sys.stdin)["willingness"] == "willing"'

pilot_overview=$(pilot_admin_get /admin/api/overview)
printf '%s' "$pilot_overview" | python3 -c 'import json,sys
subject=sys.argv[1]
invite=next(item for item in json.load(sys.stdin)["invites"] if item.get("subjectId") == subject)
assert invite["willingness"] == "willing"
assert invite["consumedTotal"] == 0 and invite["successfulRequests"] == 0' "$pilot_subject"

pilot_unauthorized=$(curl -sS -o /dev/null -w '%{http_code}' "$pilot_base_url/feedback")
test "$pilot_unauthorized" = 401
pilot_admin_post "/admin/api/invites/$pilot_invite/revoke" '{}' >/dev/null
pilot_revoked=$(curl -sS -o /dev/null -w '%{http_code}' "$pilot_base_url/feedback" \
  -H "authorization: Bearer $pilot_token")
test "$pilot_revoked" = 401
pilot_purge_smoke_data
trap - EXIT

printf 'feedback_smoke=ok quota_consumed=0 unauthorized=%s revoked=%s\n' \
  "$pilot_unauthorized" "$pilot_revoked"
