import { DocManager } from "./modules/docManager.js";
import { initPdfViewer, wirePdfInput, setupPdfControls, setupResizers, setupOpenAIApi, setupModelSelector, setupRegenAll, getPdfViewer } from "./modules/pdfControls.js";
import { init as initTheme } from "./modules/theme.js";
import { init as initPdfDarkMode } from "./modules/pdfDarkMode.js";
import { setupEditToolbarObserver, setupGlobalToolbarObserver } from "./modules/highlights.js";
import { setupTooltipHandlers } from "./modules/uiHelpers.js";
import { setupChatInputHandlers } from "./modules/chat.js";
import { setCallbacks, renderSidebar, setupTabSwitching, setupSectionActions } from "./modules/sidebar.js";
import { updateSummaryPlaceholders } from "./modules/summarization.js";
import { eventBus, uiRefs } from "./modules/config.js";
import { loadOutline, updateOutlineHighlight } from "./modules/outline.js";
import { regenerateSection } from "./modules/summarization.js";

async function init() {
  await DocManager.init();
  const pdfViewer = initPdfViewer();
  initPdfDarkMode();
  initTheme();
  wirePdfInput();
  setupPdfControls();
  setupResizers();
  setupOpenAIApi();
  setupModelSelector();
  setupRegenAll();
  setupEditToolbarObserver();
  setupGlobalToolbarObserver();
  setupTooltipHandlers();
  setupChatInputHandlers();

  setCallbacks((path) => {
    import("./modules/pdfControls.js").then((mod) => {
      mod.loadPdf(path);
    });
  }, (section, btn) => {
    if (section === "all") {
      updateSummaryPlaceholders(true);
      import("./modules/summarization.js").then((mod) => {
        mod.generateSummaries();
      });
    } else {
      import("./modules/summarization.js").then((mod) => {
        mod.loadPrompts().then((prompts) => {
          mod.regenerateSection(section, prompts, () => {}, () => {});
        });
      });
    }
  });

  setupTabSwitching();
  setupSectionActions();

  updatePdfControls();
  togglePdfPlaceholder(true);
  updateSummaryPlaceholders(false);

  renderSidebar();

  eventBus.on("pagechanging", (evt) => {
    const page = evt.pageNumber;
    updateOutlineHighlight(page);
  });

  window.addEventListener("doc-update", () => {
    renderSidebar();
  });

  window.addEventListener("beforeunload", () => {
    import("./modules/highlights.js").then((mod) => {
      mod.saveHighlights();
    });
  });
}

function updatePdfControls() {
  const pdfViewer = getPdfViewer();
  if (!pdfViewer) return;
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

function togglePdfPlaceholder(show) {
  if (!uiRefs.pdfEmptyEl || !uiRefs.viewerContainer) return;
  uiRefs.pdfEmptyEl.style.display = show ? "flex" : "none";
  uiRefs.viewerContainer.style.visibility = show ? "hidden" : "visible";
}

init();
