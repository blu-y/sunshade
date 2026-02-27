import { pdfjsLib, PDFViewer, pdfLinkService, state, uiRefs, eventBus } from "./config.js";
import { DocManager } from "./docManager.js";
import { logMessage, showToast } from "./uiHelpers.js";
import { applyHighlightMode, saveHighlights, setupHighlightEventHandlers } from "./highlights.js";
import { loadOutline, updateOutlineHighlight } from "./outline.js";
import { updateSummaryPlaceholders, generateSummaries } from "./summarization.js";
import { renderMarkdownToHtml, renderInlineMathOnly, parseBriefLines } from "./textProcessors.js";
import { renderSidebar } from "./sidebar.js";

let pdfViewer = null;
let loadPdfQueue = Promise.resolve();

function initPdfViewer() {
  pdfViewer = new PDFViewer({
    container: uiRefs.viewerContainer,
    eventBus: eventBus,
    linkService: pdfLinkService,
    textLayerMode: 2,
    annotationEditorMode: 0,
    annotationEditorHighlightColors: "yellow=#FFFF98,green=#53FFBC,blue=#80EBFF,pink=#FFCBE6,red=#FF4F5F",
  });
  pdfLinkService.setViewer(pdfViewer);
  state.pdfDoc = pdfViewer;
  return pdfViewer;
}

function togglePdfPlaceholder(show) {
  if (!uiRefs.pdfEmptyEl || !uiRefs.viewerContainer) return;
  uiRefs.pdfEmptyEl.style.display = show ? "flex" : "none";
  uiRefs.viewerContainer.style.visibility = show ? "hidden" : "visible";
}

function wirePdfInput() {
  const dropTargets = [uiRefs.viewerContainer, uiRefs.pdfEmptyEl];
  dropTargets.forEach((el) => {
    el?.addEventListener("dragover", (e) => {
      e.preventDefault();
    });
    el?.addEventListener("drop", (e) => {
      e.preventDefault();
      const file = e.dataTransfer.files?.[0];
      if (file && file.type === "application/pdf") {
        loadPdf(file);
      }
    });
    el?.addEventListener("click", () => {
      if (!pdfViewer) uiRefs.pdfOpenBtn.click();
    });
  });
}

function loadPdf(input) {
  loadPdfQueue = loadPdfQueue.then(() => loadPdfImpl(input)).catch(() => {});
  return loadPdfQueue;
}

