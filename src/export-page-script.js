// export-page-script.js
//
// Injected into the active claude.ai page via chrome.scripting.executeScript.
// Traverses virtualized chat DOM, captures all message turns, auto-expands
// Claude's thought/reasoning streams (including incomplete cut-off turns),
// triggers direct in-place artifact downloads, and captures attachments
// with zero token/credit cost.

export async function exportClaudeConversationInPage() {
  function serializeNode(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (node.nodeType !== Node.ELEMENT_NODE) return "";

    // Skip accessibility utility labels and hover action toolbars
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

    return Array.from(node.childNodes).map(serializeNode).join("");
  }

  function elementToMarkdown(el) {
    if (!el) return "";
    return serializeNode(el).replace(/\n{3,}/g, "\n\n").trim();
  }

  function sanitizeAttachmentName(name) {
    return (
      (name || "file")
        .replace(/[\\/:*?"<>|]+/g, "-")
        .trim()
        .slice(0, 80) || "file"
    );
  }

  function findTurnContainer(textEl) {
    const byTestId = textEl.closest(
      '[data-testid="transcript-row"], [data-testid="user-turn"], [data-testid="agent-turn"], [data-testid="assistant-turn"], [role="article"]'
    );
    if (byTestId) return byTestId;

    let node = textEl;
    for (let i = 0; i < 5 && node.parentElement; i++) {
      node = node.parentElement;
    }
    return node;
  }

  // Extracts and auto-expands Claude's internal thought process
  async function extractClaudeThoughts(turnEl) {
    if (!turnEl) return null;

    // Find thought trigger button: e.g. "Thought for 21s", "Thought for 45s", or status disclosure
    const allButtons = Array.from(turnEl.querySelectorAll("button"));
    const thoughtBtn = allButtons.find((btn) => {
      const text = (btn.textContent || "").trim();
      const aria = (btn.getAttribute("aria-label") || "").trim();
      return /thought for \d+s/i.test(text) || /thought for \d+s/i.test(aria);
    });

    if (!thoughtBtn) {
      // Check for an already-open thought container without a standard button
      const openCollapsible = turnEl.querySelector(
        '[data-cds="Collapsible"][data-open], div[class*="thought"]'
      );
      if (openCollapsible && openCollapsible.textContent.trim()) {
        return {
          text: elementToMarkdown(openCollapsible),
          duration: "Internal Reasoning",
        };
      }
      return null;
    }

    const durationMatch = (
      thoughtBtn.textContent ||
      thoughtBtn.getAttribute("aria-label") ||
      ""
    ).match(/thought for (\d+s)/i);
    const duration = durationMatch ? durationMatch[0] : "Thought Process";

    // Locate the collapsible container that holds the thinking stream
    let collapsible =
      turnEl.querySelector('[data-cds="Collapsible"]') ||
      thoughtBtn.closest("div")?.parentElement?.querySelector('[data-cds="Collapsible"]');

    let wasClosed = false;
    if (collapsible) {
      wasClosed =
        collapsible.hasAttribute("data-closed") ||
        collapsible.getAttribute("data-closed") === "" ||
        collapsible.clientHeight === 0;
    } else {
      wasClosed = true;
    }

    // If closed or unmounted, click button to mount the thinking markdown
    if (wasClosed) {
      thoughtBtn.click();
      await new Promise((r) => setTimeout(r, 180));
      collapsible =
        turnEl.querySelector('[data-cds="Collapsible"]') ||
        thoughtBtn.closest("div")?.parentElement?.querySelector('[data-cds="Collapsible"]');
    }

    const thoughtText = collapsible
      ? elementToMarkdown(collapsible)
      : "";

    return thoughtText ? { text: thoughtText, duration } : null;
  }

  // Pasted-text chips
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

  const processedAttachmentChips = new Set();

  function waitForBlobCaptureEvent(timeoutMs = 6000) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        document.removeEventListener("__claude_export_blob_captured", blobHandler);
        document.removeEventListener("__claude_export_anchor_clicked", anchorHandler);
        clearTimeout(timer);
        resolve(result);
      };
      const blobHandler = (e) => finish(e.detail);
      const anchorHandler = (e) => finish(e.detail);
      const timer = setTimeout(() => finish(null), timeoutMs);

      document.addEventListener("__claude_export_blob_captured", blobHandler);
      document.addEventListener("__claude_export_anchor_clicked", anchorHandler);
    });
  }

  // Downloads an artifact or file attachment. Prefers in-card direct download button.
  async function downloadArtifactOrAttachment(node, filename) {
    if (processedAttachmentChips.has(filename)) {
      return { triggered: false, dataUrl: null, mimeType: null };
    }
    processedAttachmentChips.add(filename);

    // 1. Direct in-place download button check (e.g. on artifact cards)
    const directDownloadBtn =
      node.querySelector('button[aria-label^="Download"], button[data-cds="Button"][aria-label*="Download"]') ||
      (node.tagName?.toLowerCase() === "button" && /download/i.test(node.getAttribute("aria-label") || "") ? node : null);

    if (directDownloadBtn && typeof directDownloadBtn.click === "function") {
      const capturePromise = waitForBlobCaptureEvent(6000);
      directDownloadBtn.click();
      const blobCapture = await capturePromise;
      if (blobCapture) {
        return {
          triggered: true,
          dataUrl: blobCapture.dataUrl,
          mimeType: blobCapture.mimeType,
        };
      }
    }

    // 2. Chip Preview Fallback
    const clickable =
      node.tagName?.toLowerCase() === "button"
        ? node
        : node.querySelector("button") || node;

    if (!clickable || typeof clickable.click !== "function") {
      return { triggered: false, dataUrl: null, mimeType: null };
    }

    clickable.click();
    await new Promise((r) => setTimeout(r, 200));

    const modalDownloadBtn = Array.from(document.querySelectorAll("button")).find((el) => {
      const aria = (el.getAttribute("aria-label") || "").toLowerCase();
      const txt = (el.textContent || "").trim().toLowerCase();
      return aria.startsWith("download") || txt.startsWith("download");
    });

    let blobCapture = null;
    let triggered = false;
    if (modalDownloadBtn) {
      const capturePromise = waitForBlobCaptureEvent(6000);
      modalDownloadBtn.click();
      triggered = true;
      blobCapture = await capturePromise;
    }

    // Dismiss preview modal
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
    await new Promise((r) => setTimeout(r, 120));

    return {
      triggered,
      dataUrl: blobCapture?.dataUrl || null,
      mimeType: blobCapture?.mimeType || null,
    };
  }

  // Scrapes attachments in a turn
  async function findAttachmentsIn(turnEl) {
    const attachments = [];
    const seen = new Set();
    const add = (a) => {
      const key = `${a.type}|${a.filename}|${a.url || ""}`;
      if (seen.has(key)) return;
      seen.add(key);
      attachments.push(a);
    };

    // 1. Inline images
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

    // 2. Direct href document links
    turnEl.querySelectorAll("a[href]").forEach((a) => {
      const href = a.href;
      const hasDownloadAttr = a.hasAttribute("download");
      const looksLikeFile =
        hasDownloadAttr ||
        /\.(pdf|docx?|xlsx?|csv|txt|zip|pptx?|json|py|js|ts|tsx|jsx|md|html|css)(\?|$)/i.test(
          href
        );
      if (href && /^https?:\/\//.test(href) && looksLikeFile) {
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

    // 3. Artifact Cards & File Thumbnail Chips
    const cardNodes = Array.from(
      turnEl.querySelectorAll(
        '.group\\/artifact-block, [class*="artifact-block"], [data-testid*="file"], [data-testid*="attachment"], [data-testid*="artifact"], [data-testid="document-thumbnail"]'
      )
    );

    for (const node of cardNodes) {
      if (node.querySelector("img, a[href]")) continue;
      const label =
        node.getAttribute("aria-label") ||
        node.getAttribute("title") ||
        node.querySelector("[aria-label]")?.getAttribute("aria-label") ||
        node.querySelector(".line-clamp-1")?.textContent ||
        node.textContent.trim();

      if (!label || label.length >= 140) continue;
      const filename = sanitizeAttachmentName(
        label.replace(/^(view|open|download)\s+/i, "")
      );

      let dataUrl = null;
      let mimeType = null;
      let triggered = false;

      try {
        const outcome = await downloadArtifactOrAttachment(node, filename);
        triggered = outcome.triggered;
        dataUrl = outcome.dataUrl;
        mimeType = outcome.mimeType;
      } catch (e) {
        // Fallback
      }

      let pastedText = null;
      if (!dataUrl && !triggered && /^pasted\b/i.test(label)) {
        pastedText = await extractPastedText(node);
      }

      add({
        type: dataUrl ? "file" : pastedText ? "text" : triggered ? "file" : "reference",
        filename,
        url: null,
        dataUrl,
        mimeType,
        pastedText,
        nativeDownloadTriggered: triggered,
      });
    }

    return attachments;
  }

  // Identifies message turns across current and legacy Claude DOMs
  function findMessageElements() {
    const turns = Array.from(
      document.querySelectorAll(
        '[data-testid="transcript-row"], [role="article"][aria-label^="Message "]'
      )
    );

    if (turns.length > 0) {
      return turns.map((turnEl) => {
        const heading = turnEl.querySelector("h2.sr-only, h2[class*='sr-only']");
        const headingText = heading ? heading.textContent.trim().toLowerCase() : "";
        const userContentEl = turnEl.querySelector('[data-testid="user-message"], .font-user-message');

        let role, el;
        if (headingText.startsWith("you said") || userContentEl) {
          role = "user";
          el = userContentEl || turnEl;
        } else {
          role = "assistant";
          el =
            turnEl.querySelector(
              ".font-claude-response, .standard-markdown, .progressive-markdown"
            ) || turnEl;
        }
        return { role, el, turnEl };
      });
    }

    // Fallback
    const fallbackNodes = Array.from(
      document.querySelectorAll(".font-user-message, .font-claude-response, .font-claude-message")
    );
    return fallbackNodes.map((el) => ({
      role: el.classList.contains("font-user-message") ? "user" : "assistant",
      el,
      turnEl: el.closest('[data-testid="transcript-row"]') || el,
    }));
  }

  async function captureVisible(store) {
    const found = findMessageElements();
    for (const { role, el, turnEl } of found) {
      const container = turnEl || findTurnContainer(el);
      const posinsetEl =
        container?.closest?.("[aria-posinset], [data-index], [data-rs-index]") ||
        container;
      const posinset =
        posinsetEl?.getAttribute?.("aria-posinset") ||
        posinsetEl?.getAttribute?.("data-index") ||
        posinsetEl?.getAttribute?.("data-rs-index");

      const text = elementToMarkdown(el);
      const thought = role === "assistant" ? await extractClaudeThoughts(container) : null;
      const attachments = await findAttachmentsIn(container);

      if (!text && !thought && attachments.length === 0) continue;

      const key =
        posinset != null
          ? `p:${posinset}`
          : `c:${role}:${(text || thought?.text || "").slice(0, 150)}`;

      store.set(key, {
        role,
        text,
        thought,
        attachments,
        order: posinset != null ? Number(posinset) : store.size,
      });
    }
  }

  function scrapeConversation(store) {
    const messages = Array.from(store.values())
      .sort((a, b) => a.order - b.order)
      .map(({ role, text, thought, attachments }) => ({
        role,
        text,
        thought,
        attachments,
      }));

    const chatMatch = location.pathname.match(/\/chat\/([a-zA-Z0-9_-]+)/);
    const chatId = chatMatch ? chatMatch[1] : "";

    return {
      title:
        document.title.replace(/\s*[|\-–]\s*Claude.*$/i, "").trim() ||
        "Claude conversation",
      url: location.href,
      chatId,
      exportedAt: new Date().toISOString(),
      messages,
    };
  }

  const scrollContainer =
    document.querySelector('[data-autoscroll-container="true"]') ||
    document.querySelector("main") ||
    document.scrollingElement ||
    document.body;

  const store = new Map();

  // Initial capture at current scroll position
  await captureVisible(store);

  // Scroll through virtualized history to top
  let lastHeight = -1;
  let stableCount = 0;
  for (let i = 0; i < 60; i++) {
    scrollContainer.scrollTop = 0;
    await new Promise((r) => setTimeout(r, 300));
    await captureVisible(store);
    const newHeight = scrollContainer.scrollHeight;
    if (newHeight === lastHeight) {
      stableCount++;
      if (stableCount >= 2) break;
    } else {
      stableCount = 0;
    }
    lastHeight = newHeight;
  }

  // Restore scroll position
  scrollContainer.scrollTop = scrollContainer.scrollHeight;
  await new Promise((r) => setTimeout(r, 300));
  await captureVisible(store);

  return scrapeConversation(store);
}
