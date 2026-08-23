# HotSwap for Claude

<p align="center">
  <img src="assets/icon.png" width="96" height="96" alt="HotSwap for Claude Logo">
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/hotswap-for-claude/nnpnmjhealgmnbinplmccegkecabcpdk"><img src="https://img.shields.io/badge/Chrome_Web_Store-v1.0.1-blue?logo=googlechrome&logoColor=white" alt="Chrome Web Store"></a>
  <a href="https://addons.mozilla.org/en-US/firefox/addon/hotswap-for-claude/"><img src="https://img.shields.io/badge/Firefox_Add--ons-v1.0.1-orange?logo=firefoxbrowser&logoColor=white" alt="Firefox Add-ons"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-AGPL_v3-green.svg" alt="License: AGPL v3"></a>
</p>

<p align="center">
  <strong>Fast, privacy-first browser extension for seamlessly hot-swapping between multiple Claude.ai accounts, monitoring real-time usage limits, keeping background sessions active, and exporting conversations.</strong>
</p>

<p align="center">
  🌐 <a href="https://hotswap.jeddah.dev">hotswap.jeddah.dev</a> • 💬 <a href="mailto:support@jeddah.dev">support@jeddah.dev</a>
</p>

---

## 📸 Showcase

<p align="center">
  <img src="assets/screenshot_overview.png" alt="HotSwap for Claude Overview" width="90%">
</p>

| Accounts & Quota Tracker | Zero-Token Chat Exporter | Session Keep-Alive & Settings |
| :---: | :---: | :---: |
| <img src="assets/screenshot_accounts.png" width="100%" alt="Accounts & Quota Tracker"> | <img src="assets/screenshot_tools.png" width="100%" alt="Chat Exporter"> | <img src="assets/screenshot_settings.png" width="100%" alt="Settings & Keep-Alive"> |

---

## 🔥 Key Features

* **⚡ Instant Hot-Swapping**: Switch between saved Claude accounts in a single click or keystroke (`Alt+Shift+1` or `Alt+Shift+Arrows`).
* **🔒 Safe Local Session Swapping**: Swaps local browser cookies without triggering server-side logouts—all your accounts stay logged in simultaneously.
* **📊 Direct Quota & Reset Timers**: Real-time visibility into your 5-hour session limits and 7-day weekly caps, read directly from Claude's native endpoints.
* **🔄 Session Keep-Alive**: Automatically exercises saved background sessions at custom intervals (default: 12h) to prevent cookie expiration.
* **📦 Zero-Token Chat Exporter**: Export complete conversations and artifacts locally to clean Markdown transcripts with zero token or API cost.
* **🛡️ 100% Local-First & Private**: All session tokens are stored strictly inside `chrome.storage.local`. Zero analytics, zero external servers.

---

## 🛠️ Build & Install from Source

### 1. Automated Packaging
Run the built-in packaging script (requires Python 3, zero dependencies):
```bash
python package.py
```
This builds ready-to-use ZIP archives in `dist/`:
* `dist/hotswap-for-claude-chrome-v1.0.1.zip` (Chrome, Edge, Brave, Opera)
* `dist/hotswap-for-claude-firefox-v1.0.1.zip` (Firefox)

### 2. Load Unpacked in Chrome / Chromium
1. Open `chrome://extensions/` and enable **Developer mode** (top right toggle).
2. Click **Load unpacked** and select the `extension/` folder.

### 3. Load Temporary in Firefox
1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and select `extension/manifest.json`.

---

## 📜 License

This project is licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0-only)**. See [LICENSE](./LICENSE) for details.
