import { marked, katex } from "./config.js";

function sanitizeText(text) {
  return (text || "").replace(/\uFFFD/g, "").trim();
}

function normalizeLine(line) {
  return sanitizeText(line).replace(/\s+/g, " ");
}

function dedupeLines(lines) {
  const seen = new Set();
  const out = [];
  lines.forEach((line) => {
    const t = normalizeLine(line);
    if (!t || seen.has(t)) return;
    seen.add(t);
    out.push(t);
  });
  return out;
}

function dedupeSummary(text) {
  const t = sanitizeText(text);
  if (!t) return "";
  const half = Math.floor(t.length / 2);
  if (half > 20 && t.slice(0, half) === t.slice(half)) {
    return t.slice(0, half).trim();
  }
  const paras = t
    .replace(/\r/g, "")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const seen = new Set();
  const uniq = [];
  paras.forEach((p) => {
    if (seen.has(p)) return;
    seen.add(p);
    uniq.push(p);
  });
  return uniq.join("\n\n");
}

function mergeEmojiSingles(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (
      /^[🤖🧠🛠️🚀🌎🧑‍💻📈💡🧭🏁🎯🔧⚙️📌📍]$/u.test(line) &&
      i + 1 < lines.length
    ) {
      out.push(`${line} ${lines[i + 1]}`.trim());
      i += 1;
    } else {
      out.push(line);
    }
  }
  return out;
}

function parseBriefLines(raw) {
  if (!raw) return [];
  let cleaned = sanitizeText(raw).replace(/\r/g, "");

  try {
    cleaned = cleaned.replace(
      /([^\n])\s*(?=\p{Extended_Pictographic})/gu,
      "$1\n",
    );
  } catch (e) {
    cleaned = cleaned.replace(
      /([^\n])\s*(?=[🤖🧠🛠️🚀🌎🧑‍💻📈💡🧭🏁🎯🔧⚙️📌📍])/gu,
      "$1\n",
    );
  }

  const lines = cleaned
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return dedupeLines(lines);
}

function tryParseKeywords(raw) {
  if (!raw) return [];
  const cleaned = sanitizeText(raw);
  const candidates = [];

  const attempt = (str) => {
    try {
      const parsed = JSON.parse(str);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && typeof parsed === "object") return [parsed];
    } catch {
      return null;
    }
    return null;
  };

  let parsed = attempt(cleaned);
  if (!parsed) {
    if (cleaned.includes("},{") && !cleaned.trim().startsWith("[")) {
      parsed = attempt(`[${cleaned}]`);
    }
  }
  if (!parsed) {
    const matches = cleaned.match(/\{[^}]+\}/g);
    if (matches) {
      parsed = matches
        .map((m) => attempt(m))
        .filter((v) => v)
        .flat();
    }
  }
  if (!parsed) return [];

  return parsed
    .map((item) => {
      const term = sanitizeText(item.term || item.keyword || item.name || "");
      const desc = sanitizeText(item.desc || item.description || "");
      if (!term) return null;
      return { term, desc };
    })
    .filter(Boolean);
}

function renderKeywords(reply, keywordsBody, lastKeywordsList) {
  if (!keywordsBody) return;
  keywordsBody.innerHTML = "";
  try {
    const parsed = tryParseKeywords(reply);
    if (parsed.length) {
      parsed.slice(0, 12).forEach(({ term, desc }) => {
        const chip = document.createElement("span");
        chip.className = "keyword-chip";
        chip.textContent = term;
        if (desc) chip.dataset.desc = desc;
        keywordsBody.appendChild(chip);
      });
      if (lastKeywordsList !== undefined) {
        lastKeywordsList.length = 0;
        lastKeywordsList.push(...parsed);
      }
    }
  } catch {
  }
  if (!keywordsBody.children.length) {
    if (!reply) keywordsBody.textContent = "생성 실패";
    else keywordsBody.textContent = "...";
  }
}

function renderInlineMathOnly(text) {
  if (!text) return "";
  return text.replace(/(\$\$[\s\S]+?\$\$|\$[^\$]+?\$)/g, (match) => {
    try {
      if (match.startsWith("$$")) {
        return katex.renderToString(match.slice(2, -2), { throwOnError: false, displayMode: true });
      } else {
        return katex.renderToString(match.slice(1, -1), { throwOnError: false, displayMode: false });
      }
    } catch {
      return match;
    }
  });
}

function renderMarkdownToHtml(md) {
  if (!md) return "";

  const mathExprs = [];
  const protectedMd = md.replace(/(\$\$[\s\S]+?\$\$|\$[^\$]+?\$)/g, (match) => {
    mathExprs.push(match);
    return `MathToken${mathExprs.length - 1}EndToken`;
  });

  let html = marked.parse(protectedMd, { mangle: false, headerIds: false });

  html = html.replace(/MathToken(\d+)EndToken/g, (_, index) => {
    const expr = mathExprs[parseInt(index)];
    if (!expr) return "";

    if (expr.startsWith("$$")) {
      const content = expr.slice(2, -2);
      try {
        return katex.renderToString(content, {
          throwOnError: false,
          displayMode: true,
        });
      } catch {
        return expr;
      }
    } else {
      const content = expr.slice(1, -1);
      try {
        return katex.renderToString(content, {
          throwOnError: false,
          displayMode: false,
        });
      } catch {
        return expr;
      }
    }
  });

  return html;
}

function formatKeywordsForCopy(raw, lastKeywordsList) {
  const source = lastKeywordsList?.length
    ? lastKeywordsList
    : tryParseKeywords(raw);
  if (!source || !source.length) return "";
  return source
    .map(({ term, desc }) => `${term} - ${desc}`.trim())
    .filter(Boolean)
    .join("\n");
}

function formatBriefForCopy(lastBriefLines, lastBriefRaw) {
  if (lastBriefLines?.length) {
    return lastBriefLines.map(normalizeLine).join("\n");
  }
  return parseBriefLines(lastBriefRaw).map(normalizeLine).join("\n");
}

export {
  sanitizeText,
  normalizeLine,
  dedupeLines,
  dedupeSummary,
  mergeEmojiSingles,
  parseBriefLines,
  tryParseKeywords,
  renderKeywords,
  renderInlineMathOnly,
  renderMarkdownToHtml,
  formatKeywordsForCopy,
  formatBriefForCopy,
};
