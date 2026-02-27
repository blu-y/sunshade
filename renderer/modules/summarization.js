import { state, uiRefs } from "./config.js";
import { DocManager } from "./docManager.js";
import { setAlert, showToast } from "./uiHelpers.js";
import { renderKeywords, parseBriefLines, tryParseKeywords, renderMarkdownToHtml, dedupeSummary, normalizeLine, renderInlineMathOnly } from "./textProcessors.js";

async function loadPrompts() {
  if (state.promptsCache) return state.promptsCache;
  try {
    const res = await window.sunshadeAPI.loadPrompts();
    state.promptsCache = res || {};
    return state.promptsCache;
  } catch {
    return {};
  }
}

async function extractPdfText(doc, maxPages = 6, maxChars = 12000) {
  try {
    const parts = [];
    const total = Math.min(doc.numPages, maxPages);
    for (let i = 1; i <= total; i += 1) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const strings = content.items.map((it) => it.str).filter(Boolean);
      parts.push(strings.join(" "));
      if (parts.join(" ").length > maxChars) break;
    }
    return parts.join(" ").slice(0, maxChars);
  } catch (err) {
    console.error("extractPdfText error", err);
    return "";
  }
}

function runStreamTask(messages, instruction, onChunk, onDone) {
  return new Promise((resolve, reject) => {
    window.sunshadeAPI.openaiStream(
      messages,
      instruction,
      {
        onChunk,
        onDone: () => {
          if (onDone) onDone();
          resolve();
        },
        onError: reject,
      },
      state.currentModel,
    );
  });
}

function updateSummaryPlaceholders(hasPdf) {
  const setInfo = (el, text) => {
    if (!el) return;
    el.classList.add("info-text");
    el.classList.add("placeholder");
    el.textContent = text;
  };
  if (!hasPdf) {
    if (uiRefs.regenAllBtn) uiRefs.regenAllBtn.style.display = "none";
    setInfo(uiRefs.keywordsBody, "파일을 선택하면 키워드가 표시됩니다.");
    if (uiRefs.briefList) {
      uiRefs.briefList.classList.add("info-text");
      uiRefs.briefList.classList.add("placeholder");
      uiRefs.briefList.innerHTML = "";
      const li = document.createElement("li");
      li.textContent = "파일을 선택하면 3줄 요약이 표시됩니다.";
      uiRefs.briefList.appendChild(li);
    }
    setInfo(uiRefs.summaryBody, "파일을 선택하면 요약이 표시됩니다.");
    return;
  }
  if (uiRefs.keywordsBody) {
    uiRefs.keywordsBody.textContent = "";
    uiRefs.keywordsBody.classList.remove("placeholder");
  }
  if (uiRefs.briefList) {
    uiRefs.briefList.innerHTML = "";
    uiRefs.briefList.classList.remove("placeholder");
  }
  if (uiRefs.summaryBody) {
    uiRefs.summaryBody.textContent = "";
    uiRefs.summaryBody.classList.remove("placeholder");
  }
}

