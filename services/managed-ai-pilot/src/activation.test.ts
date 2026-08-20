import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type PilotDatabase } from './database';
import { PilotError } from './errors';
import { PilotStore } from './store';
import { testConfig } from './test-support';

describe('managed pilot activation contract', () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

  function setup(): { db: PilotDatabase; store: PilotStore } {
    const directory = mkdtempSync(join(tmpdir(), 'bookkeeping-pilot-'));
    const db = openDatabase(join(directory, 'pilot.sqlite'));
    cleanups.push(() => {
      db.close();
      rmSync(directory, { recursive: true, force: true });
    });
    return { db, store: new PilotStore(db, testConfig()) };
  }

  it('activates an unused invite for one anonymous activation id', () => {
    const { store } = setup();
    const invite = store.issueInvite('测试用户甲');
    const result = store.activate(invite.inviteCode, 'installation_123456789');
    expect(result.subjectId).toMatch(/^sub_/);
    expect(store.authenticate(result.accessToken)).toEqual({
      subjectId: result.subjectId,
      inviteId: invite.inviteId,
    });
    expect(result.totalLimit).toBe(200);
  });

  it('freezes custom days, total and daily limits on the invite before activation', () => {
    const { db, store } = setup();
    const invite = store.issueInvite('定制额度用户', {
      entitlementDays: 45,
      totalLimit: 500,
      dailyLimit: 35,
    });
    const activated = store.activate(invite.inviteCode, 'installation_custom_123');
    expect(activated).toMatchObject({ totalLimit: 500, dailyLimit: 35 });
    const entitlement = db
      .prepare('SELECT starts_at, expires_at FROM entitlements WHERE subject_id = ?')
      .get(activated.subjectId) as { starts_at: number; expires_at: number };
    expect(entitlement.expires_at - entitlement.starts_at).toBe(45 * 86_400_000);
  });

  it('does not retroactively change issued invite limits when global defaults change', () => {
    const { db, store } = setup();
    const invite = store.issueInvite('冻结默认额度');
    const changedDefaults = new PilotStore(
      db,
      testConfig({ entitlementDays: 90, entitlementTotal: 999, entitlementDaily: 99 }),
    );
    expect(
      changedDefaults.activate(invite.inviteCode, 'installation_frozen_defaults'),
    ).toMatchObject({ totalLimit: 200, dailyLimit: 20 });
  });

  it('reissues a short-lived token for the same invite and activation id', () => {
    const { store } = setup();
    const invite = store.issueInvite('测试用户甲');
    const first = store.activate(invite.inviteCode, 'installation_123456789');
    const second = store.activate(invite.inviteCode, 'installation_123456789');
    expect(second.subjectId).toBe(first.subjectId);
    expect(second.accessToken).not.toBe(first.accessToken);
  });

  it('rejects reuse of an activated invite by another activation id', () => {
    const { store } = setup();
    const invite = store.issueInvite('测试用户甲');
    store.activate(invite.inviteCode, 'installation_123456789');
    expect(() => store.activate(invite.inviteCode, 'different_installation')).toThrowError(
      PilotError,
    );
  });

  it('rejects a revoked invite and entitlement', () => {
    const { store } = setup();
    const invite = store.issueInvite('测试用户甲');
    const activated = store.activate(invite.inviteCode, 'installation_123456789');
    store.revokeInvite(invite.inviteCode);
    expect(() => store.authenticate(activated.accessToken)).toThrowError(PilotError);
    expect(() => store.activate(invite.inviteCode, 'installation_123456789')).toThrowError(
      PilotError,
    );
  });

  it('never persists plaintext invite codes or access tokens', () => {
    const { db, store } = setup();
    const invite = store.issueInvite('测试用户甲');
    const activated = store.activate(invite.inviteCode, 'installation_123456789');
    const persisted = JSON.stringify({
      invites: db.prepare('SELECT * FROM invites').all(),
      tokens: db.prepare('SELECT * FROM access_tokens').all(),
    });
    expect(persisted).not.toContain(invite.inviteCode);
    expect(persisted).not.toContain(activated.accessToken);
    expect(persisted).not.toContain('installation_123456789');
  });
});
