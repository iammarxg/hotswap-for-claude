# HotSwap for Claude — Master Repository

Private monorepo and source control for **HotSwap for Claude** (Chrome Extension).

---

## 📂 Repository Structure

```
hotswap-for-claude-extension/
├── .github/workflows/            # ⚙️ [CI/CD AUTOMATION]
│   └── release.yml               # Automated release & dual packager workflow
│
├── scripts/                      # 🛠️ [BUILD UTILITIES]
│   └── package.py                # Cross-platform packaging script (Chrome + Firefox)
│
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
├── dist/                         # 🔒 [PRIVATE / PRODUCTION DISTRIBUTIONS]
│   ├── chrome/                   # Clean Chrome MV3 build
│   │   ├── manifest.json
│   │   ├── background.js, blob-capture-init.js, export-page-script.js
│   │   ├── popup.html, popup.js, popup.css
│   │   └── icons/
│   └── firefox/                  # Clean Firefox Gecko MV3 build
│       ├── manifest.json         # Includes gecko.id & background script settings
│       ├── background.js, blob-capture-init.js, export-page-script.js
│       ├── popup.html, popup.js, popup.css
│       └── icons/
│
├── website/                      # 🌐 [HOMEPAGE & SUPPORT PORTAL (CLOUDFLARE PAGES)]
│   ├── index.html                # Responsive landing page & support form
│   ├── styles.css                # Dark theme stylesheet
│   ├── app.js                    # Support form logic & email formatter (support@jeddah.dev)
│   ├── assets/                   # Self-contained logos and screenshots
│   └── functions/api/contact.js  # Optional Cloudflare Pages API endpoint
│
└── store-assets/                 # 🔒 [PRIVATE / MARKETING & VERSIONED ASSETS]
    └── v1.0.0/                   # Version release archives
        ├── hotswap-for-claude-chrome-v1.0.0.zip  # Chrome store package
        ├── hotswap-for-claude-firefox-v1.0.0.zip # Firefox add-on package
        ├── hotswap-for-claude-v1.0.0.zip         # Release snapshot zip
        ├── icon512.png / icon128.png             # High-res store icons
        ├── promo_small_440x280.png               # Small promo tile (440x280)
        ├── promo_marquee_1400x560.png            # Marquee banner (1400x560)
        └── screenshot_*.png                      # 1280x800 showcase screenshots
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

## 🛠️ Automated Packaging & GitHub Releases

### Local Packaging (Chrome + Firefox)
Run the automated packaging utility at any time to sync `src/` to `dist/chrome/` and `dist/firefox/` and generate store packages:
```bash
python scripts/package.py
```
This produces:
- `dist/chrome/` & `dist/firefox/`
- `store-assets/v<version>/hotswap-for-claude-chrome-v<version>.zip`
- `store-assets/v<version>/hotswap-for-claude-firefox-v<version>.zip`

### Automated GitHub Releases (CI/CD)
The `.github/workflows/release.yml` GitHub Actions pipeline is active on this repository:
- **On every push to `main`**: Builds Chrome and Firefox packages, validates manifests, creates a GitHub Release, and attaches both `.zip` distribution packages automatically.

---

## 🌐 Hosting the Homepage & Support Portal (Cloudflare Pages)

The `website/` directory contains a static landing page and support contact portal with built-in email formatting for `support@jeddah.dev`.

### Method A: Cloudflare Direct Upload (Zero Setup — Deploy in 1 Minute)
1. Go to [dash.cloudflare.com](https://dash.cloudflare.com/) ➔ **Workers & Pages** ➔ **Create application** ➔ **Pages**.
2. Click **Upload assets** and name the project `hotswap-for-claude`.
3. Drag and drop the `website/` folder.
4. Click **Deploy site**. It will instantly be live at `https://hotswap-for-claude.pages.dev` with free SSL and CDN.

### Method B: GitHub Git Integration (Auto-Deploy on Push)
1. Go to **Workers & Pages** ➔ **Pages** ➔ **Connect to Git**.
2. Select your repository `hotswap-for-claude-extension`.
3. Build Settings:
   - **Root directory**: `website`
   - **Build output directory**: `.` (or `website`)
4. Click **Save and Deploy**. Every push to `main` will now automatically update your live site!

---

## 📜 License

* **Open-Source Dev Code (`src/`)**: Licensed under [Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)](./src/LICENSE). Free for individuals, non-commercial use, forks, and contributions. Commercial use requires a commercial license agreement.
* **Store & Marketing Assets (`store-assets/`)**: All Rights Reserved.

