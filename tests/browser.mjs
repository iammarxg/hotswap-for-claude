// Browser-engine checks against packaged modules over loopback, not an installed
// extension lifecycle/store test. The Python runner records that distinction.
const query = new URLSearchParams(location.search);
const target = query.get('target');
const crossOnly = query.has('cross');
const result = { target, userAgent: navigator.userAgent, context: 'loopback HTTP using production build modules; not installed extension', checks: [] };
const check = (condition, name) => { if (!condition) throw new Error(name); result.checks.push(name); };
try {
  const { encryptBackup, decryptBackup } = await import(`/dist/${target}/backup-crypto.js`);
  const { payload, password } = await import('./helpers.mjs');
  const { encryptBackup: encryptV1 } = await import('./legacy-original.mjs');
  const peer = target === 'chrome' ? 'firefox' : 'chrome';
  const cross = await fetch(`/exchange/${peer}`).then(r => r.json());
  if (cross) check(JSON.stringify(await decryptBackup(cross, password)) === JSON.stringify(payload(1024)), `decrypt ${peer} export`);
  if (!crossOnly) {
    for (const size of [0, 1024, 1024 * 1024]) {
      const p = payload(size);
      const e = await encryptBackup(p, password);
      check(JSON.stringify(await decryptBackup(e, password)) === JSON.stringify(p), `v2 round trip ${size} bytes`);
      check(JSON.stringify(await decryptBackup(await encryptV1(p, password), password)) === JSON.stringify(p), `v1 round trip ${size} bytes`);
    }
    for (const name of ['ascii', 'unicode-nfd', 'spaces']) {
      const f = await fetch(`fixtures/v1-${name}.json`).then(r => r.json());
      check(JSON.stringify(await decryptBackup(f.envelope, f.password)) === JSON.stringify(f.payload), `v1 fixture ${name}`);
    }
    const p = 'cafe\u0301 fullwidth \uff21';
    const unicode = await encryptBackup(payload(), p);
    check(!!await decryptBackup(unicode, p.normalize('NFKC')), 'v2 NFKC');
    const envelope = await encryptBackup(payload(1024), password);
    await fetch(`/exchange/${target}`, { method: 'POST', body: JSON.stringify(envelope) });
    // Probe WebAssembly under the effective default extension script-src,
    // delivered as an HTTP CSP header. This alone is NOT extension CSP proof.
    try {
      await WebAssembly.compile(new Uint8Array([0,97,115,109,1,0,0,0]));
      result.wasmUnderEquivalentCSP = 'allowed';
    } catch { result.wasmUnderEquivalentCSP = 'blocked'; }
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode('public benchmark'), 'PBKDF2', false, ['deriveKey']);
    const run = () => crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', iterations: 600000, salt: crypto.getRandomValues(new Uint8Array(16)) }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
    for (let i = 0; i < 3; i++) await run();
    const samples = [];
    for (let i = 0; i < 30; i++) { const start = performance.now(); await run(); samples.push(performance.now()-start); }
    samples.sort((a,b) => a-b);
    result.benchmark = { kdf: 'PBKDF2-SHA-256/600000', freshSaltPerRun: true, warmup: 3, runs: 30, medianMs: (samples[14]+samples[15])/2, p95Ms: samples[28], memory: 'not measured; Argon2 not used' };
  }
  result.ok = true;
} catch (error) { result.ok = false; result.error = error.message; }
await fetch('/result', { method: 'POST', body: JSON.stringify(result) });
document.querySelector('p').textContent = result.ok ? 'Passed' : 'Failed';
