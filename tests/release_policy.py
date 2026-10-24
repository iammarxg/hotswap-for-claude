"""Public release path policy and regression checks; private maintainer data stays local."""
from pathlib import Path, PurePosixPath
import subprocess
import sys
import unittest

PUBLIC_FILES = {'.gitattributes', '.gitignore', 'AGENTS.md', 'CHANGELOG.md', 'CLAUDE.md',
                'LICENSE', 'README.md', 'package.py', 'package.json',
                'docs/development.md', 'docs/export-development.md'}
PUBLIC_DIRS = {'.github', 'assets', 'extension', 'tests'}


def is_public_path(name):
    parts = PurePosixPath(name).parts
    return bool(parts) and not name.startswith('/') and '\\' not in name and '..' not in parts and (
        name in PUBLIC_FILES or parts[0] in PUBLIC_DIRS or name.startswith('docs/security/'))


def audit_public_tree(root):
    root = Path(root)
    output = subprocess.run(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
                            cwd=root, check=True, capture_output=True).stdout.decode('utf-8')
    # Deliberate deletions are part of the release diff, not files to publish.
    candidates = sorted({name for name in output.split('\0') if name and (root / name).exists()})
    unexpected = [name for name in candidates if not is_public_path(name)]
    if unexpected:
        raise RuntimeError('Non-public release paths: ' + ', '.join(unexpected))
    return candidates


class ReleasePolicyTests(unittest.TestCase):
    def test_contributor_docs_and_runtime_are_public(self):
        for name in ['AGENTS.md', 'CLAUDE.md', 'docs/development.md', 'docs/export-development.md',
                     'docs/security/release-validation-v1.3.2.md', 'extension/export-reader.js',
                     'tests/export-data.test.mjs', '.github/workflows/release.yml']:
            with self.subTest(name=name):
                self.assertTrue(is_public_path(name))

    def test_private_and_unspecified_docs_remain_excluded(self):
        for name in ['temp/live-export-validation/results.json', 'MEMORY.md', 'ROADMAP.md',
                     'src/background.js', 'scripts/publish_release.py', 'store-assets/v1.3.2/kit.zip',
                     'website/index.html', '.env', 'docs/private-session.md', 'docs/beta-testing.md']:
            with self.subTest(name=name):
                self.assertFalse(is_public_path(name))

    def test_paths_cannot_escape_the_allowlist(self):
        for name in ['', '/extension/file.js', 'extension/../MEMORY.md', 'extension\\file.js', '../tests/file.py']:
            with self.subTest(name=name):
                self.assertFalse(is_public_path(name))


if __name__ == '__main__':
    if sys.argv[1:] == ['--audit']:
        print(f'PASS public release path audit: {len(audit_public_tree(Path(__file__).resolve().parents[1]))} files')
    else:
        unittest.main()
