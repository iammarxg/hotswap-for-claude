# Backup security update — v1.3.1

New backups use format v2. Create one with a unique password of at least 12 characters, confirm it, and keep it safe: a forgotten password cannot be recovered. The backup may contain active session credentials, so store it like a password. Encryption cannot protect a compromised browser or device.

Restore still accepts v1 encrypted backups with their original passwords, including short passwords and exact spacing/Unicode spelling. Older plaintext backups remain supported too. Every restore now shows the account labels and count; choose **Confirm import** only when you trust the file's source. An attacker can encrypt a backup containing their own sessions.

An older-format notice suggests creating a new backup after restoring. Re-export is always your choice; HotSwap never rewrites or deletes the original file. An older extension cannot read v2: update the extension before trying to restore that file.

Damaged, modified and wrong-password backups share one error message. Invalid or cancelled imports leave your existing accounts untouched. Closing the popup or letting its two-minute preview expire requires unlocking again. Saved sessions in the browser's local storage are not encrypted by this backup feature.

Firefox backup exports now use an extension-owned Blob URL, fixing Firefox's rejection of data URL downloads. Interrupted downloads never report success.

This update adds no telemetry, remote code or runtime dependencies. Installed Chromium and Firefox popup, restore, lifecycle and download checks passed. Low-end-device benchmarks remain unavailable; see the [release validation](release-validation-v1.3.1.md).