async function regenerateSection(section, prompts, onChunk, onDone) {
  state.promptsCache = null;
  const newPrompts = await loadPrompts();

  if (section === "keywords") {
    uiRefs.keywordsBody.textContent = "다시 생성 중...";
    let rawAcc = "";
    runStreamTask(
      [
        { role: "system", content: newPrompts.system || "You are Sunshade." },
        {
          role: "user",
          content: `${newPrompts.sections?.keywords || "Extract keywords."}\n\n${state.lastExtractedText}`,
        },
      ],
      newPrompts.sections?.keywords,
      (chunk) => {
        rawAcc += chunk;
      },
      () => {
        state.lastKeywordsRaw = rawAcc;
        renderKeywords(state.lastKeywordsRaw, uiRefs.keywordsBody, state.lastKeywordsList);
        DocManager.getHeavy(state.currentPdfPath).then(heavyData => {
          if (heavyData && heavyData.analysis) {
            heavyData.analysis.keywords = state.lastKeywordsRaw;
            DocManager.save(state.currentPdfPath, { analysis: heavyData.analysis });
          }
        });
      },
    );
  } else if (section === "brief") {
    uiRefs.briefList.innerHTML = "<li>다시 생성 중...</li>";
    let rawAcc = "";
    runStreamTask(
      [
        { role: "system", content: newPrompts.system || "You are Sunshade." },
        {
          role: "user",
          content: `${newPrompts.sections?.brief || "Give 3 bullet sentences."}\n\n${state.lastExtractedText}`,
        },
      ],
      newPrompts.sections?.brief,
      (chunk) => {
        rawAcc += chunk;
        const lines = parseBriefLines(rawAcc).slice(0, 3);
        if (lines.length > 0) {
          uiRefs.briefList.innerHTML = "";
          lines.forEach((line) => {
            const li = document.createElement("li");
            const cleanLine = normalizeLine(line.replace(/^\d+[\).\s-]*/, ""));
            li.innerHTML = renderInlineMathOnly(cleanLine);
            uiRefs.briefList.appendChild(li);
          });
        }
      },
      () => {
        state.lastBriefRaw = rawAcc;
        const lines = parseBriefLines(state.lastBriefRaw).slice(0, 3);
        state.lastBriefLines = lines;
        uiRefs.briefList.innerHTML = "";
        if (lines.length === 0) {
          const li = document.createElement("li");
          li.textContent = "생성 실패";
          uiRefs.briefList.appendChild(li);
        } else {
          lines.forEach((line) => {
            const li = document.createElement("li");
            const cleanLine = normalizeLine(line.replace(/^\d+[\).\s-]*/, ""));
            li.innerHTML = renderInlineMathOnly(cleanLine);
            uiRefs.briefList.appendChild(li);
          });
        }
        DocManager.getHeavy(state.currentPdfPath).then(heavyData => {
          if (heavyData && heavyData.analysis) {
            heavyData.analysis.brief = state.lastBriefRaw;
            DocManager.save(state.currentPdfPath, { analysis: heavyData.analysis });
          }
        });
      },
    );
  } else if (section === "summary") {
    uiRefs.summaryBody.textContent = "다시 생성 중...";
    let rawAcc = "";
    let isFirst = true;
    runStreamTask(
      [
        { role: "system", content: newPrompts.system || "You are Sunshade." },
        {
          role: "user",
          content: `${newPrompts.sections?.summary || "Summarize."}\n\n${state.lastExtractedText}`,
        },
      ],
      newPrompts.sections?.summary,
      (chunk) => {
        if (isFirst) {
          uiRefs.summaryBody.innerHTML = "";
          isFirst = false;
        }
        rawAcc += chunk;
        uiRefs.summaryBody.innerHTML = renderMarkdownToHtml(rawAcc);
      },
      () => {
        state.lastSummaryRaw = dedupeSummary(rawAcc);
        uiRefs.summaryBody.innerHTML = renderMarkdownToHtml(state.lastSummaryRaw);
        DocManager.getHeavy(state.currentPdfPath).then(heavyData => {
          if (heavyData && heavyData.analysis) {
            heavyData.analysis.summary = state.lastSummaryRaw;
            DocManager.save(state.currentPdfPath, { analysis: heavyData.analysis });
          }
        });
      },
    );
  }
}

