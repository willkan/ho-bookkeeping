import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '../../..');
const workflow = readFileSync(join(root, '.github/workflows/managed-ai-pilot.yml'), 'utf8');
const compose = readFileSync(join(root, 'deploy/managed-ai-pilot/docker-compose.yml'), 'utf8');
const rollout = readFileSync(join(root, 'deploy/managed-ai-pilot/rollout.sh'), 'utf8');
const dockerignore = readFileSync(join(root, '.dockerignore'), 'utf8');

describe('managed pilot GitHub Actions deployment contract', () => {
  it('gates, builds and pushes one immutable linux-amd64 image before deployment', () => {
    expect(workflow).toContain('needs: verify');
    for (const gate of ['format:check', 'npm run lint', 'npm run typecheck', 'npm test']) {
      expect(workflow).toContain(gate);
    }
    expect(workflow).toContain('platforms: linux/amd64');
    expect(workflow).toContain(':main-${short_sha}');
    expect(workflow).toContain("push: ${{ github.event_name != 'pull_request' }}");
  });

  it('deploys only the managed pilot through a restricted immutable-image rollout', () => {
    expect(workflow).toContain('sudo /usr/local/sbin/deploy-bookkeeping-managed-ai-pilot');
    expect(rollout).toContain('bookkeeping-managed-ai-pilot:main-[0-9a-f]{7}');
    expect(rollout).toContain('--no-deps --force-recreate managed-ai-pilot');
    expect(rollout).toContain('pilot_restore');
    expect(rollout).not.toMatch(/docker compose down|--remove-orphans|docker image prune/);
  });

  it('keeps server secrets, SQLite, Nginx and ho-extract outside image and rollout mutations', () => {
    expect(compose).toContain('env_file:\n      - .env');
    expect(compose).toContain('./data:/app/data');
    expect(dockerignore).toContain('**/.env*');
    expect(dockerignore).toContain('**/*.sqlite*');
    expect(workflow).not.toMatch(/nginx|certbot|ho-extract/);
    expect(rollout).not.toMatch(/nginx|certbot|ho-extract/);
  });

  it('removes server-side source builds from the production Compose contract', () => {
    expect(compose).toContain('image: ${PILOT_IMAGE:?');
    expect(compose).not.toMatch(/\bbuild:/);
    expect(workflow).toContain('file: services/managed-ai-pilot/Dockerfile');
  });
});
