// Constants verified against primary sources on 2026-10-15 (links below).
import test from 'node:test';
import assert from 'node:assert/strict';
const bytes = s => Buffer.from(s, 'hex');
test('RFC 7914 section 11: both PBKDF2-HMAC-SHA-256 known-answer vectors', async () => {
  // https://www.rfc-editor.org/rfc/rfc7914.html#section-11
  const vectors = [
    ['passwd', 'salt', 1, '55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc49ca9cccf179b645991664b39d77ef317c71b845b1e30bd509112041d3a19783'],
    ['Password', 'NaCl', 80000, '4ddcd8f60b98be21830cee5ef22701f9641a4418d04c0414aeff08876b34ab56a1d425a1225833549adb841b51c9b3176a272bdebba1d078478f62b397f33c8d'],
  ];
  for (const [password, salt, iterations, expected] of vectors) {
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const result = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations }, material, 512);
    assert.equal(Buffer.from(result).toString('hex'), expected);
  }
});
test('Wycheproof AES-GCM known-answer tcId 2: encryption, AAD and tag verification', async () => {
  // https://github.com/C2SP/wycheproof/blob/main/testvectors_v1/aes_gcm_test.json tcId 2 (google-wycheproof 0.9rc5)
  const key = await crypto.subtle.importKey('raw', bytes('5b9604fe14eadba931b0ccf34843dab9'), 'AES-GCM', false, ['encrypt', 'decrypt']);
  const params = { name: 'AES-GCM', iv: bytes('921d2507fa8007b7bd067d34'), additionalData: bytes('00112233445566778899aabbccddeeff'), tagLength: 128 };
  const plaintext = bytes('001d0c231287c1182784554ca3a21908');
  const expected = '49d8b9783e911913d87094d1f63cc7651e348ba07cca2cf04c618cb4d43a5b92';
  assert.equal(Buffer.from(await crypto.subtle.encrypt(params, key, plaintext)).toString('hex'), expected);
  assert.deepEqual(Buffer.from(await crypto.subtle.decrypt(params, key, bytes(expected))), plaintext);
  const corrupted = bytes(expected); corrupted[corrupted.length - 1] ^= 1;
  await assert.rejects(() => crypto.subtle.decrypt(params, key, corrupted));
});
