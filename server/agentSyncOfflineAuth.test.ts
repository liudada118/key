import { createSign, generateKeyPairSync } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let selections: unknown[][] = [], inserted: unknown[] = [];
vi.mock('./db', () => ({ getDb: async () => ({
  select: () => {
    const builder = { from: () => builder, innerJoin: () => builder, leftJoin: () => builder, where: () => builder,
      limit: async () => selections.shift() || [] };
    return builder;
  },
  insert: () => ({ values: (value: unknown) => { inserted.push(value); return { onDuplicateKeyUpdate: async () => {} }; } }),
}) }));
import { authenticateLicenseUpload } from './agentSyncStore';

/** Sign a synthetic offline code and return the database fields used by the actual authentication function. */
function fixture() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const expireDate = Date.now() + 3600000;
  const payload = Buffer.from(JSON.stringify({ version: 4, boundSensorTypes: ['seatpad'], deviceLimit: 2, expireDate })).toString('base64');
  const signer = createSign('RSA-SHA256'); signer.update(payload); signer.end();
  const activationCode = Buffer.from(JSON.stringify({ payload, signature: signer.sign(privateKey, 'base64') })).toString('base64');
  return { activationCode, row: { id: 7, activationCode, expireDate, status: 'ISSUED', isDeleted: false,
    customerId: 42 as number | null, customerActive: true, publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString() } };
}
beforeEach(() => { selections = []; inserted = []; });

describe('offline software license chat synchronization', () => {
  it('verifies the real RSA signature and uses a stable offline-key source rather than the company ID', async () => {
    const { activationCode, row } = fixture(); selections = [[row], [{ id: 303 }]];
    expect(await authenticateLicenseUpload(activationCode)).toEqual({ tenantId: 303, credentialId: 0 });
    expect(inserted).toEqual([{ offlineKeyId: 7 }]);
    selections = [[{ ...row, customerId: 43 }], [{ id: 303 }]];
    expect((await authenticateLicenseUpload(activationCode)).tenantId).toBe(303);
    expect(inserted.at(-1)).toEqual({ offlineKeyId: 7 });
  });

  it('rejects unregistered codes and modified signatures before creating any source', async () => {
    const { activationCode, row } = fixture(); selections = [[]];
    await expect(authenticateLicenseUpload(activationCode)).rejects.toMatchObject({ status: 401 });
    const envelope = JSON.parse(Buffer.from(activationCode, 'base64').toString()); envelope.signature = 'invalid';
    const changed = Buffer.from(JSON.stringify(envelope)).toString('base64'); selections = [[{ ...row, activationCode: changed }]];
    await expect(authenticateLicenseUpload(changed)).rejects.toMatchObject({ status: 401 });
    expect(inserted).toHaveLength(0);
  });

  it('rejects unavailable licenses and missing or inactive customer links', async () => {
    const { activationCode, row } = fixture();
    for (const patch of [{ status: 'REVOKED' }, { expireDate: Date.now() - 1 }, { customerId: null }, { customerActive: false }, { isDeleted: true }]) {
      selections = [[{ ...row, ...patch }]];
      await expect(authenticateLicenseUpload(activationCode)).rejects.toMatchObject({ status: 403 });
    }
    expect(inserted).toHaveLength(0);
  });
});
