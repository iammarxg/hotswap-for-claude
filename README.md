# HotSwap for Claude — Master Repository

Private monorepo and source control for **HotSwap for Claude** (Chrome Extension).

---

## 📂 Repository Structure

```
hotswap-for-claude-extension/
├── src/                          # 🌐 [PUBLIC / OPEN-SOURCE DEV SOURCE]
│   ├── manifest.json             # MV3 extension manifest
│   ├── background.js             # Service worker & keepalive engine
│   ├── blob-capture-init.js      # Early MAIN world blob proxy
│   ├── export-page-script.js     # In-page conversation DOM scraper
│   ├── popup.html                # Popup UI (Accounts, Tools, Settings)
│   ├── popup.js                  # Popup client logic
│   ├── popup.css                 # Styling & layout locks
│   ├── icons/                    # Extension runtime icons
│   ├── LICENSE                   # Creative Commons CC BY-NC 4.0 License
│   ├── README.md                 # Developer & user documentation
│   └── ARCHITECTURE.md           # System architecture specification
│
├── dist/                         # 🔒 [PRIVATE / CHROME WEB STORE PRODUCTION BUILD]
│   ├── manifest.json             # Clean production manifest
│   ├── background.js             # Production service worker
│   ├── blob-capture-init.js      # Production blob interceptor
│   ├── export-page-script.js     # Production export script
│   ├── popup.html / popup.js / popup.css
│   └── icons/
│
└── store-assets/                 # 🔒 [PRIVATE / MARKETING & VERSIONED ASSETS]
    └── v1.0.0/                   # Version release archives
        ├── hotswap-for-claude-v1.0.0.zip # Package snapshot for store upload
        ├── icon512.png / icon128.png     # High-res store icons
        ├── promo_small_440x280.png       # Small promo tile (440x280)
        ├── promo_marquee_1400x560.png    # Marquee banner (1400x560)
        └── screenshot_*.png              # 1280x800 showcase screenshots
```

---

## 🔒 Public vs. Private Strategy

* **This repository (`hotswap-for-claude-extension`)**: Private repository containing all development files, clean production release builds, marketing materials, and versioned package zip snapshots.
* **Public Open-Source repository (`hotswap-for-claude`)**: Public repository containing only the contents of `src/` (the extension source code, license, and developer documentation).

---

## 🚀 Publishing to GitHub (Git Subtree Workflow)

When you are ready to publish this project to GitHub:

### Step 1: Push Private Master Repository

```bash
# 1. Create the private repository on GitHub (via gh CLI or web UI)
gh repo create hotswap-for-claude-extension --private

# 2. Add remote and push everything
git remote add origin https://github.com/YOUR_USERNAME/hotswap-for-claude-extension.git
git branch -M main
git push -u origin main
```

### Step 2: Push Public Open-Source Repository (from `src/`)

```bash
# 1. Create the public repository on GitHub
gh repo create hotswap-for-claude --public

# 2. Add public remote
git remote add public-origin https://github.com/YOUR_USERNAME/hotswap-for-claude.git

# 3. Push only src/ as the root of the public repo
git subtree push --prefix=src public-origin main
```

Whenever you make changes to `src/` in the future:
```bash
git commit -am "Update feature X"
git push origin main                              # Updates private master repo
git subtree push --prefix=src public-origin main   # Updates public repo
```

---

## 📜 License

* **Open-Source Dev Code (`src/`)**: Licensed under [Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)](./src/LICENSE). Free for individuals, non-commercial use, forks, and contributions. Commercial use requires a commercial license agreement.
* **Store & Marketing Assets (`store-assets/`)**: All Rights Reserved.
