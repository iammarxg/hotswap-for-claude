export const password = 'Throwaway test passphrase 2026!';
export function payload(size = 0) {
  const cookies = [];
  for (let remaining = size; remaining > 0; remaining -= 32768) {
    cookies.push({ name: `fake${cookies.length}`, value: 'x'.repeat(Math.min(32768, remaining)),
      domain: '.claude.ai', path: '/', secure: true, httpOnly: true, sameSite: 'lax', session: true, hostOnly: false, storeId: '0' });
  }
  return { kind: 'hotswap-for-claude-backup', exportedAt: '2026-10-15T00:00:00.000Z', extensionVersion: '1.3.0',
    profiles: size ? [{ id: 'fake-id', label: 'Fake account', email: null, usage: null, cookies, createdAt: 1, updatedAt: 1, pinned: false }] : [] };
}
