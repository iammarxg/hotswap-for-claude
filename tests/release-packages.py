"""Validate release ZIP contents and their refreshed private store-kit copies."""
import hashlib
import json
from pathlib import Path
import re
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'extension'
version = json.loads((SOURCE / 'manifest.json').read_text())['version']
expected = {p.relative_to(SOURCE).as_posix() for p in SOURCE.rglob('*') if p.is_file()} | {'LICENSE'}
records = []
for browser in ('chrome', 'firefox'):
    package = ROOT / 'dist' / f'hotswap-for-claude-{browser}-v{version}.zip'
    with zipfile.ZipFile(package) as archive:
        assert archive.testzip() is None
        assert set(archive.namelist()) == expected, 'Unexpected or missing packaged files'
        manifest = json.loads(archive.read('manifest.json'))
        assert manifest['version'] == version
        assert manifest['manifest_version'] == 3
        assert manifest['background'] == ({'service_worker': 'background.js', 'type': 'module'} if browser == 'chrome' else {'scripts': ['background.js'], 'type': 'module'})
        if browser == 'firefox':
            assert manifest['browser_specific_settings']['gecko']['id'] == 'hotswap-for-claude@extension'
        for name in expected - {'manifest.json'}:
            source = ROOT / 'LICENSE' if name == 'LICENSE' else SOURCE / name
            assert archive.read(name) == source.read_bytes(), f'Stale packaged source: {name}'
            if name.endswith('.js'):
                for dependency in re.findall(r'(?:from\s+|import\s*)["\'](\./[^"\']+)["\']', archive.read(name).decode()):
                    assert dependency[2:] in expected, f'Missing local module: {dependency}'
    copied = ROOT / 'store-assets' / f'v{version}' / browser / package.name
    assert copied.read_bytes() == package.read_bytes(), 'Store kit contains a stale package'
    records.append({'browser': browser, 'package': package.name, 'bytes': package.stat().st_size, 'sha256': hashlib.sha256(package.read_bytes()).hexdigest(), 'packagedFiles': len(expected)})
    print(f'PASS {browser}: ZIP integrity, exact source files, manifest, local imports, refreshed store-kit package')
default = ROOT / 'dist' / f'hotswap-for-claude-v{version}.zip'
assert default.read_bytes() == (ROOT / 'dist' / f'hotswap-for-claude-chrome-v{version}.zip').read_bytes()
assert (ROOT / 'store-assets' / f'v{version}' / 'chrome' / default.name).read_bytes() == default.read_bytes()
for name in ['CHANGELOG.md', 'RELEASE_NOTES.md']:
    assert (ROOT / 'dist' / name).is_file()
assert f'## [v{version}]' in (ROOT / 'CHANGELOG.md').read_text(encoding='utf-8')
(ROOT / 'docs/security/release-package-results.json').write_text(json.dumps({'version': version, 'ok': True, 'packages': records}, indent=2) + '\n', encoding='utf-8')
print(f'PASS v{version}: all three release ZIPs, changelog and release notes ready')
