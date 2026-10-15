import os from 'node:os';
const material = await crypto.subtle.importKey('raw', new TextEncoder().encode('public benchmark password'), 'PBKDF2', false, ['deriveKey']);
const run = () => crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: crypto.getRandomValues(new Uint8Array(16)), iterations: 600000 }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
for (let i = 0; i < 3; i++) await run();
const samples = [];
for (let i = 0; i < 30; i++) { const start = performance.now(); await run(); samples.push(performance.now() - start); }
samples.sort((a,b) => a-b);
console.log(JSON.stringify({ device: os.cpus()[0].model, ramGiB: Math.round(os.totalmem()/2**30), platform: os.platform(), runtime: process.version, kdf: 'PBKDF2-SHA-256/600000', warmup: 3, runs: 30, medianMs: (samples[14]+samples[15])/2, p95Ms: samples[28], memory: 'not measured; no Argon2', lowEndDevice: false }, null, 2));
