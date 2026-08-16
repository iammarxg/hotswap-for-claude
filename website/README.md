# HotSwap for Claude — Website & Support Portal

A responsive landing page and engineering support portal for **HotSwap for Claude**, built to be hosted on **Cloudflare Pages** or **Cloudflare Workers**.

---

## 📂 Website Directory Structure

```
website/
├── index.html                  # Landing page structure & contact form
├── styles.css                  # Modern dark theme CSS styling
├── app.js                      # Form logic, client detection, and mailto formatter
├── assets/                     # Self-contained icons, screenshots, and artwork
└── functions/
    └── api/
        └── contact.js          # Optional serverless Cloudflare Pages Function
```

---

## 🚀 How to Host on Cloudflare Pages

### Method A: Direct Upload (Fastest / Zero Setup — Use Right Now)

1. Log in to the [Cloudflare Dashboard](https://dash.cloudflare.com/).
2. Navigate to **Workers & Pages** ➔ **Create Application** ➔ Click the **Pages** tab.
3. Select **Upload assets**.
4. Set a project name (e.g., `hotswap-for-claude` or `hotswap-claude`).
5. Drag and drop the `website/` folder directly into the upload dropzone (or select the folder).
6. Click **Deploy site**.
7. Your site is live! You can link your custom domain **`https://hotswap.jeddah.dev`** under **Custom domains** tab in Cloudflare Pages.

---

### Method B: GitHub Git Integration (Automated CI/CD — For Future)

Once you push this repository to GitHub:

1. In the Cloudflare Dashboard, go to **Workers & Pages** ➔ **Create Application** ➔ **Pages** ➔ **Connect to Git**.
2. Select your GitHub repository (`hotswap-for-claude-extension`).
3. Configure the build settings:
   * **Framework preset**: `None`
   * **Build command**: *(Leave blank)*
   * **Build output directory**: `website`
   * **Root directory**: `website` (or `/`)
4. Click **Save and Deploy**.
5. Every time you push changes to your GitHub `main` branch, Cloudflare Pages will automatically rebuild and deploy the new version to `https://hotswap.jeddah.dev`!

---

### Method C: Cloudflare Wrangler CLI (Optional)

If you have Node.js and Wrangler installed:
```bash
npx wrangler pages deploy website --project-name=hotswap-for-claude
```

---

## 📬 Support Email Routing (`support@jeddah.dev`)

The contact form is configured to route all support requests directly to:
**`support@jeddah.dev`**

### Structured Email Format:
Because `support@jeddah.dev` receives emails for multiple products and services, the form formats every email with standardized metadata:

```text
=====================================================
HOTSWAP FOR CLAUDE — SUPPORT REQUEST
=====================================================
• Product: HotSwap for Claude (v1.0.0)
• Extension ID: nnpnmjhealgmnbinplmccegkecabcpdk
• Submitted From: https://hotswap.jeddah.dev
• Inquiry Category: [Bug Report | Feature Request | Account Switching | Commercial License]
• Sender Name: <User's Name>
• Sender Email: <User's Email>
• Client Environment: Chrome 128 on Windows (en-US)
• Timestamp: 2026-08-16T03:25:00.000Z
=====================================================

USER MESSAGE:
-----------------------------------------------------
<User's message>
-----------------------------------------------------
```

---

## 🔗 Important Links

* **Live Website**: [https://hotswap.jeddah.dev](https://hotswap.jeddah.dev)
* **Chrome Web Store**: [https://chromewebstore.google.com/detail/hotswap-for-claude/nnpnmjhealgmnbinplmccegkecabcpdk](https://chromewebstore.google.com/detail/hotswap-for-claude/nnpnmjhealgmnbinplmccegkecabcpdk)
* **Chrome Extension ID**: `nnpnmjhealgmnbinplmccegkecabcpdk`

