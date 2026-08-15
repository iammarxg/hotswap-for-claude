// export-page-script.js
//
// Exports a function that gets passed to chrome.scripting.executeScript
// ({ func: exportClaudeConversationInPage }), which serializes the function
// and re-runs it INSIDE the claude.ai page. Because of that, the function
// itself must be fully self-contained — no closures over anything outside
// its own body (imports at the top of THIS file are fine; they just can't
// be referenced from inside the function).

export async function exportClaudeConversationInPage() {
  // Turn a DOM node into Markdown-ish text without relying on innerText
  // (innerText depends on layout/CSS and behaves inconsistently for our
  // purposes — this walks textContent directly so code blocks keep their
  // exact whitespace).
  function serializeNode(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (node.nodeType !== Node.ELEMENT_NODE) return "";

    // Skip screen-reader-only headings ("You said: ...", "Claude responded:
    // ...") and the hover action bar (Copy/Retry/Edit buttons) — these are
    // real DOM content but not part of the message itself.
    if (node.classList?.contains("sr-only")) return "";
    if (node.hasAttribute?.("data-message-action-bar")) return "";
    if (node.tagName?.toLowerCase() === "button") return "";

    const tag = node.tagName.toLowerCase();

    if (tag === "pre") {
      const codeEl = node.querySelector("code") || node;
      let lang = "";
      if (codeEl.classList) {
        const match = [...codeEl.classList].find((c) =>
          c.startsWith("language-")
        );
        if (match) lang = match.replace("language-", "");
      }
      const code = codeEl.textContent.replace(/\n+$/, "");
      return `\n\`\`\`${lang}\n${code}\n\`\`\`\n`;
    }

    if (tag === "br") return "\n";

    if (tag === "li") {
      const inner = Array.from(node.childNodes).map(serializeNode).join("");
      return `- ${inner.trim()}\n`;
    }

    if (
      ["p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote"].includes(
        tag
      )
    ) {
      const inner = Array.from(node.childNodes).map(serializeNode).join("");
      return inner.trim() ? `${inner.trim()}\n\n` : "";
    }

    if (tag === "code" && node.parentElement?.tagName.toLowerCase() !== "pre") {
      return `\`${node.textContent}\``;
    }

    if (tag === "strong" || tag === "b") {
      return `**${Array.from(node.childNodes).map(serializeNode).join("")}**`;
    }

    if (tag === "em" || tag === "i") {
      return `_${Array.from(node.childNodes).map(serializeNode).join("")}_`;
    }

    if (tag === "a") {
      const inner = Array.from(node.childNodes).map(serializeNode).join("");
      return node.href ? `${inner} (${node.href})` : inner;
    }

    // Default: just recurse into children.
    return Array.from(node.childNodes).map(serializeNode).join("");
  }

  function elementToMarkdown(el) {
    return serializeNode(el).replace(/\n{3,}/g, "\n\n").trim();
  }

  // Attachment chips and artifact cards usually live as SIBLINGS of the
  // narrow text bubble inside a shared "turn" wrapper, not inside the text
  // bubble itself. Widen the search scope to that wrapper before looking
  // for attachments, falling back to a few parentElement hops if no
  // recognizable wrapper is found.
  function findTurnContainer(textEl) {
    const byTestId = textEl.closest(
      '[data-testid="user-turn"], [data-testid="agent-turn"], [data-testid="assistant-turn"]'
    );
    if (byTestId) return byTestId;

    let node = textEl;
    for (let i = 0; i < 4 && node.parentElement; i++) {
      node = node.parentElement;
    }
    return node;
  }

  function sanitizeAttachmentName(name) {
    return (name || "file")
      .replace(/[\\/:*?"<>|]+/g, "-")
      .trim()
      .slice(0, 80) || "file";
  }

  // Pasted-text chips render collapsed with a "show more"/expand control
  // when the paste is long; clicking it (if present) mounts the full text
  // before we read it, rather than capturing a truncated preview.
  async function extractPastedText(node) {
    const expandBtn = Array.from(node.querySelectorAll("button")).find((b) =>
      /show more|expand|view more/i.test(b.textContent || "")
    );
    if (expandBtn) {
      expandBtn.click();
      await new Promise((r) => setTimeout(r, 150));
    }
    const text = (node.textContent || "").trim();
    return text || null;
  }

  // NOTE: previously gated chip-opening on this regex matching the chip's
  // visible label (e.g. requiring it to end in ".zip"). Removed — Claude's
  // UI shows chip labels WITHOUT their extension, so that check silently
  // skipped every real file attachment. Left unused here as a marker in
  // case a future regression needs the history; not referenced anymore.

  // Claude.ai only fetches an attachment's actual bytes once you open its
  // preview, and even then there's no <a href> anywhere — real markup
  // (verified against a live page) is a plain <button aria-label="Download">
  // with no href at all. The download is entirely JS-driven (click -> fetch
  // -> browser download), so there's nothing to scrape from the DOM. This
  // clicks the chip open, then clicks that Download button, and lets the
  // resulting real download get caught on the extension side via
  // chrome.downloads.onCreated (wired up in background.js) rather than
  // trying to intercept a URL here. Dedupe by filename so repeated
  // captureVisible() passes (we scroll many times) don't reopen/re-trigger
  // the same download over and over.
  const processedAttachmentChips = new Set();

  async function waitForNewElement(matches, timeoutMs) {
    const before = new Set(Array.from(document.querySelectorAll("*")).filter(matches));
    const steps = Math.ceil(timeoutMs / 100);
    for (let i = 0; i < steps; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const found = Array.from(document.querySelectorAll("*")).find(
        (el) => matches(el) && !before.has(el)
      );
      if (found) return found;
    }
    return null;
  }

  // The actual interception now lives in blob-capture-init.js, a MAIN-world
  // content script installed at document_start (see that file for why: an
  // override installed here, at export time, was confirmed too late to
  // catch Claude's own download click — the bundle had already cached the
  // original URL.createObjectURL reference by then). This just listens for
  // the DOM CustomEvent that script dispatches once it's captured a blob.
  function waitForBlobCaptureEvent(timeoutMs = 8000) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        document.removeEventListener("__claude_export_blob_captured", handler);
        clearTimeout(timer);
        resolve(result);
      };
      const handler = (e) => finish(e.detail);
      const timer = setTimeout(() => finish(null), timeoutMs);
      document.addEventListener("__claude_export_blob_captured", handler);
    });
  }

  // Opens a file chip and clicks its Download button, so a real browser
  // download starts. Returns true if we found and clicked a Download
  // button, so background.js knows to expect a native download to show up.
  async function openAttachmentAndTriggerDownload(node, filename) {
    if (processedAttachmentChips.has(filename)) return { triggered: false, triggeredAt: null };
    processedAttachmentChips.add(filename);

    const clickable =
      node.tagName?.toLowerCase() === "button"
        ? node
        : node.querySelector("button") || node;
    if (!clickable || typeof clickable.click !== "function") {
      console.log("[claude-export]", filename, "— chip has no clickable button, skipping");
      return { triggered: false, triggeredAt: null };
    }

    console.log("[claude-export]", filename, "— clicking chip to open preview");
    clickable.click();

    // Wait for a Download control to mount (up to ~4s — zips can be slower
    // than images to open a preview for). Matches on aria-label OR visible
    // text, because user-uploaded files that Claude can't render a preview
    // for show a "Preview isn't available" dialog instead of the normal
    // preview panel — confirmed by testing — and that dialog's download
    // control may not follow the same aria-label pattern ("Download
    // <name>") as the one on Claude-generated artifacts.
    const downloadBtn = await waitForNewElement(
      (el) =>
        el.tagName?.toLowerCase() === "button" &&
        ((el.getAttribute("aria-label") || "").toLowerCase().startsWith("download") ||
          /^download\b/i.test((el.textContent || "").trim())),
      4000
    );
    console.log("[claude-export]", filename, "— download button found:", !!downloadBtn);

    if (!downloadBtn) {
      // Diagnostic only, so a future failure tells us what's actually on
      // screen (e.g. the "Preview isn't available" dialog's real markup)
      // instead of needing another guess-and-check round.
      const dialog = document.querySelector('[role="dialog"], [role="alertdialog"]');
      if (dialog) {
        console.log(
          "[claude-export]",
          filename,
          "— no download button, but a dialog is open. Its buttons:",
          Array.from(dialog.querySelectorAll("button")).map(
            (b) => `"${(b.textContent || "").trim()}" aria-label="${b.getAttribute("aria-label") || ""}"`
          )
        );
      }
    }

    let triggered = false;
    let triggeredAt = null;
    let blobCapture = null;
    if (downloadBtn) {
      const capturePromise = waitForBlobCaptureEvent(8000);
      downloadBtn.click();
      triggered = true;
      triggeredAt = Date.now();
      console.log("[claude-export]", filename, "— clicked download button at", triggeredAt);
      blobCapture = await capturePromise;
      console.log(
        "[claude-export]",
        filename,
        "— blob captured:",
        !!blobCapture,
        blobCapture ? `${blobCapture.size} bytes` : ""
      );
    }

    // Close the preview again: prefer an explicit "Go back" control (seen
    // in real markup) and fall back to Escape, which dismisses basically
    // every overlay/panel pattern regardless of markup specifics.
    const backBtn = Array.from(document.querySelectorAll("button")).find(
      (el) => (el.getAttribute("aria-label") || "").toLowerCase() === "go back"
    );
    if (backBtn) {
      backBtn.click();
    } else {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      );
    }
    await new Promise((r) => setTimeout(r, 150));

    return { triggered, triggeredAt, blobCapture };
  }

  // Best-effort detection of files linked to a message: user-uploaded
  // attachments and Claude-generated artifacts. Claude.ai's markup for
  // these isn't public, so this uses several heuristics and degrades
  // gracefully — a "reference" entry (filename known, not downloadable)
  // is still useful context even without a fetchable URL.
  async function findAttachmentsIn(turnEl) {
    const attachments = [];
    const seen = new Set();
    const add = (a) => {
      const key = `${a.type}|${a.filename}|${a.url || ""}`;
      if (seen.has(key)) return;
      seen.add(key);
      attachments.push(a);
    };

    // Inline images (user-uploaded screenshots/photos, or Claude-generated
    // images) — only keep ones with a real fetchable http(s) URL; blob:
    // URLs are ephemeral and won't survive past this page session.
    turnEl.querySelectorAll("img").forEach((img) => {
      const src = img.currentSrc || img.src;
      if (src && /^https?:\/\//.test(src)) {
        const guessedName =
          (img.alt && img.alt.trim()) ||
          src.split("/").pop().split("?")[0] ||
          "image";
        add({
          type: "image",
          filename: sanitizeAttachmentName(guessedName),
          url: src,
        });
      }
    });

    // Direct file links — download attributes or hrefs that look like
    // documents rather than in-app navigation links.
    //
    // Same-origin links (claude.ai itself) are excluded unless they carry
    // an explicit `download` attribute. Opening a file chip's preview can
    // leave a same-origin API/metadata link mounted in the DOM (pointing at
    // a JSON endpoint describing the file, not its bytes), and since
    // findAttachmentsIn() re-runs on every scroll capture, a later pass
    // could pick that up and fetch it as if it were the actual attachment
    // — which is how a JSON file ended up downloaded in place of a zip.
    // Real file bytes are normally served from a separate storage/CDN
    // origin, so requiring cross-origin (or an explicit download attribute)
    // filters that failure mode out without losing legitimate links.
    turnEl.querySelectorAll("a[href]").forEach((a) => {
      const href = a.href;
      const hasDownloadAttr = a.hasAttribute("download");
      const looksLikeFile =
        hasDownloadAttr ||
        /\.(pdf|docx?|xlsx?|csv|txt|zip|pptx?|json|py|js|ts|tsx|jsx|md|html|css)(\?|$)/i.test(
          href
        );
      let isSameOrigin = false;
      try {
        isSameOrigin = new URL(href, location.href).origin === location.origin;
      } catch {
        // Unparsable href — treat as not-same-origin, existing checks below
        // will filter it out if it isn't a real http(s) URL anyway.
      }
      if (
        href &&
        /^https?:\/\//.test(href) &&
        looksLikeFile &&
        (!isSameOrigin || hasDownloadAttr)
      ) {
        const guessedName =
          a.getAttribute("download") ||
          a.textContent.trim() ||
          href.split("/").pop().split("?")[0] ||
          "file";
        add({
          type: "file",
          filename: sanitizeAttachmentName(guessedName),
          url: href,
        });
      }
    });

    // Attachment chips / artifact cards that expose a filename or title
    // via text, aria-label, or title, but don't have a directly fetchable
    // URL in the DOM (e.g. the content only loads once you click to open
    // it). Still worth recording as a named reference.
    // "file-thumbnail" is what claude.ai actually marks these chips with
    // (verified against a real saved page) — "attachment"/"artifact" never
    // appear anywhere in the ancestor chain, so keep those as a fallback
    // in case the markup differs elsewhere, but lead with what's real.
    const chipNodes = Array.from(
      turnEl.querySelectorAll(
        '[data-testid*="file-thumbnail"], [data-testid*="attachment"], [data-testid*="artifact"], [class*="attachment"], [class*="artifact"]'
      )
    );
    console.log("[claude-export] chip candidates found in this turn:", chipNodes.length);
    for (const node of chipNodes) {
      // Skip if this node is just a wrapper around an <img> or <a> we
      // already captured above.
      if (node.querySelector("img, a[href]")) continue;
      const label =
        node.getAttribute("aria-label") ||
        node.getAttribute("title") ||
        node.querySelector("[aria-label]")?.getAttribute("aria-label") ||
        node.textContent.trim();
      if (!label || label.length >= 120) continue;

      const filename = sanitizeAttachmentName(label.replace(/^(view|open)\s+/i, ""));

      // Previously this only attempted a chip whose visible label matched a
      // file-extension regex (.zip, .pdf, etc). That's wrong: Claude's UI
      // shows the chip label WITHOUT the extension (e.g. "Claude account
      // switcher v1 4 3", not "...v1 4 3.zip" — confirmed from the real
      // aria-label on the Download button itself). That meant this branch
      // never ran for zip/file attachments at all, so nothing past this
      // point ever executed for them. Now every chip is attempted, and
      // whether it's a "real" downloadable file is decided by ground
      // truth — did opening it actually reveal a Download button — rather
      // than guessing from the label text. Generic non-file artifact
      // panels (code/markdown previews) just won't have a Download button,
      // so they safely fall through to "reference" as before.
      let nativeDownloadTriggered = false;
      let nativeDownloadTriggeredAt = null;
      let dataUrl = null;
      let mimeType = null;
      try {
        const outcome = await openAttachmentAndTriggerDownload(node, filename);
        nativeDownloadTriggered = outcome.triggered;
        nativeDownloadTriggeredAt = outcome.triggeredAt;
        if (outcome.blobCapture) {
          dataUrl = outcome.blobCapture.dataUrl;
          mimeType = outcome.blobCapture.mimeType;
        }
      } catch (e) {
        console.warn("[claude-export] chip open/download failed for", filename, e);
        nativeDownloadTriggered = false;
      }

      // "Pasted text" chips (long pasted content Claude collapses into a
      // chip rather than showing inline) aren't a real uploaded file —
      // there's no blob, no Download button, nothing for the code above to
      // catch. The text is just sitting in the DOM, possibly truncated
      // behind a "show more" control. If we got no downloadable bytes at
      // all AND the label looks like one of these, grab the full text
      // directly instead of leaving it as an unfetchable reference.
      let pastedText = null;
      if (!dataUrl && !nativeDownloadTriggered && /^pasted\b/i.test(label)) {
        pastedText = await extractPastedText(node);
      }

      add({
        type: dataUrl ? "file" : pastedText ? "text" : nativeDownloadTriggered ? "file" : "reference",
        filename,
        url: null,
        nativeDownloadTriggered,
        nativeDownloadTriggeredAt,
        dataUrl,
        mimeType,
        pastedText,
      });
    }

    return attachments;
  }

  // Claude.ai's DOM structure isn't publicly documented and can change —
  // it already has once since this extension was built. Each strategy
  // below returns { role, el, turnEl } where `el` is the narrow content
  // node to extract text from and `turnEl` is the wider wrapper to search
  // for attachments in.
  function findMessageElements() {
    // Primary strategy (verified against a real claude.ai page): every
    // message turn is a `role="article"` wrapper labeled "Message N of M".
    // Role is read from the screen-reader-only heading Claude renders for
    // accessibility ("You said: ..." / "Claude responded: ..."), which is
    // unlikely to change since it's load-bearing for screen readers, not
    // just a styling class.
    const turns = Array.from(
      document.querySelectorAll('[role="article"][aria-label^="Message "]')
    );
    if (turns.length > 0) {
      return turns.map((turnEl) => {
        const heading = turnEl.querySelector("h2.sr-only, h2[class*='sr-only']");
        const headingText = heading ? heading.textContent.trim().toLowerCase() : "";
        const userContentEl = turnEl.querySelector('[data-testid="user-message"]');

        let role, el;
        if (headingText.startsWith("you said") || userContentEl) {
          role = "user";
          el = userContentEl || turnEl;
        } else {
          role = "assistant";
          el =
            turnEl.querySelector(".standard-markdown, .progressive-markdown") ||
            turnEl;
        }
        return { role, el, turnEl };
      });
    }

    // Fallback: older class-based markup, in case Claude reverts or this
    // runs against a different rendering mode.
    let nodes = Array.from(
      document.querySelectorAll(".font-user-message, .font-claude-message")
    );
    if (nodes.length > 0) {
      return nodes.map((el) => ({
        role: el.classList.contains("font-user-message") ? "user" : "assistant",
        el,
        turnEl: null,
      }));
    }

    // Last resort: generic turn-ish test ids from even older markup.
    nodes = Array.from(
      document.querySelectorAll(
        '[data-testid="user-turn"], [data-testid="agent-turn"], [data-testid="assistant-turn"]'
      )
    );
    if (nodes.length > 0) {
      return nodes.map((el) => ({
        role: el.getAttribute("data-testid") === "user-turn" ? "user" : "assistant",
        el,
        turnEl: null,
      }));
    }

    return [];
  }

  // Turn whatever findMessageElements() currently sees into serialized
  // entries, keyed by a stable identity so repeated captures (as we scroll)
  // can be merged instead of duplicated.
  async function captureVisible(store) {
    const found = findMessageElements();
    for (const { role, el, turnEl } of found) {
      const container = turnEl || findTurnContainer(el);
      // aria-posinset ("Message N of M") is the stable identity Claude
      // assigns per message; it survives virtualization (the node is
      // destroyed/recreated as you scroll, but the number doesn't change).
      // Fall back to a content-based key for older/fallback markup that
      // doesn't carry aria-posinset at all (that markup also isn't
      // virtualized, so a fallback key is only ever a convenience here).
      const posinsetEl = container?.closest?.("[aria-posinset]") || container;
      const posinset = posinsetEl?.getAttribute?.("aria-posinset");
      const text = elementToMarkdown(el);
      // Opening file attachments (below) can shift scroll position and
      // layout, so we resolve them one message at a time rather than in
      // parallel, keeping the scroll/capture loop below well-behaved.
      const attachments = await findAttachmentsIn(container);
      if (!text && attachments.length === 0) continue;
      const key = posinset != null ? `p:${posinset}` : `c:${role}:${text.slice(0, 200)}`;
      store.set(key, {
        role,
        text,
        attachments,
        order: posinset != null ? Number(posinset) : store.size,
      });
    }
  }

  function scrapeConversation(store) {
    const messages = Array.from(store.values())
      .sort((a, b) => a.order - b.order)
      .map(({ role, text, attachments }) => ({ role, text, attachments }));

    return {
      title:
        document.title.replace(/\s*[|\-–]\s*Claude.*$/i, "").trim() ||
        "Claude conversation",
      url: location.href,
      exportedAt: new Date().toISOString(),
      messages,
    };
  }

  // The real scrollable region is the message list itself, not <main> —
  // Claude.ai marks it explicitly with data-autoscroll-container, which is
  // far more reliable than guessing from layout tags (main may not be the
  // element that actually scrolls). Fall back for older/changed markup.
  const scrollContainer =
    document.querySelector('[data-autoscroll-container="true"]') ||
    document.querySelector("main") ||
    document.scrollingElement ||
    document.body;

  const store = new Map();

  // Long conversations are virtualized: only the messages near the current
  // scroll position exist in the DOM at any given moment, and scrolling
  // unmounts the ones that fall out of view. A single scrape after
  // reaching the top would only see whatever's rendered *then* and lose
  // everything below it. So we capture at every step on the way up,
  // merging into `store` by message identity, instead of scraping once at
  // the end.
  await captureVisible(store);

  let lastHeight = -1;
  let stableCount = 0;
  for (let i = 0; i < 60; i++) {
    scrollContainer.scrollTop = 0;
    await new Promise((r) => setTimeout(r, 350));
    await captureVisible(store);
    const newHeight = scrollContainer.scrollHeight;
    if (newHeight === lastHeight) {
      stableCount++;
      // Require two consecutive stable reads before stopping — the
      // virtualizer sometimes needs an extra tick to settle after it
      // finishes measuring newly-mounted (variable-height) messages.
      if (stableCount >= 2) break;
    } else {
      stableCount = 0;
    }
    lastHeight = newHeight;
  }

  // Leave the page scrolled back to where the user was looking, capturing
  // once more on the way down in case anything near the bottom got
  // unmounted while we were scrolling up.
  scrollContainer.scrollTop = scrollContainer.scrollHeight;
  await new Promise((r) => setTimeout(r, 350));
  await captureVisible(store);

  return scrapeConversation(store);
}