async function loadPdfImpl(input) {
  if (!input) return;
  if (!pdfjsLib || !uiRefs.viewerContainer) {
    logMessage("PDF engine not ready", "warn");
    return;
  }

  try {
    let targetFilePath = "";
    if (typeof input === "string") {
      targetFilePath = input;
    } else {
      try {
        targetFilePath = window.sunshadeAPI.getPathForFile(input);
      } catch (e) {
        targetFilePath = input.path || input.name;
      }
    }

    if (state.currentPdfPath === targetFilePath) {
      console.log("PDF already loaded:", targetFilePath);
      return;
    }

    if (state.hasUnsavedHighlights) {
      saveHighlights();
      state.hasUnsavedHighlights = false;
    }
    clearTimeout(state.saveDebounceTimer);
    state.saveDebounceTimer = null;

    let arrayBuffer;
    let filePath = "";
    let fileName = "";

    if (typeof input === "string") {
      filePath = targetFilePath;
      fileName = input.split(/[/\\]/).pop();
      const buffer = await window.sunshadeAPI.readFile(filePath);
      arrayBuffer = buffer.buffer;
    } else {
      filePath = targetFilePath;
      fileName = input.name;
      arrayBuffer = await input.arrayBuffer();
    }

    console.log("Loading PDF from:", filePath);
    state.currentPdfPath = filePath;
    const cachedDoc = DocManager.get(filePath);
    state.pendingHighlightDefaultColor = cachedDoc?.highlightDefaultColor || null;

    const loadingTask = pdfjsLib.getDocument({
      data: arrayBuffer,
      cMapUrl: "../node_modules/pdfjs-dist/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "../node_modules/pdfjs-dist/standard_fonts/",
      disableFontFace: true,
      verbosity: 0,
    });
    const pdfDoc = await loadingTask.promise;
    state.pdfDocumentProxy = pdfDoc;

    pdfViewer.setDocument(pdfDoc);
    pdfLinkService.setDocument(pdfDoc, null);
    applyHighlightMode(false);

    document.querySelector(".pdf-pane").classList.add("has-pdf");
    loadOutline(pdfDoc);
    togglePdfPlaceholder(false);

    const scrollContent = document.querySelector(".summary-scroll-content");
    if (scrollContent) scrollContent.scrollTop = 0;

    if (uiRefs.chatHistory) {
      uiRefs.chatHistory.innerHTML = "";
      uiRefs.chatHistory.style.display = "none";
    }
    if (uiRefs.chatEmpty) uiRefs.chatEmpty.style.display = "block";

    renderSidebar();

    let cached = cachedDoc;
    let heavyData = null;

    if (cached && cached.contentHash) {
      heavyData = await DocManager.getHeavy(filePath);
      cached = { ...cached, ...(heavyData || {}) };
    }

    if (cached && cached.analysis) {
      console.log("Restoring from cache:", filePath);

      state.lastExtractedText = cached.extractedText || "";

      const hasKeywords = !!cached.analysis.keywords;
      const hasBrief = !!cached.analysis.brief;
      const hasSummary = !!cached.analysis.summary;

      if (!hasKeywords && !hasBrief && !hasSummary) {
        console.warn("Cached analysis is empty, regenerating...");
        updateSummaryPlaceholders(true);
        await generateSummaries();
      } else {
        if (uiRefs.regenAllBtn) uiRefs.regenAllBtn.style.display = "flex";

        if (hasKeywords) {
          state.lastKeywordsRaw = cached.analysis.keywords;
        }
        if (hasBrief) {
          state.lastBriefRaw = cached.analysis.brief;
          const lines = parseBriefLines(state.lastBriefRaw).slice(0, 3);
          state.lastBriefLines = lines;
          uiRefs.briefList.innerHTML = "";
          lines.forEach((line) => {
            const li = document.createElement("li");
            const rawText = line.replace(/^\d+[\).\s-]*/, "").trim();
            li.innerHTML = renderInlineMathOnly(rawText);
            uiRefs.briefList.appendChild(li);
          });
          uiRefs.briefList.classList.remove("placeholder");
        }
        if (hasSummary) {
          state.lastSummaryRaw = cached.analysis.summary;
          uiRefs.summaryBody.innerHTML = renderMarkdownToHtml(state.lastSummaryRaw);
          uiRefs.summaryBody.classList.remove("placeholder");
          uiRefs.summaryBody.classList.remove("info-text");
        }

        if (hasKeywords) uiRefs.keywordsBody.classList.remove("placeholder");

        if (cached.chatHistory && cached.chatHistory.length > 0) {
          if (uiRefs.chatEmpty) uiRefs.chatEmpty.style.display = "none";
          if (uiRefs.chatHistory) {
            uiRefs.chatHistory.style.display = "block";
            uiRefs.chatHistory.innerHTML = "";
            cached.chatHistory.forEach((item) => {
              const q = item.q.replace(/^Q: /, "");
              const el = document.createElement("div");
              el.className = "chat-item";
              el.style.position = "relative";

              const qEl = document.createElement("div");
              qEl.className = "chat-q";
              qEl.textContent = q;

              const aEl = document.createElement("div");
              aEl.className = "chat-a";
              const isHtml = item.a.includes("<p>") || item.a.includes("<span class=\"katex");
              aEl.innerHTML = isHtml ? item.a : renderMarkdownToHtml(item.a);
              aEl.dataset.raw = item.a;

              el.appendChild(qEl);
              el.appendChild(aEl);

              uiRefs.chatHistory.appendChild(el);
            });
          }
        }
      }
    } else {
      updateSummaryPlaceholders(true);
      await generateSummaries();

      DocManager.save(filePath, {
        name: fileName,
        extractedText: state.lastExtractedText,
      });
    }

    console.log(`Loaded PDF: ${fileName} (${pdfDoc.numPages} pages)`);

  } catch (err) {
    logMessage(`PDF load failed: ${err.message}`, "error");
  }
}