async function generateSummaries() {
  if (!state.pdfDocumentProxy) return;
  try {
    const prompts = await loadPrompts();
    const text = await extractPdfText(state.pdfDocumentProxy, 100, 300000);
    if (!text) return;
    state.lastExtractedText = text;

    DocManager.save(state.currentPdfPath, {
      name:
        uiRefs.pdfFileInput.files?.[0]?.name || state.currentPdfPath.split(/[/\\]/).pop(),
      isAnalyzing: true,
    });

    const tasks = [];

    if (uiRefs.keywordsBody) {
      uiRefs.keywordsBody.textContent = "생성 중...";

      let rawAcc = "";
      const systemPrompt = prompts.system || "You are Sunshade.";
      const taskPrompt = prompts.sections?.keywords || "Extract keywords.";

      tasks.push(
        runStreamTask(
          [{ role: "user", content: `${taskPrompt}\n\n${text}` }],
          `${systemPrompt}\n\n${taskPrompt}`,
          (chunk) => {
            if (rawAcc === "") uiRefs.keywordsBody.classList.remove("placeholder");
            rawAcc += chunk;
          },
          () => {
            state.lastKeywordsRaw = rawAcc;
            renderKeywords(state.lastKeywordsRaw, uiRefs.keywordsBody, state.lastKeywordsList);
          },
        ).catch((err) => {
          uiRefs.keywordsBody.textContent = "오류 발생";
          console.error(err);
        }),
      );
    }

    if (uiRefs.briefList) {
      uiRefs.briefList.innerHTML = "<li>생성 중...</li>";

      let rawAcc = "";
      const systemPrompt = prompts.system || "You are Sunshade.";
      const taskPrompt = prompts.sections?.brief || "Give 3 bullet sentences.";

      tasks.push(
        runStreamTask(
          [{ role: "user", content: `${taskPrompt}\n\n${text}` }],
          `${systemPrompt}\n\n${taskPrompt}`,
          (chunk) => {
            if (rawAcc === "") uiRefs.briefList.classList.remove("placeholder");
            rawAcc += chunk;
            const lines = parseBriefLines(rawAcc).slice(0, 3);
            if (lines.length > 0) {
              uiRefs.briefList.innerHTML = "";
              lines.forEach((line) => {
                const li = document.createElement("li");
                const cleanLine = normalizeLine(line.replace(/^\d+[\).\s-]*/, ""));
                li.innerHTML = renderInlineMathOnly(cleanLine);
                uiRefs.briefList.appendChild(li);
              });
            }
          },
          () => {
            state.lastBriefRaw = rawAcc;
            const lines = parseBriefLines(state.lastBriefRaw).slice(0, 3);
            state.lastBriefLines = lines;
            uiRefs.briefList.innerHTML = "";
            if (lines.length === 0) {
              const li = document.createElement("li");
              li.textContent = "생성 실패";
              uiRefs.briefList.appendChild(li);
            } else {
              lines.forEach((line) => {
                const li = document.createElement("li");
                const cleanLine = normalizeLine(line.replace(/^\d+[\).\s-]*/, ""));
                li.innerHTML = renderInlineMathOnly(cleanLine);
                uiRefs.briefList.appendChild(li);
              });
            }
          },
        ).catch((err) => console.error(err)),
      );
    }

    if (uiRefs.summaryBody) {
      uiRefs.summaryBody.textContent = "생성 중...";
      uiRefs.summaryBody.classList.remove("info-text");

      let rawAcc = "";
      let isFirst = true;
      const systemPrompt = prompts.system || "You are Sunshade.";
      const taskPrompt = prompts.sections?.summary || "Summarize.";

      tasks.push(
        runStreamTask(
          [{ role: "user", content: `${taskPrompt}\n\n${text}` }],
          `${systemPrompt}\n\n${taskPrompt}`,
          (chunk) => {
            if (isFirst) {
              uiRefs.summaryBody.innerHTML = "";
              uiRefs.summaryBody.classList.remove("placeholder");
              isFirst = false;
            }
            rawAcc += chunk;
            uiRefs.summaryBody.innerHTML = renderMarkdownToHtml(rawAcc);
          },
          () => {
            state.lastSummaryRaw = dedupeSummary(rawAcc);
            uiRefs.summaryBody.innerHTML = renderMarkdownToHtml(
              state.lastSummaryRaw || "생성 실패",
            );
          },
        ).catch((err) => {
          uiRefs.summaryBody.textContent = "오류 발생";
          console.error(err);
        }),
      );
    }

    Promise.allSettled(tasks).then(() => {
      DocManager.save(state.currentPdfPath, {
        extractedText: text,
        isAnalyzing: false,
        analysis: {
          keywords: state.lastKeywordsRaw,
          brief: state.lastBriefRaw,
          summary: state.lastSummaryRaw,
        },
      });
      if (uiRefs.regenAllBtn) uiRefs.regenAllBtn.style.display = "flex";
    });
  } catch (err) {
    console.error("generateSummaries error", err);
    setAlert(`요약 생성 실패: ${err.message}`, "error");
    DocManager.save(state.currentPdfPath, { isAnalyzing: false });
  }
}

export { loadPrompts, extractPdfText, runStreamTask, updateSummaryPlaceholders, regenerateSection, generateSummaries };
