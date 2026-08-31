// export-page-script.js
//
// Injected into the active claude.ai page via chrome.scripting.executeScript.
// Traverses virtualized chat DOM, captures all message turns, auto-expands
// Claude's thought/reasoning streams (including incomplete cut-off turns),
// triggers direct in-place artifact downloads, and captures attachments
// with zero token/credit cost.

export async function exportClaudeConversationInPage(options = {}) {
  document.documentElement.setAttribute("data-claude-export-active", "true");

  if (!window.__claudeExportBlobRegistry) {
    window.__claudeExportBlobRegistry = new Map();
  }
  window.__claudeLastCapturedBlob = null;

  // Dynamic URL.createObjectURL hook
  if (!window.__claudeCreateObjectUrlHooked) {
    window.__claudeCreateObjectUrlHooked = true;
    const origCreate = URL.createObjectURL.bind(URL);
    URL.createObjectURL = function (obj) {
      const url = origCreate(obj);
      try {
        if (obj instanceof Blob || (typeof File !== "undefined" && obj instanceof File)) {
          const item = {
            objectUrl: url,
            blob: obj,
            dataUrl: null,
            size: obj.size,
            mimeType: obj.type || "application/octet-stream",
            filename: obj.name || null,
            timestamp: Date.now(),
          };
          window.__claudeExportBlobRegistry.set(url, item);

          const reader = new FileReader();
          reader.onload = () => {
            item.dataUrl = reader.result;
          };
          reader.readAsDataURL(obj);
        }
      } catch (e) {}
      return url;
    };
  }

  // Dynamic HTMLAnchorElement.prototype.click hook
  if (!window.__claudeAnchorClickHooked) {
    window.__claudeAnchorClickHooked = true;
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      try {
        const isExportActive =
          document.documentElement.getAttribute("data-claude-export-active") === "true";
        const href = this.getAttribute("href") || this.href || "";
        const downloadName = this.getAttribute("download") || this.download || "";

        if (href) {
          let item = window.__claudeExportBlobRegistry.get(href);
          if (!item) {
            item = {
              objectUrl: href,
              blob: null,
              dataUrl: href.startsWith("data:") ? href : null,
              filename: downloadName || null,
              mimeType: "application/octet-stream",
              timestamp: Date.now(),
            };
            window.__claudeExportBlobRegistry.set(href, item);
          }
          if (downloadName) item.filename = downloadName;
          window.__claudeLastCapturedBlob = item;

          if (isExportActive) {
            return; // Suppress native download prompt
          }
        }
      } catch (e) {}
      return origClick.apply(this, arguments);
    };
  }

  try {
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

    function getArtifactCardDetails(node) {
      const titleEl = node.querySelector('.line-clamp-1, [class*="title"]') || node;
      const title = (titleEl.textContent || "").trim() || "artifact";

      const typeEl = node.querySelector('.text-xs, [class*="subtitle"], [class*="type"]');
      const typeText = (typeEl?.textContent || "").toLowerCase();

      let ext = "";
      if (typeText.includes("pptx") || typeText.includes("presentation") || typeText.includes("powerpoint")) ext = ".pptx";
      else if (typeText.includes("pdf") || typeText.includes("document")) ext = ".pdf";
      else if (typeText.includes("json")) ext = ".json";
      else if (typeText.includes("csv")) ext = ".csv";
      else if (typeText.includes("svg")) ext = ".svg";
      else if (typeText.includes("html")) ext = ".html";
      else if (typeText.includes("markdown") || typeText.includes("md")) ext = ".md";
      else if (typeText.includes("python") || typeText.includes("py")) ext = ".py";
      else if (typeText.includes("javascript") || typeText.includes("js")) ext = ".js";
      else if (typeText.includes("zip") || typeText.includes("archive")) ext = ".zip";
      else if (typeText.includes("png")) ext = ".png";
      else if (typeText.includes("jpg") || typeText.includes("jpeg")) ext = ".jpg";
      else if (typeText.includes("webp")) ext = ".webp";

      let cleanName = sanitizeAttachmentName(title);
      if (ext && !cleanName.toLowerCase().endsWith(ext)) {
        cleanName += ext;
      }

      return {
        title: cleanName,
        ext,
        typeText,
      };
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

      const allButtons = Array.from(turnEl.querySelectorAll("button"));
      const thoughtBtn = allButtons.find((btn) => {
        const text = (btn.textContent || "").trim();
        const aria = (btn.getAttribute("aria-label") || "").trim();
        return /thought for \d+s/i.test(text) || /thought for \d+s/i.test(aria);
      });

      if (!thoughtBtn) {
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

    function readBlobToDataUrl(blob) {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    }

    async function fetchBlobToDataUrl(blobUrl) {
      try {
        const res = await fetch(blobUrl);
        if (!res.ok) return null;
        const blob = await res.blob();
        return await readBlobToDataUrl(blob);
      } catch (e) {
        return null;
      }
    }

    function dismissModal() {
      const backBtn = Array.from(document.querySelectorAll("button")).find(
        (el) =>
          (el.getAttribute("aria-label") || "").toLowerCase() === "go back" ||
          (el.getAttribute("aria-label") || "").toLowerCase() === "close"
      );
      if (backBtn && typeof backBtn.click === "function") {
        backBtn.click();
      } else {
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
        );
      }
    }

    // Downloads an artifact or file attachment. Prefers in-card direct download button.
    async function downloadArtifactOrAttachment(node, filename) {
      window.__claudeLastCapturedBlob = null;

      // 1. Direct in-place download button check (e.g. on artifact cards)
      const directDownloadBtn =
        node.querySelector('button[aria-label^="Download"], button[data-cds="Button"][aria-label*="Download"]') ||
        (node.tagName?.toLowerCase() === "button" && /download/i.test(node.getAttribute("aria-label") || "") ? node : null);

      if (directDownloadBtn && typeof directDownloadBtn.click === "function") {
        directDownloadBtn.click();

        for (let i = 0; i < 35; i++) {
          await new Promise((r) => setTimeout(r, 100));
          const captured = window.__claudeLastCapturedBlob;
          if (captured) {
            let dataUrl = captured.dataUrl;
            if (!dataUrl && captured.blob) {
              dataUrl = await readBlobToDataUrl(captured.blob);
            } else if (!dataUrl && captured.objectUrl) {
              dataUrl = await fetchBlobToDataUrl(captured.objectUrl);
            }
            if (dataUrl) {
              return {
                triggered: true,
                dataUrl,
                filename: captured.filename || filename,
                mimeType: captured.mimeType,
              };
            }
          }
        }
      }

      // 2. Chip Preview Fallback
      const clickable =
        node.tagName?.toLowerCase() === "button"
          ? node
          : node.querySelector('button[aria-label^="View"], button') || node;

      if (clickable && typeof clickable.click === "function") {
        clickable.click();
        await new Promise((r) => setTimeout(r, 300));

        const modalDownloadBtn = Array.from(document.querySelectorAll("button")).find((el) => {
          const aria = (el.getAttribute("aria-label") || "").toLowerCase();
          const txt = (el.textContent || "").trim().toLowerCase();
          return aria.startsWith("download") || txt.startsWith("download");
        });

        if (modalDownloadBtn && typeof modalDownloadBtn.click === "function") {
          modalDownloadBtn.click();
          for (let i = 0; i < 35; i++) {
            await new Promise((r) => setTimeout(r, 100));
            const captured = window.__claudeLastCapturedBlob;
            if (captured) {
              let dataUrl = captured.dataUrl;
              if (!dataUrl && captured.blob) {
                dataUrl = await readBlobToDataUrl(captured.blob);
              } else if (!dataUrl && captured.objectUrl) {
                dataUrl = await fetchBlobToDataUrl(captured.objectUrl);
              }
              if (dataUrl) {
                dismissModal();
                return {
                  triggered: true,
                  dataUrl,
                  filename: captured.filename || filename,
                  mimeType: captured.mimeType,
                };
              }
            }
          }
        }
        dismissModal();
      }

      return { triggered: false, dataUrl: null, mimeType: null };
    }

    // Scrapes attachments in a turn
    function findAttachmentsIn(turnEl) {
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

      // 3. Artifact Cards, User File Chips & File Thumbnail Chips
      const cardNodes = Array.from(
        turnEl.querySelectorAll(
          '.group\\/artifact-block, [class*="artifact-block"], [data-testid*="file"], [data-testid*="attachment"], [data-testid*="artifact"], [data-testid="document-thumbnail"], [class*="attachment-item"]'
        )
      );

      for (const node of cardNodes) {
        if (node.querySelector("img, a[href]")) continue;
        const details = getArtifactCardDetails(node);
        add({
          type: "file",
          filename: details.title,
          url: null,
          dataUrl: null,
          mimeType: null,
          node,
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
        const attachments = findAttachmentsIn(container);

        if (!text && !thought && attachments.length === 0) continue;

        const key =
          posinset != null
            ? `p:${posinset}`
            : `c:${role}:${(text || thought?.text || "").slice(0, 150)}`;

        if (!store.has(key)) {
          store.set(key, {
            role,
            text,
            thought,
            attachments,
            order: posinset != null ? Number(posinset) : store.size,
          });
        }
      }
    }

    async function resolveAllAttachments(store) {
      if (options?.skipDownloads) {
        for (const item of store.values()) {
          for (const att of item.attachments) {
            if (att.node) {
              if (/^pasted\b/i.test(att.filename) || att.type === "text") {
                try {
                  att.pastedText = await extractPastedText(att.node);
                  att.type = "text";
                } catch (e) {}
              }
              delete att.node;
            }
          }
        }
        return;
      }

      const downloadedCards = new Map(); // filename -> dataUrl
      const attemptedFilenames = new Set();

      for (const item of store.values()) {
        for (const att of item.attachments) {
          if (att.node && !att.dataUrl) {
            // Reuse dataUrl if this exact file was already downloaded in an earlier turn
            if (downloadedCards.has(att.filename)) {
              att.dataUrl = downloadedCards.get(att.filename);
              delete att.node;
              continue;
            }

            if (attemptedFilenames.has(att.filename)) {
              delete att.node;
              continue; // Don't trigger duplicate download attempts for the same file
            }
            attemptedFilenames.add(att.filename);

            try {
              const outcome = await downloadArtifactOrAttachment(att.node, att.filename);
              if (outcome.dataUrl) {
                att.dataUrl = outcome.dataUrl;
                if (outcome.filename) att.filename = outcome.filename;
                att.mimeType = outcome.mimeType;
                downloadedCards.set(att.filename, outcome.dataUrl);
              } else if (/^pasted\b/i.test(att.filename)) {
                att.pastedText = await extractPastedText(att.node);
                att.type = "text";
              }
            } catch (e) {
              // Non-fatal
            } finally {
              // Remove DOM reference before serialization to avoid cyclic clones
              delete att.node;
            }
          }
        }
      }

      // Propagate captured dataUrls to any duplicate referenced attachments
      for (const item of store.values()) {
        for (const att of item.attachments) {
          if (!att.dataUrl && downloadedCards.has(att.filename)) {
            att.dataUrl = downloadedCards.get(att.filename);
          }
        }
      }
    }

    function scrapeConversation(store) {
      const messages = Array.from(store.values())
        .sort((a, b) => a.order - b.order)
        .map(({ role, text, thought, attachments }) => ({
          role,
          text,
          thought,
          attachments: attachments.map(({ type, filename, url, dataUrl, mimeType, pastedText }) => ({
            type,
            filename,
            url,
            dataUrl,
            mimeType,
            pastedText,
          })),
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

    // Pass 1: Harvest all message turns across virtualized history
    await captureVisible(store);

    let lastHeight = -1;
    let stableCount = 0;
    for (let i = 0; i < 60; i++) {
      scrollContainer.scrollTop = 0;
      await new Promise((r) => setTimeout(r, 250));
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

    scrollContainer.scrollTop = scrollContainer.scrollHeight;
    await new Promise((r) => setTimeout(r, 250));
    await captureVisible(store);

    // Pass 2: Sequentially download and serialize all collected artifact files
    await resolveAllAttachments(store);

    return scrapeConversation(store);
  } finally {
    document.documentElement.removeAttribute("data-claude-export-active");
  }
}