function updatePdfControls() {
  const page = pdfViewer.currentPageNumber;
  const num = pdfViewer.pagesCount;

  if (uiRefs.pdfPageDisplay) {
    uiRefs.pdfPageDisplay.textContent = num ? `${page} / ${num}` : "- / -";
  }

  const disabled = !num;
  [
    uiRefs.pdfPrevBtn,
    uiRefs.pdfNextBtn,
    uiRefs.pdfZoomInBtn,
    uiRefs.pdfZoomOutBtn,
    uiRefs.pdfFitBtn,
    uiRefs.pdfHighlightBtn,
  ].forEach((btn) => {
    if (btn) btn.disabled = disabled;
  });

  if (uiRefs.pdfPrevBtn) uiRefs.pdfPrevBtn.disabled = disabled || page <= 1;
  if (uiRefs.pdfNextBtn) uiRefs.pdfNextBtn.disabled = disabled || page >= num;
}

function setupPdfControls() {
  uiRefs.pdfOpenBtn?.addEventListener("click", async () => {
    try {
      const path = await window.sunshadeAPI.openFileDialog();
      if (path) {
        loadPdf(path);
      }
    } catch (err) {
      console.error("File open failed", err);
    }
  });

  uiRefs.pdfPrevBtn?.addEventListener("click", () => {
    pdfViewer.currentPageNumber--;
  });

  uiRefs.pdfNextBtn?.addEventListener("click", () => {
    pdfViewer.currentPageNumber++;
  });

  uiRefs.pdfZoomInBtn?.addEventListener("click", () => {
    pdfViewer.currentScale += 0.1;
    state.isPageWidthFit = false;
    uiRefs.pdfFitBtn.classList.remove("active");
  });

  uiRefs.pdfZoomOutBtn?.addEventListener("click", () => {
    pdfViewer.currentScale -= 0.1;
    state.isPageWidthFit = false;
    uiRefs.pdfFitBtn.classList.remove("active");
  });

  uiRefs.pdfHighlightBtn?.addEventListener("click", () => {
    if (!pdfViewer.pdfDocument) return;
    applyHighlightMode(!state.isHighlightModeEnabled);
  });

  uiRefs.pdfFitBtn?.addEventListener("click", () => {
    if (state.isPageWidthFit) {
      state.isPageWidthFit = false;
      uiRefs.pdfFitBtn.classList.remove("active");
    } else {
      state.isPageWidthFit = true;
      uiRefs.pdfFitBtn.classList.add("active");
      pdfViewer.currentScaleValue = "page-width";
    }
  });

  const resizeObserver = new ResizeObserver(() => {
    if (state.isPageWidthFit && pdfViewer.pdfDocument) {
      pdfViewer.currentScaleValue = "page-width";
    }
  });
  if (uiRefs.viewerContainer) resizeObserver.observe(uiRefs.viewerContainer);

  uiRefs.pdfZoomLevel?.addEventListener("change", () => {
    const val = parseInt(uiRefs.pdfZoomLevel.value, 10);
    if (!isNaN(val) && val > 0) {
      pdfViewer.currentScaleValue = val / 100;
    } else {
      uiRefs.pdfZoomLevel.value = `${Math.round(pdfViewer.currentScale * 100)}%`;
    }
  });

  uiRefs.pdfZoomLevel?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      uiRefs.pdfZoomLevel.blur();
    }
  });

  eventBus.on("pagesinit", () => {
    pdfViewer.currentScaleValue = state.isPageWidthFit ? "page-width" : "auto";
    updatePdfControls();
  });

  eventBus.on("pagechanging", (evt) => {
    const page = evt.pageNumber;
    const num = pdfViewer.pagesCount;
    if (uiRefs.pdfPageDisplay) uiRefs.pdfPageDisplay.textContent = `${page} / ${num}`;
    updatePdfControls();
    updateOutlineHighlight(page);
  });

  eventBus.on("scalechanging", (evt) => {
    if (uiRefs.pdfZoomLevel && document.activeElement !== uiRefs.pdfZoomLevel) {
      uiRefs.pdfZoomLevel.value = `${Math.round(evt.scale * 100)}%`;
    }
  });

  setupHighlightEventHandlers(pdfViewer);
}

