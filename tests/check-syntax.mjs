import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
let count = 0;
for (const dir of ['extension', 'tests']) {
  for (const name of await readdir(dir)) {
    if (!/\.[cm]?js$/.test(name)) continue;
    const result = spawnSync(process.execPath, ['--check', `${dir}/${name}`], { encoding: 'utf8' });
    if (result.status !== 0) { process.stderr.write(result.stderr); process.exit(1); }
    count++;
  }
}
console.log(`Syntax checks passed for ${count} JavaScript modules. No lint/type-check tooling exists in the baseline repository.`);
