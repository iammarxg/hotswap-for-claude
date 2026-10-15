# Backup security update (unreleased)

New backups use format v2. Create one with a unique password of at least 12 characters, confirm it, and keep it safe: a forgotten password cannot be recovered. The backup may contain active session credentials, so store it like a password. Encryption cannot protect a compromised browser or device.

Restore still accepts v1 encrypted backups with their original passwords, including short passwords and exact spacing/Unicode spelling. Older plaintext backups remain supported too. Every restore now shows the account labels and count; choose **Confirm import** only when you trust the file's source. An attacker can encrypt a backup containing their own sessions.

An older-format notice suggests creating a new backup after restoring. Re-export is always your choice; HotSwap never rewrites or deletes the original file. An older extension cannot read v2: update the extension before trying to restore that file.

Damaged, modified and wrong-password backups share one error message. Invalid or cancelled imports leave your existing accounts untouched. Closing the popup or letting its two-minute preview expire requires unlocking again. Saved sessions in the browser's local storage are not encrypted by this backup feature.

This update adds no telemetry, remote code or dependencies. It is locally implemented and tested; installed-extension lifecycle and low-end-device release checks are still listed in the [validation report](validation-report.md).