function setupResizers() {
  function loadLayoutState() {
    try {
      const raw = localStorage.getItem("sunshade-layout");
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed.left)
        document.documentElement.style.setProperty("--col-left", parsed.left);
      if (parsed.right)
        document.documentElement.style.setProperty("--col-right", parsed.right);
    } catch (err) {
      console.warn("Failed to load layout state", err);
    }
  }

  function saveLayoutState() {
    try {
      const left = getComputedStyle(document.documentElement)
        .getPropertyValue("--col-left")
        .trim();
      const right = getComputedStyle(document.documentElement)
        .getPropertyValue("--col-right")
        .trim();
      localStorage.setItem("sunshade-layout", JSON.stringify({ left, right }));
    } catch (err) {
      console.warn("Failed to save layout state", err);
    }
  }

  function setupResizer(resizer, side) {
    if (!resizer || !uiRefs.layout) return;
    let startX = 0;
    let startWidth = 0;
    resizer.addEventListener("mousedown", (e) => {
      startX = e.clientX;
      const styles = getComputedStyle(document.documentElement);
      startWidth =
        side === "left"
          ? parseInt(styles.getPropertyValue("--col-left"))
          : parseInt(styles.getPropertyValue("--col-right"));
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
      e.preventDefault();
    });

    const onMouseMove = (e) => {
      const delta = e.clientX - startX;
      if (side === "left") {
        const newWidth = Math.max(200, Math.min(500, startWidth + delta));
        document.documentElement.style.setProperty("--col-left", `${newWidth}px`);
      } else {
        const newWidth = Math.max(300, Math.min(700, startWidth - delta));
        document.documentElement.style.setProperty(
          "--col-right",
          `${newWidth}px`,
        );
      }
    };

    const onMouseUp = () => {
      saveLayoutState();
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }

  loadLayoutState();
  setupResizer(uiRefs.resizerLeft, "left");
  setupResizer(uiRefs.resizerRight, "right");
}

