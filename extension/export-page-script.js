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

  // Dynamic URL.createObjectURL & URL.revokeObjectURL hooks
  if (!window.__claudeCreateObjectUrlHooked) {
    window.__claudeCreateObjectUrlHooked = true;
    const origCreate = URL.createObjectURL.bind(URL);
    const origRevoke = URL.revokeObjectURL.bind(URL);

    URL.createObjectURL = function (obj) {
      const url = origCreate(obj);
      try {
        const isBlob =
          obj &&
          (obj instanceof Blob ||
            (typeof File !== "undefined" && obj instanceof File) ||
            (typeof obj.size === "number" && typeof obj.slice === "function"));
        if (isBlob) {
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
          window.__claudeLastCapturedBlob = item;

          const reader = new FileReader();
          reader.onload = () => {
            item.dataUrl = reader.result;
          };
          reader.readAsDataURL(obj);
        }
      } catch (e) {}
      return url;
    };

    URL.revokeObjectURL = function (url) {
      try {
        const isExportActive =
          document.documentElement.getAttribute("data-claude-export-active") === "true";
        if (isExportActive) {
          setTimeout(() => {
            try {
              origRevoke(url);
            } catch (e) {}
          }, 30000);
          return;
        }
      } catch (e) {}
      return origRevoke(url);
    };
  }

  // Dynamic document.createElement('a') hook to intercept any download link created by Claude
  if (!window.__claudeCreateElementHooked) {
    window.__claudeCreateElementHooked = true;
    const origCreateEl = document.createElement.bind(document);
    document.createElement = function (tag, options) {
      const el = origCreateEl(tag, options);
      if (typeof tag === "string" && tag.toLowerCase() === "a") {
        try {
          const origDispatch = el.dispatchEvent.bind(el);
          el.dispatchEvent = function (event) {
            const isExportActive =
              document.documentElement.getAttribute("data-claude-export-active") === "true";
            const href = el.getAttribute("href") || el.href || "";
            const downloadName = el.getAttribute("download") || el.download || "";
            if (href) {
              let item = window.__claudeExportBlobRegistry?.get(href);
              if (!item) {
                item = {
                  objectUrl: href,
                  blob: null,
                  dataUrl: href.startsWith("data:") ? href : null,
                  filename: downloadName || null,
                  mimeType: "application/octet-stream",
                  timestamp: Date.now(),
                };
                window.__claudeExportBlobRegistry?.set(href, item);
              }
              if (downloadName) item.filename = downloadName;
              window.__claudeLastCapturedBlob = item;

              if (!item.dataUrl && (href.startsWith("blob:") || href.startsWith("http"))) {
                fetch(href)
                  .then((r) => r.blob())
                  .then((b) => {
                    item.blob = b;
                    item.mimeType = b.type || item.mimeType;
                    const reader = new FileReader();
                    reader.onload = () => {
                      item.dataUrl = reader.result;
                    };
                    reader.readAsDataURL(b);
                  })
                  .catch(() => {});
              }
            }
            if (isExportActive) {
              try {
                event?.preventDefault?.();
                event?.stopPropagation?.();
              } catch (e) {}
              return false;
            }
            return origDispatch(event);
          };

          const origElClick = el.click.bind(el);
          el.click = function () {
            const isExportActive =
              document.documentElement.getAttribute("data-claude-export-active") === "true";
            const href = el.getAttribute("href") || el.href || "";
            const downloadName = el.getAttribute("download") || el.download || "";
            if (href) {
              let item = window.__claudeExportBlobRegistry?.get(href);
              if (!item) {
                item = {
                  objectUrl: href,
                  blob: null,
                  dataUrl: href.startsWith("data:") ? href : null,
                  filename: downloadName || null,
                  mimeType: "application/octet-stream",
                  timestamp: Date.now(),
                };
                window.__claudeExportBlobRegistry?.set(href, item);
              }
              if (downloadName) item.filename = downloadName;
              window.__claudeLastCapturedBlob = item;

              if (!item.dataUrl && (href.startsWith("blob:") || href.startsWith("http"))) {
                fetch(href)
                  .then((r) => r.blob())
                  .then((b) => {
                    item.blob = b;
                    item.mimeType = b.type || item.mimeType;
                    const reader = new FileReader();
                    reader.onload = () => {
                      item.dataUrl = reader.result;
                    };
                    reader.readAsDataURL(b);
                  })
                  .catch(() => {});
              }

              if (isExportActive) return;
            }
            return origElClick();
          };
        } catch (e) {}
      }
      return el;
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

          if (!item.dataUrl && (href.startsWith("blob:") || href.startsWith("http"))) {
            fetch(href)
              .then((r) => r.blob())
              .then((b) => {
                item.blob = b;
                item.mimeType = b.type || item.mimeType;
                const reader = new FileReader();
                reader.onload = () => {
                  item.dataUrl = reader.result;
                };
                reader.readAsDataURL(b);
              })
              .catch(() => {});
          }

          // Suppress native browser download prompt during active export so files are packed
          // neatly into the export ZIP rather than creating stray browser downloads.
          if (isExportActive) {
            return;
          }
        }
      } catch (e) {}
      return origClick.apply(this, arguments);
    };

    const originalAppendChild = Node.prototype.appendChild;
    Node.prototype.appendChild = function (child) {
      try {
        if (
          child &&
          (child.tagName === "A" || child.nodeName === "A") &&
          (child.hasAttribute?.("download") || child.download)
        ) {
          const href = child.getAttribute("href") || child.href || "";
          const downloadName = child.getAttribute("download") || child.download || "";
          let item = window.__claudeExportBlobRegistry?.get(href) || window.__claudeLastCapturedBlob;
          if (item) {
            if (downloadName) item.filename = downloadName;
            window.__claudeLastCapturedBlob = item;
          }
          window.__claudeExportedFilenames = window.__claudeExportedFilenames || new Map();
          if (downloadName) {
            window.__claudeExportedFilenames.set(downloadName.toLowerCase(), Date.now());
          }
          const normName = (downloadName || "").toLowerCase();
          const lastExportedAt = window.__claudeExportedFilenames.get(normName);
          const isRecentlyExported = lastExportedAt && Date.now() - lastExportedAt < 15000;
          if (isExportActive || isRecentlyExported) {
            child.click = function () {
              return false;
            };
            try {
              child.addEventListener(
                "click",
                (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  e.stopImmediatePropagation?.();
                  return false;
                },
                true
              );
            } catch (e) {}
          }
        }
      } catch (e) {}
      return originalAppendChild.call(this, child);
    };

    try {
      document.querySelectorAll("iframe").forEach((frame) => {
        try {
          const w = frame.contentWindow;
          if (w && !w.__claudeAnchorClickHooked && w.HTMLAnchorElement?.prototype) {
            w.__claudeAnchorClickHooked = true;
            const subClick = w.HTMLAnchorElement.prototype.click;
            w.HTMLAnchorElement.prototype.click = function () {
              const isExportActive =
                document.documentElement.getAttribute("data-claude-export-active") === "true";
              const downloadName = this.getAttribute("download") || this.download || "";
              const lastExportedAt = window.__claudeExportedFilenames?.get((downloadName || "").toLowerCase());
              const isRecentlyExported = lastExportedAt && Date.now() - lastExportedAt < 15000;
              if (isExportActive || isRecentlyExported) {
                return;
              }
              return subClick.apply(this, arguments);
            };
          }
          if (w && !w.__claudeAppendChildHooked && w.Node?.prototype) {
            w.__claudeAppendChildHooked = true;
            const subAppend = w.Node.prototype.appendChild;
            w.Node.prototype.appendChild = function (child) {
              try {
                if (child && (child.tagName === "A" || child.nodeName === "A") && (child.hasAttribute?.("download") || child.download)) {
                  const downloadName = child.getAttribute("download") || child.download || "";
                  const isExportActive =
                    document.documentElement.getAttribute("data-claude-export-active") === "true";
                  const lastExportedAt = window.__claudeExportedFilenames?.get((downloadName || "").toLowerCase());
                  const isRecentlyExported = lastExportedAt && Date.now() - lastExportedAt < 15000;
                  if (isExportActive || isRecentlyExported) {
                    child.click = function () { return false; };
                  }
                }
              } catch (e) {}
              return subAppend.call(this, child);
            };
          }
        } catch (e) {}
      });
    } catch (e) {}

    // Capture and suppress any native download events on anchors during active export
    document.addEventListener(
      "click",
      (e) => {
        const isExportActive =
          document.documentElement.getAttribute("data-claude-export-active") === "true";
        if (!isExportActive) return;

        let el = e.target;
        while (el && el !== document.documentElement) {
          if (el.tagName === "A" && (el.href || el.getAttribute("href"))) {
            const href = el.getAttribute("href") || el.href || "";
            const downloadName = el.getAttribute("download") || el.download || "";
            let item = window.__claudeExportBlobRegistry?.get(href);
            if (!item) {
              item = {
                objectUrl: href,
                blob: null,
                dataUrl: href.startsWith("data:") ? href : null,
                filename: downloadName || null,
                mimeType: "application/octet-stream",
                timestamp: Date.now(),
              };
              window.__claudeExportBlobRegistry?.set(href, item);
            }
            if (downloadName) item.filename = downloadName;
            window.__claudeLastCapturedBlob = item;

            if (!item.dataUrl && (href.startsWith("blob:") || href.startsWith("http"))) {
              fetch(href)
                .then((r) => r.blob())
                .then((b) => {
                  item.blob = b;
                  item.mimeType = b.type || item.mimeType;
                  const reader = new FileReader();
                  reader.onload = () => {
                    item.dataUrl = reader.result;
                  };
                  reader.readAsDataURL(b);
                })
                .catch(() => {});
            }

            e.preventDefault();
            e.stopPropagation();
            return false;
          }
          el = el.parentElement;
        }
      },
      true
    );
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
      let title = "";
      const titleEl = node.querySelector('.line-clamp-1, [class*="title"], [class*="truncate"]');
      if (titleEl && titleEl.textContent.trim()) {
        title = titleEl.textContent.trim();
      } else {
        const label =
          node.getAttribute("aria-label") ||
          node.querySelector("[aria-label]")?.getAttribute("aria-label") ||
          "";
        const match = label.match(/(?:download|view|file|attachment|artifact)\s+([^\n\r]+)/i);
        if (match) {
          title = match[1].trim();
        } else if (node.textContent.trim() && node.textContent.trim().length < 80) {
          title = node.textContent.trim();
        }
      }
      if (!title || /^(download|view|copy|artifact|attachment)$/i.test(title)) {
        title = "artifact";
      }

      const typeEl = node.querySelector(
        '.text-footnote, .text-xs, [class*="subtitle"], [class*="type"], [class*="footnote"]'
      );
      const typeText = (typeEl?.textContent || "").toLowerCase();
      const sheetKind = (node.getAttribute?.("data-sheet-kind") || "").toLowerCase();

      let ext = "";
      if (typeText.includes("png") || sheetKind === "image") ext = ".png";
      else if (typeText.includes("jpg") || typeText.includes("jpeg")) ext = ".jpg";
      else if (typeText.includes("webp")) ext = ".webp";
      else if (typeText.includes("svg")) ext = ".svg";
      else if (typeText.includes("pptx") || typeText.includes("presentation") || typeText.includes("powerpoint")) ext = ".pptx";
      else if (typeText.includes("pdf") || typeText.includes("document")) ext = ".pdf";
      else if (typeText.includes("json")) ext = ".json";
      else if (typeText.includes("csv")) ext = ".csv";
      else if (typeText.includes("html")) ext = ".html";
      else if (typeText.includes("markdown") || typeText.includes("md")) ext = ".md";
      else if (typeText.includes("python") || typeText.includes("py")) ext = ".py";
      else if (typeText.includes("javascript") || typeText.includes("js")) ext = ".js";
      else if (typeText.includes("zip") || typeText.includes("archive")) ext = ".zip";

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

    // Downloads an artifact or file attachment. Prefers in-card direct download button,
    // with reliable fallback to preview drawer/modal (and canvas extraction) if direct capture doesn't yield dataUrl.
    async function downloadArtifactOrAttachment(node, filename) {
      window.__claudeLastCapturedBlob = null;
      window.__tempSavedAttachments = window.__tempSavedAttachments || new Map();

      if (filename && window.__tempSavedAttachments.has(filename)) {
        const cached = window.__tempSavedAttachments.get(filename);
        return {
          triggered: true,
          dataUrl: cached.dataUrl,
          url: cached.url || null,
          filename: cached.filename || filename,
          mimeType: cached.mimeType,
        };
      }

      // Ensure the card element is visible in the viewport so Claude's event handlers fire
      try {
        node.scrollIntoView({ block: "center", behavior: "instant" });
        await new Promise((r) => setTimeout(r, 120));
      } catch (e) {}

      // 1. Direct in-place download button check (e.g. on artifact cards)
      const directDownloadBtn =
        node.querySelector('button[aria-label^="Download"], button[data-cds="Button"][aria-label*="Download"]') ||
        (node.tagName?.toLowerCase() === "button" && /download/i.test(node.getAttribute("aria-label") || "") ? node : null);

      if (directDownloadBtn && typeof directDownloadBtn.click === "function") {
        directDownloadBtn.click();

        // Claude needs ~1.5 - 2.5s for its generation animation. Poll up to 3.5s.
        for (let i = 0; i < 35; i++) {
          await new Promise((r) => setTimeout(r, 100));
          const captured = window.__claudeLastCapturedBlob;
          if (captured) {
            let dataUrl = captured.dataUrl;
            if (!dataUrl && captured.blob) {
              dataUrl = await readBlobToDataUrl(captured.blob);
            }
            if (!dataUrl && captured.objectUrl) {
              dataUrl = await fetchBlobToDataUrl(captured.objectUrl);
            }
            if (dataUrl) {
              const res = {
                triggered: true,
                dataUrl,
                url: captured.objectUrl || null,
                filename: captured.filename || filename,
                mimeType: captured.mimeType,
              };
              window.__tempSavedAttachments.set(filename, res);
              if (res.filename) window.__tempSavedAttachments.set(res.filename, res);
              return res;
            }
          }
        }
      }

      // 2. Chip Preview Fallback (used when direct download button was absent or did not yield dataUrl)
      const clickable =
        node.tagName?.toLowerCase() === "button"
          ? node
          : node.querySelector('button[aria-label^="View"], button') || node;

      if (clickable && typeof clickable.click === "function") {
        clickable.click();
        await new Promise((r) => setTimeout(r, 550));

        // Check if image is directly rendered in preview modal / drawer
        const modalImg = document.querySelector(
          '[role="dialog"] img, aside img, [class*="drawer"] img, [class*="artifact"] img, [data-sheet-kind] img, [class*="sheet"] img, [data-testid*="artifact"] img, [data-testid*="preview"] img'
        );
        if (modalImg) {
          if (!modalImg.complete && modalImg.src) {
            await new Promise((resolve) => {
              modalImg.onload = resolve;
              modalImg.onerror = resolve;
              setTimeout(resolve, 400);
            });
          }
          const src = modalImg.currentSrc || modalImg.src || "";
          let dataUrl = null;
          if (src.startsWith("data:")) {
            dataUrl = src;
          } else if (src.startsWith("blob:") || src.startsWith("http")) {
            dataUrl = await fetchBlobToDataUrl(src);
          }
          if (!dataUrl) {
            try {
              const canvas = document.createElement("canvas");
              canvas.width = modalImg.naturalWidth || modalImg.width || 300;
              canvas.height = modalImg.naturalHeight || modalImg.height || 150;
              if (canvas.width > 0 && canvas.height > 0) {
                const ctx = canvas.getContext("2d");
                ctx.drawImage(modalImg, 0, 0);
                dataUrl = canvas.toDataURL("image/png");
              }
            } catch (e) {}
          }
          if (dataUrl) {
            dismissModal();
            const res = {
              triggered: true,
              dataUrl,
              url: src,
              filename,
              mimeType: "image/png",
            };
            window.__tempSavedAttachments.set(filename, res);
            return res;
          }
        }

        const modalDownloadBtn = Array.from(document.querySelectorAll("button")).find((el) => {
          if (el === directDownloadBtn) return false;
          const aria = (el.getAttribute("aria-label") || "").toLowerCase();
          const txt = (el.textContent || "").trim().toLowerCase();
          return aria.includes("download") || txt === "download";
        });

        if (modalDownloadBtn && typeof modalDownloadBtn.click === "function") {
          modalDownloadBtn.click();
          for (let i = 0; i < 25; i++) {
            await new Promise((r) => setTimeout(r, 100));
            const captured = window.__claudeLastCapturedBlob;
            if (captured) {
              let dataUrl = captured.dataUrl;
              if (!dataUrl && captured.blob) {
                dataUrl = await readBlobToDataUrl(captured.blob);
              }
              if (!dataUrl && captured.objectUrl) {
                dataUrl = await fetchBlobToDataUrl(captured.objectUrl);
              }
              if (dataUrl) {
                dismissModal();
                const res = {
                  triggered: true,
                  dataUrl,
                  url: captured.objectUrl || null,
                  filename: captured.filename || filename,
                  mimeType: captured.mimeType,
                };
                window.__tempSavedAttachments.set(filename, res);
                if (res.filename) window.__tempSavedAttachments.set(res.filename, res);
                return res;
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
      const rawCardNodes = Array.from(
        turnEl.querySelectorAll(
          '.group\\/artifact-block, [class*="artifact-block"], [data-testid*="attachment"], [data-testid*="artifact"], [data-testid="document-thumbnail"], [class*="attachment-item"]'
        )
      );

      // Filter out non-cards (like inputs) and descendants of other matched cards
      const topLevelCards = rawCardNodes.filter((node) => {
        if (node.tagName === "INPUT" || node.tagName === "IMG" || node.tagName === "A") {
          return false;
        }
        return !rawCardNodes.some((other) => other !== node && other.contains(node));
      });

      const seenCardContainers = new Set();

      for (const node of topLevelCards) {
        const cardContainer =
          node.closest?.(
            '.group\\/artifact-block, [class*="artifact-block"], [class*="attachment-item"], [data-testid*="attachment"], [data-testid*="artifact"]'
          ) || node;
        if (seenCardContainers.has(cardContainer)) continue;
        seenCardContainers.add(cardContainer);

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
      let turns = Array.from(document.querySelectorAll('[data-testid="transcript-row"]'));
      if (turns.length === 0) {
        turns = Array.from(
          document.querySelectorAll('[role="article"][aria-label^="Message "]')
        );
      }

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
          container?.closest?.("[data-item-index], [data-index], [data-rs-index], [aria-posinset]") ||
          container;
        const posinset =
          posinsetEl?.getAttribute?.("data-item-index") ||
          posinsetEl?.getAttribute?.("aria-posinset") ||
          posinsetEl?.getAttribute?.("data-index") ||
          posinsetEl?.getAttribute?.("data-rs-index");

        const text = elementToMarkdown(el);
        const thought = role === "assistant" ? await extractClaudeThoughts(container) : null;
        const attachments = findAttachmentsIn(container);

        if (!text && !thought && attachments.length === 0) continue;

        const textSig = (text || "").replace(/\s+/g, " ").trim().slice(0, 100);
        const key =
          posinset != null
            ? `p:${posinset}`
            : `c:${role}:${textSig}`;

        if (!store.has(key)) {
          store.set(key, {
            role,
            text,
            thought,
            attachments,
            order: posinset != null ? Number(posinset) : store.size,
          });
        } else {
          // If existing entry has no thought or fewer attachments, enrich it
          const existing = store.get(key);
          if (!existing.thought && thought) {
            existing.thought = thought;
          }
          if ((!existing.attachments || existing.attachments.length === 0) && attachments.length > 0) {
            existing.attachments = attachments;
          }
        }
      }
    }

    async function resolveAllAttachments(store) {
      const shouldSkip = options?.skipDownloads === true || options?.includeAttachments === false;
      if (shouldSkip) {
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
      const attemptedContainers = new WeakSet();

      for (const item of store.values()) {
        for (const att of item.attachments) {
          if (att.node && !att.dataUrl) {
            const cardContainer =
              att.node.closest?.(
                '.group\\/artifact-block, [class*="artifact-block"], [class*="attachment-item"], [data-testid*="attachment"], [data-testid*="artifact"]'
              ) || att.node;

            if (attemptedContainers.has(cardContainer)) {
              if (downloadedCards.has(att.filename)) {
                att.dataUrl = downloadedCards.get(att.filename);
              }
              delete att.node;
              continue;
            }
            attemptedContainers.add(cardContainer);

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
                if (outcome.filename) {
                  att.filename = outcome.filename;
                  downloadedCards.set(outcome.filename, outcome.dataUrl);
                  attemptedFilenames.add(outcome.filename);
                }
                att.mimeType = outcome.mimeType;
                downloadedCards.set(att.filename, outcome.dataUrl);
              }
              if (outcome.url) {
                att.url = outcome.url;
              }
              if (!outcome.dataUrl && /^pasted\b/i.test(att.filename)) {
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
          if (!att.dataUrl && window.__tempSavedAttachments?.has(att.filename)) {
            const cached = window.__tempSavedAttachments.get(att.filename);
            att.dataUrl = cached.dataUrl;
            if (cached.mimeType) att.mimeType = cached.mimeType;
            if (cached.url) att.url = cached.url;
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
    setTimeout(() => {
      try {
        document.documentElement.removeAttribute("data-claude-export-active");
      } catch (e) {}
    }, 8000);
  }
}
