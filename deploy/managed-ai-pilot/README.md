# Managed-AI pilot deployment

This deployment is a time-bounded adapter for the invited-user pilot. It owns entitlement and usage facts only; it is not a ledger, account service, generic OpenAI proxy, or fallback.

## Server layout

- Application: `/var/bookkeeping-managed-ai-pilot`
- Source snapshot: `/var/bookkeeping-managed-ai-pilot/source`
- Compose: `/var/bookkeeping-managed-ai-pilot/docker-compose.yml`
- Secret environment: `/var/bookkeeping-managed-ai-pilot/.env` (mode `0600`, never committed)
- SQLite metadata: `/var/bookkeeping-managed-ai-pilot/data/pilot.sqlite`
- Local listener: `127.0.0.1:18084`
- Public edge: `/var/ho-cake/https-proxy/nginx.conf`
- Release image pointer: `/var/bookkeeping-managed-ai-pilot/.release.env`
- Rollout command: `/usr/local/sbin/deploy-bookkeeping-managed-ai-pilot`

## GitHub Actions release contract

`.github/workflows/managed-ai-pilot.yml` is the only production release path. Pull requests run repository gates and build the image without pushing. A push to `main` additionally pushes immutable `main-<short-sha>` and moving `main` tags to `registry.cn-hangzhou.aliyuncs.com/xiagan/bookkeeping-managed-ai-pilot`, then invokes the restricted server rollout command with the immutable tag.

The server never builds from a copied source tree. It retains secrets and SQLite locally, pulls the selected image, recreates only the `managed-ai-pilot` Compose service, waits for health, runs public smoke checks, and restores the previous `.release.env` image if rollout fails. Nginx/certbot and every ho-extract container are outside this workflow.

Required GitHub Actions secret names:

- `ALIYUN_DOCKER_USERNAME`
- `ALIYUN_DOCKER_PASSWORD`
- `ECS_HOST`
- `ECS_SSH_KEY`

## Environment variable names

Required secrets:

- `PILOT_INVITE_HASH_PEPPER`
- `PILOT_UPSTREAM_API_KEY`
- `PILOT_ADMIN_PASSWORD`

Administrator configuration:

- `PILOT_PUBLIC_ORIGIN`
- `PILOT_ADMIN_USERNAME`
- `PILOT_ADMIN_RATE_PER_MINUTE`

Required/frozen upstream configuration:

- `PILOT_UPSTREAM_BASE_URL`
- `PILOT_UPSTREAM_MODEL`

Runtime and entitlement configuration:

- `PILOT_HOST`
- `PILOT_PORT`
- `PILOT_DATABASE_PATH`
- `PILOT_ENTITLEMENT_DAYS`
- `PILOT_ENTITLEMENT_TOTAL`
- `PILOT_ENTITLEMENT_DAILY`
- `PILOT_ACCESS_TOKEN_TTL_SECONDS`
- `PILOT_USER_RATE_PER_MINUTE`
- `PILOT_GLOBAL_RATE_PER_MINUTE`
- `PILOT_USER_CONCURRENCY`
- `PILOT_GLOBAL_CONCURRENCY`
- `PILOT_ACTIVATE_RATE_PER_MINUTE`
- `PILOT_FEEDBACK_RATE_PER_MINUTE`
- `PILOT_RESERVATION_TTL_SECONDS`
- `PILOT_UPSTREAM_TIMEOUT_MS`
- `PILOT_MAX_COMPLETION_TOKENS`
- `PILOT_MAX_BODY_BYTES`
- `PILOT_QUOTA_TIMEZONE`
- `PILOT_LOG_LEVEL`

`PILOT_HOST` must remain `0.0.0.0` inside the container while Compose exposes it only as `127.0.0.1:18084` on the host. Default entitlement is 30 days / 200 successful parses with a configured daily cap.

## Invite operations

The authenticated operator UI is available at `https://bookkeeping.holic.work/admin`. Every invite must be issued with a recipient label. The label is private operations metadata and is never sent to the mobile client, DeepSeek, or business logs.

The UI is the primary issue/reconciliation path. The server CLI remains available for recovery; it issues one high-entropy invite with a required recipient label. Plaintext is printed once and is not stored:

```sh
docker compose run --rm managed-ai-pilot node dist/admin.js issue-invite '<recipient-label>'
```

Send each code to one tester through a separate private channel. Do not put codes in issue trackers, chat rooms, screenshots, logs, analytics, or the repository.

The operator UI lists opaque invite IDs, recipient labels, activation/revocation state, entitlements, and per-invite/per-request prompt, completion, total, cache-hit, and cache-miss tokens. It never shows an invite code again after issuance.

After a rollout, run `./smoke-feedback.sh`. It creates and soft-revokes a labeled smoke invite, verifies authenticated feedback read/update, confirms zero parse quota consumption, and checks revoked/unauthorized behavior without printing credentials or invite plaintext. After the revoke check, this dedicated operations script hard-deletes only metadata whose recipient label starts with `自动验收-付费意愿-`, so test feedback never contaminates real willingness counts; business APIs retain soft-revoke semantics.

Pass optional days/total/daily arguments to validate a custom invite snapshot, for example `./smoke-feedback.sh /var/bookkeeping-managed-ai-pilot https://bookkeeping.holic.work 45 500 35`.

Revoke one invite and all credentials/entitlement bound to it:

```sh
docker compose run --rm managed-ai-pilot node dist/admin.js revoke-invite '<invite-code>'
```

## Certificate gate

Before certificate issuance, both Cloudflare and Google DoH must return `47.83.182.85` for `bookkeeping.holic.work`. Until then only the bootstrap HTTP server block may be prepared; do not install the TLS block or claim public availability.

After DNS is correct, issue with the existing webroot:

```sh
certbot certonly --webroot -w /var/ho-cake/https-proxy/acme \
  -d bookkeeping.holic.work --agree-tos --non-interactive
```

Then replace the bootstrap server block with `nginx-https.conf`, validate the entire edge config, and reload `public-https-proxy`. Existing `certbot-renew.timer` and `/etc/letsencrypt/renewal-hooks/deploy/reload-public-https-proxy.sh` own renewal/reload.

## Rollback

1. Run the rollout command with the previous immutable ACR image tag. It updates only `.release.env` and the pilot service.
2. Restore a timestamped SQLite backup only when explicitly rolling back a migration; this discards newer entitlement/usage/feedback metadata and is not the default image rollback.
3. Edge Nginx is not part of ordinary application rollback. Keep the pilot SQLite directory until retention is separately approved.