function setupOpenAIApi() {
  async function refreshOpenAIStatus() {
    if (!uiRefs.openaiChipText || !uiRefs.openaiStatusDot || !uiRefs.openaiChip) return;
    try {
      const status = await window.sunshadeAPI.openaiAuthStatus();
      if (status.hasTokens) {
        uiRefs.openaiChipText.textContent = "Signed in";
        uiRefs.openaiStatusDot.style.background = "#22c55e";
        uiRefs.openaiChip.dataset.tooltip = "Click to sign out";
        uiRefs.openaiChip.classList.add("has-tooltip");
        uiRefs.openaiChip.dataset.state = "signed-in";
      } else {
        uiRefs.openaiChipText.textContent = "Sign in required";
        uiRefs.openaiStatusDot.style.background = "#f97316";
        uiRefs.openaiChip.dataset.tooltip = "OpenAI Codex: not signed in";
        uiRefs.openaiChip.classList.add("has-tooltip");
        uiRefs.openaiChip.dataset.state = "signed-out";
      }
    } catch (err) {
      uiRefs.openaiChipText.textContent = `Error`;
      uiRefs.openaiStatusDot.style.background = "#ef4444";
      uiRefs.openaiChip.dataset.tooltip = `Status check failed: ${err.message}`;
      uiRefs.openaiChip.classList.add("has-tooltip");
      uiRefs.openaiChip.dataset.state = "error";
    }
  }

  if (uiRefs.openaiChipText && uiRefs.openaiStatusDot && uiRefs.openaiChip) {
    uiRefs.openaiChipText.textContent = "Sign in required";
    uiRefs.openaiStatusDot.style.background = "#f97316";
    uiRefs.openaiChip.dataset.state = "signed-out";
  }

  uiRefs.openaiChip?.addEventListener("click", async () => {
    if (!uiRefs.openaiChip || !uiRefs.openaiChipText || !uiRefs.openaiStatusDot) return;
    const chipState = uiRefs.openaiChip.dataset.state;
    if (chipState === "signed-in") {
      const ok = confirm("Sign out from OpenAI Codex?");
      if (!ok) return;
      uiRefs.openaiChipText.textContent = "Signing out...";
      uiRefs.openaiStatusDot.style.background = "#f97316";
      try {
        await window.sunshadeAPI.openaiLogout();
        uiRefs.openaiChipText.textContent = "Signed out";
        uiRefs.openaiStatusDot.style.background = "#f97316";
        uiRefs.openaiChip.dataset.state = "signed-out";
        uiRefs.openaiChip.dataset.tooltip = "OpenAI Codex: not signed in";
      } catch (err) {
        uiRefs.openaiChipText.textContent = "Logout failed";
        uiRefs.openaiStatusDot.style.background = "#ef4444";
        uiRefs.openaiChip.dataset.state = "error";
        uiRefs.openaiChip.dataset.tooltip = `Logout failed: ${err.message}`;
        console.error(err);
      }
      return;
    }

    uiRefs.openaiChipText.textContent = "Opening browser...";
    uiRefs.openaiStatusDot.style.background = "#f59e0b";
    uiRefs.openaiChip.dataset.state = "signing-in";
    uiRefs.openaiChip.dataset.tooltip = "Signing in...";
    try {
      await window.sunshadeAPI.openaiLogin();
      uiRefs.openaiChipText.textContent = "Signed in";
      uiRefs.openaiStatusDot.style.background = "#22c55e";
      uiRefs.openaiChip.dataset.state = "signed-in";
      uiRefs.openaiChip.dataset.tooltip = "Click to sign out";
    } catch (err) {
      uiRefs.openaiChipText.textContent = "Login failed";
      uiRefs.openaiStatusDot.style.background = "#ef4444";
      uiRefs.openaiChip.dataset.state = "error";
      uiRefs.openaiChip.dataset.tooltip = `Login failed: ${err.message}`;
      console.error(err);
    }
  });

  refreshOpenAIStatus().catch((err) => console.error("OpenAI status error", err));
}

function setupModelSelector() {
  if (uiRefs.currentModelName) uiRefs.currentModelName.textContent = state.currentModel;
  if (uiRefs.modelDropdown) {
    uiRefs.modelDropdown.querySelectorAll(".model-option").forEach((el) => {
      el.classList.toggle("selected", el.dataset.model === state.currentModel);
    });
  }

  uiRefs.modelSelector?.addEventListener("click", (e) => {
    e.stopPropagation();
    uiRefs.modelDropdown.classList.toggle("show");
  });

  document.addEventListener("click", () => {
    uiRefs.modelDropdown?.classList.remove("show");
  });

  uiRefs.modelDropdown?.addEventListener("click", (e) => {
    const option = e.target.closest(".model-option");
    if (!option) return;
    e.stopPropagation();

    state.currentModel = option.dataset.model;
    uiRefs.currentModelName.textContent = state.currentModel;
    localStorage.setItem("sunshade-model", state.currentModel);

    document.querySelectorAll(".model-option").forEach((el) => el.classList.remove("selected"));
    option.classList.add("selected");
    uiRefs.modelDropdown.classList.remove("show");

    console.log(`Model switched to ${state.currentModel}`);
  });
}

function setupRegenAll() {
  uiRefs.regenAllBtn?.addEventListener("click", async () => {
    if (!state.lastExtractedText) {
      showToast(uiRefs.regenAllBtn, "Load PDF first");
      return;
    }
    state.promptsCache = null;
    updateSummaryPlaceholders(true);
    uiRefs.regenAllBtn.style.display = "none";
    await generateSummaries();
  });
}

function getPdfViewer() {
  return pdfViewer;
}

export { initPdfViewer, loadPdf, togglePdfPlaceholder, wirePdfInput, setupPdfControls, setupResizers, setupOpenAIApi, setupModelSelector, setupRegenAll, getPdfViewer };
