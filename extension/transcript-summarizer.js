// transcript-summarizer.js
//
// Zero-token client-side structural AST analyzer and context relay generator.
// Analyzes conversation turns, extracts key objectives, architectural decisions,
// code artifacts, reasoning steps, and synthesizes a token-efficient context
// bootstrap prompt for instant multi-account hopping. 100% offline & client-side.

function extractCodeBlocks(text) {
  if (!text) return [];
  const blocks = [];
  const regex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const lang = (match[1] || "").trim() || "plaintext";
    const code = (match[2] || "").trim();
    const firstLine = code.split("\n")[0].trim().replace(/^[\/\/#*<!--]+/, "").trim();
    blocks.push({
      language: lang,
      lineCount: code.split("\n").length,
      preview: firstLine.slice(0, 60) || `${lang} snippet`,
      fullLength: code.length,
    });
  }
  return blocks;
}

function cleanExcerpt(text, maxLen = 140) {
  if (!text) return "";
  const cleaned = text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/[#*`_>\[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length <= maxLen) return cleaned;
  return cleaned.slice(0, maxLen).trim() + "…";
}

function extractKeyObjective(messages) {
  const userMessages = messages.filter((m) => m.role === "user");
  if (userMessages.length === 0) return "General discussion and problem solving";

  const first = userMessages[0].text || "";
  // Check for goal phrases
  const match = first.match(/(?:i want to|i need to|help me|please|how (?:do|can) i|goal:|objective:)\s*([^\n.?!]+)/i);
  if (match && match[1] && match[1].trim().length > 8) {
    return cleanExcerpt(match[1].trim(), 180);
  }

  // Fallback to first non-empty line of the first prompt
  const firstLine = first.split("\n").find((l) => l.trim().length > 0) || "";
  return cleanExcerpt(firstLine, 180) || "Conversation task and queries";
}

function extractKeyDecisions(messages) {
  const decisions = [];
  const assistantMessages = messages.filter((m) => m.role === "assistant");

  for (const m of assistantMessages) {
    if (!m.text) continue;
    // Look for bullet lists with bold terms or section headers
    const lines = m.text.split("\n");
    for (const line of lines) {
      const bulletMatch = line.match(/^[-*•\d.]+\s+\*\*([^*]+)\*\*[:\s]+(.*)/i);
      if (bulletMatch && bulletMatch[1] && bulletMatch[2]) {
        const title = bulletMatch[1].trim();
        const desc = cleanExcerpt(bulletMatch[2], 100);
        if (title.length > 3 && desc.length > 5) {
          decisions.push(`**${title}**: ${desc}`);
        }
      }
      if (decisions.length >= 4) break;
    }
    if (decisions.length >= 4) break;
  }

  if (decisions.length === 0) {
    decisions.push("Iterative code development and step-by-step problem resolution.");
  }
  return decisions.slice(0, 4);
}

function extractThoughtHighlights(messages) {
  const withThoughts = messages.filter((m) => m.thought && m.thought.text);
  if (withThoughts.length === 0) return null;

  const totalDuration = withThoughts.reduce((acc, m) => {
    const dur = m.thought.duration || "";
    return dur ? `${acc} ${dur}`.trim() : acc;
  }, "");

  const sampleExcerpt = cleanExcerpt(withThoughts[0].thought.text, 160);

  return {
    count: withThoughts.length,
    durationNote: totalDuration || `${withThoughts.length} thinking cycle(s)`,
    excerpt: sampleExcerpt,
  };
}

function extractActiveStateAndNextSteps(messages) {
  if (messages.length === 0) {
    return {
      lastAction: "Session initialized.",
      nextSteps: "Continue task exploration.",
    };
  }

  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");

  let lastAction = "Completed response to user prompt.";
  if (lastAssistant && lastAssistant.text) {
    const codeBlocks = extractCodeBlocks(lastAssistant.text);
    if (codeBlocks.length > 0) {
      lastAction = `Generated/updated ${codeBlocks.length} code block(s) (${codeBlocks.map((c) => c.language).join(", ")}).`;
    } else {
      lastAction = cleanExcerpt(lastAssistant.text, 140);
    }
  }

  let nextSteps = "Ready for user follow-up questions and next development milestone.";
  if (lastAssistant && lastAssistant.text) {
    const lines = lastAssistant.text.split("\n");
    const nextLine = lines.find((l) =>
      /(?:next step|to proceed|you can now|feel free to|let me know|future work)/i.test(l)
    );
    if (nextLine) {
      nextSteps = cleanExcerpt(nextLine, 150);
    }
  }

  return { lastAction, nextSteps };
}

export function generateConversationSummary(data, options = {}) {
  const includeArtifactTable = options.includeArtifactTable !== false;
  const messages = data.messages || [];

  const userCount = messages.filter((m) => m.role === "user").length;
  const assistantCount = messages.filter((m) => m.role === "assistant").length;

  let totalWords = 0;
  const allCodeBlocks = [];
  const allAttachments = [];

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const turnNum = i + 1;
    if (m.text) {
      totalWords += m.text.trim().split(/\s+/).length;
      const blocks = extractCodeBlocks(m.text);
      for (const b of blocks) {
        allCodeBlocks.push({ ...b, turn: turnNum });
      }
    }
    for (const att of m.attachments || []) {
      allAttachments.push({ ...att, turn: turnNum });
    }
  }

  const objective = extractKeyObjective(messages);
  const decisions = extractKeyDecisions(messages);
  const thoughts = extractThoughtHighlights(messages);
  const { lastAction, nextSteps } = extractActiveStateAndNextSteps(messages);

  const metrics = {
    totalTurns: messages.length,
    userTurns: userCount,
    assistantTurns: assistantCount,
    totalWords,
    codeBlocksCount: allCodeBlocks.length,
    attachmentsCount: allAttachments.length,
    thoughtsCount: thoughts ? thoughts.count : 0,
  };

  // Build the fast resume prompt
  const resumeLines = [
    "I am continuing a project from a previous Claude conversation. Here is our active context:",
    "",
    `🎯 Project Goal: ${objective}`,
    "",
    "💡 Key Architectural Decisions:",
    ...decisions.map((d) => `- ${d.replace(/\*\*/g, "")}`),
    "",
  ];

  if (includeArtifactTable && (allCodeBlocks.length > 0 || allAttachments.length > 0)) {
    resumeLines.push("📦 Key Artifacts & Code Deliverables:");
    const distinctFiles = [];
    for (const att of allAttachments) {
      if (att.filename && !distinctFiles.includes(att.filename)) {
        distinctFiles.push(att.filename);
        resumeLines.push(`- File: ${att.filename} (${att.type || "file"})`);
      }
    }
    for (const cb of allCodeBlocks.slice(0, 4)) {
      resumeLines.push(`- Code: ${cb.preview} [${cb.language}]`);
    }
    resumeLines.push("");
  }

  resumeLines.push(
    `⏳ Current State: ${lastAction}`,
    `🚀 Next Step: ${nextSteps}`,
    "",
    "Please acknowledge this context in 1-2 concise sentences and proceed immediately with the next step without repeating past history."
  );

  const resumePrompt = resumeLines.join("\n");

  // Build the full markdown summary
  const summaryLines = [
    `# 📋 Conversation Summary: ${data.title || "Claude Conversation"}`,
    "",
    `> **Exported**: ${new Date(data.exportedAt || Date.now()).toLocaleString()}  `,
    `> **Total Turns**: ${metrics.totalTurns} (${userCount} User / ${assistantCount} Assistant) • **Code Snippets**: ${metrics.codeBlocksCount}  `,
    `> **Original URL**: ${data.url || "https://claude.ai"}  `,
    "",
    "---",
    "",
    "## 🎯 Primary Objective",
    `- ${objective}`,
    "",
    "## 💡 Key Architectural Decisions & Patterns",
    ...decisions.map((d) => `- ${d}`),
    "",
  ];

  if (includeArtifactTable && (allCodeBlocks.length > 0 || allAttachments.length > 0)) {
    summaryLines.push("## 📦 Generated Artifacts & Code Deliverables", "");
    summaryLines.push("| File / Snippet | Type / Language | Details | Turn |");
    summaryLines.push("|---|---|---|---|");

    for (const att of allAttachments) {
      summaryLines.push(
        `| \`${att.filename || "attachment"}\` | ${att.type || "file"} | Downloaded attachment | Turn ${att.turn} |`
      );
    }
    for (const cb of allCodeBlocks) {
      summaryLines.push(
        `| \`${cb.preview}\` | ${cb.language} | Code snippet (${cb.lineCount} lines) | Turn ${cb.turn} |`
      );
    }
    summaryLines.push("");
  }

  if (thoughts) {
    summaryLines.push(
      "## 💭 Claude Reasoning & Thought Highlights",
      `- **Captured Cycles**: ${thoughts.count} reasoning block(s) (${thoughts.durationNote})`,
      `- **Deliberation Sample**: *"${thoughts.excerpt}"*`,
      ""
    );
  }

  summaryLines.push(
    "## ⏳ Current Active State & Next Steps",
    `- **Last Action Completed**: ${lastAction}`,
    `- **Recommended Next Step**: ${nextSteps}`,
    "",
    "---",
    "",
    "## 🚀 Instant Resume Bootstrap Prompt",
    "*(Use this prompt when switching to another account via HotSwap to continue instantly without re-uploading full transcripts)*",
    "",
    "```text",
    resumePrompt,
    "```",
    ""
  );

  const summaryMarkdown = summaryLines.join("\n");

  return {
    title: data.title || "Claude Conversation",
    summaryMarkdown,
    resumePrompt,
    objective,
    decisions,
    lastAction,
    nextSteps,
    metrics,
  };
}
