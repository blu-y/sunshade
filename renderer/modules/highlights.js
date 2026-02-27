import {
  pdfjsLib,
  state,
  uiRefs,
  eventBus,
  highlightModeValue,
  noEditorModeValue,
} from "./config.js";
import { DocManager } from "./docManager.js";

let editToolbarObserver = null;

function normalizeEditToolbar(toolbar) {
  if (!toolbar) return;
  if (toolbar.classList.contains("editorParamsToolbar")) return;
  toolbar.remove();
}

function normalizeAllEditToolbars() {
  const toolbars = document.querySelectorAll(".editToolbar");
  for (const toolbar of toolbars) {
    normalizeEditToolbar(toolbar);
  }
}

function setupEditToolbarObserver() {
  if (!uiRefs.viewerContainer || editToolbarObserver) return;

  editToolbarObserver = new MutationObserver((mutations) => {
    let shouldNormalize = false;
    for (const mutation of mutations) {
      if (mutation.addedNodes.length) {
        shouldNormalize = true;
        break;
      }
      if (
        mutation.type === "attributes" &&
        (mutation.target.classList.contains("editToolbar") ||
          mutation.target.closest(".editToolbar"))
      ) {
        shouldNormalize = true;
        break;
      }
    }
    if (shouldNormalize) {
      normalizeAllEditToolbars();
    }
  });

  editToolbarObserver.observe(uiRefs.viewerContainer, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["style", "class", "hidden"],
  });

  const layerObserver = new MutationObserver(() => {
    const layer = uiRefs.viewerContainer.querySelector(".annotationEditorLayer");
    if (layer && !layer.dataset.observed) {
      layer.dataset.observed = "true";
      const toolbarObserver = new MutationObserver(() =>
        normalizeAllEditToolbars()
      );
      toolbarObserver.observe(layer, { childList: true, subtree: true });
    }
    normalizeAllEditToolbars();
  });

  layerObserver.observe(uiRefs.viewerContainer, {
    childList: true,
    subtree: true,
  });

  normalizeAllEditToolbars();
}

function applyHighlightMode(enabled) {
  const mode = enabled ? highlightModeValue : noEditorModeValue;
  if (state.pdfDoc && state.pdfDoc.annotationEditorMode && state.pdfDoc.annotationEditorMode.mode === mode) {
    state.isHighlightModeEnabled = enabled;
    return;
  }
  
  try {
    if (state.pdfDoc) {
      state.pdfDoc.annotationEditorMode = { mode };
    }
  } catch (e) {
    if (enabled) {
      console.warn("Failed to apply highlight mode:", e);
    }
  }
  state.isHighlightModeEnabled = enabled;
  if (uiRefs.pdfHighlightBtn) {
    uiRefs.pdfHighlightBtn.classList.toggle("active", enabled);
  }
}

function saveHighlights() {
  if (!state.pdfDocumentProxy || !state.currentPdfPath) return;
  try {
    const highlights = [];
    const storage = state.pdfDocumentProxy.annotationStorage;
    if (storage && storage.size > 0) {
      const { map } = storage.serializable;
      if (map && map.size > 0) {
        for (const [key, val] of map) {
          if (val.annotationType === pdfjsLib.AnnotationEditorType.HIGHLIGHT) {
            const { outlines, ...rest } = val;
            if (rest.quadPoints && !(rest.quadPoints instanceof Array)) {
              rest.quadPoints = Array.from(rest.quadPoints);
            }
            highlights.push({ ...rest, id: undefined, storageKey: key });
          }
        }
      }
    }
    DocManager.save(state.currentPdfPath, { highlights });
  } catch (e) {
    console.warn("Failed to save highlights:", e);
  }
}

async function restoreHighlights(pdfViewer) {
  if (!state.pdfDocumentProxy || !state.currentPdfPath) return;
  const heavyData = await DocManager.getHeavy(state.currentPdfPath);
  if (!heavyData?.highlights?.length) return;

  const uiManager = pdfViewer._layerProperties?.annotationEditorUIManager;
  if (!uiManager) return;

  const byPage = new Map();
  for (const h of heavyData.highlights) {
    const pi = h.pageIndex;
    if (!byPage.has(pi)) byPage.set(pi, []);
    byPage.get(pi).push(h);
  }

  const restoredPages = new Set();

  async function restorePage(pageIndex) {
    if (restoredPages.has(pageIndex)) return;
    const items = byPage.get(pageIndex);
    if (!items) return;
    const layer = uiManager.getLayer(pageIndex);
    if (!layer) return;
    restoredPages.add(pageIndex);

    const scrollEl = uiRefs.viewerContainer;
    const scrollTop = scrollEl ? scrollEl.scrollTop : 0;
    const scrollLeft = scrollEl ? scrollEl.scrollLeft : 0;

    for (const data of items) {
      try {
        const editor = await layer.deserialize(data);
        if (editor) {
          layer.addOrRebuild(editor);
          uiManager.addToAnnotationStorage(editor);
          editor.unselect?.();
        }
      } catch (e) {
        console.warn(`Failed to restore highlight on page ${pageIndex}:`, e);
      }
    }

    uiManager.unselectAll?.();

    if (scrollEl) {
      scrollEl.scrollTop = scrollTop;
      scrollEl.scrollLeft = scrollLeft;
    }
  }

  for (const pageIndex of byPage.keys()) {
    await restorePage(pageIndex);
  }

  if (restoredPages.size < byPage.size) {
    const onLayerRendered = async (evt) => {
      const pageIndex = evt.pageNumber - 1;
      if (!byPage.has(pageIndex) || restoredPages.has(pageIndex)) return;
      await restorePage(pageIndex);
      if (restoredPages.size >= byPage.size) {
        eventBus.off("annotationeditorlayerrendered", onLayerRendered);
      }
    };
    eventBus.on("annotationeditorlayerrendered", onLayerRendered);
  }
}

function setupHighlightEventHandlers(pdfViewer) {
  if (!pdfViewer) {
    console.warn("setupHighlightEventHandlers: pdfViewer not ready");
    return;
  }

  eventBus.on("annotationeditormodechanged", (evt) => {
    const enabled = evt?.mode === highlightModeValue;
    state.isHighlightModeEnabled = enabled;
    if (uiRefs.pdfHighlightBtn) {
      uiRefs.pdfHighlightBtn.classList.toggle("active", enabled);
    }
  });

  eventBus.on("annotationeditoruimanager", () => {
    if (!state.pendingHighlightDefaultColor) return;
    eventBus.dispatch("switchannotationeditorparams", {
      source: "sunshade",
      type: pdfjsLib.AnnotationEditorParamsType.HIGHLIGHT_DEFAULT_COLOR,
      value: state.pendingHighlightDefaultColor,
    });
    state.pendingHighlightDefaultColor = null;
  });

  eventBus.on("switchannotationeditorparams", (evt) => {
    if (!evt || !state.currentPdfPath) return;
    const isHighlightColor =
      evt.type === pdfjsLib.AnnotationEditorParamsType.HIGHLIGHT_COLOR;
    const isDefaultColor =
      evt.type === pdfjsLib.AnnotationEditorParamsType.HIGHLIGHT_DEFAULT_COLOR;
    if (!isHighlightColor && !isDefaultColor) return;
    if (!evt.value) return;

    DocManager.save(state.currentPdfPath, { highlightDefaultColor: evt.value });

    if (isHighlightColor && !state.isApplyingHighlightDefault) {
      state.isApplyingHighlightDefault = true;
      eventBus.dispatch("switchannotationeditorparams", {
        source: "sunshade",
        type: pdfjsLib.AnnotationEditorParamsType.HIGHLIGHT_DEFAULT_COLOR,
        value: evt.value,
      });
      state.isApplyingHighlightDefault = false;
    }
  });

  eventBus.on("pagesloaded", async function onPagesLoaded() {
    const loadedPath = state.currentPdfPath;
    const loadedDoc = state.pdfDocumentProxy;

    if (loadedDoc && loadedDoc.annotationStorage) {
      loadedDoc.annotationStorage.onSetModified = () => {
        if (
          state.currentPdfPath !== loadedPath ||
          state.pdfDocumentProxy !== loadedDoc
        )
          return;
        state.hasUnsavedHighlights = true;
        clearTimeout(state.saveDebounceTimer);
        state.saveDebounceTimer = setTimeout(() => saveHighlights(), 500);
      };
    }
    
    await restoreHighlights(pdfViewer);
  });
}

function setupGlobalToolbarObserver() {
  const toolbarObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          if (node.classList.contains("editToolbar")) {
            normalizeEditToolbar(node);
          } else if (node.querySelectorAll) {
            const toolbars = node.querySelectorAll(".editToolbar");
            toolbars.forEach(normalizeEditToolbar);
          }

          let foundParams = false;
          if (
            node.classList.contains("editorParamsToolbar") ||
            node.querySelector(".colorPicker")
          ) {
            foundParams = true;
          } else if (
            node.querySelectorAll &&
            node.querySelectorAll(".editorParamsToolbar").length > 0
          ) {
            foundParams = true;
          }

          if (foundParams) {
            const editToolbars = document.querySelectorAll(".editToolbar");
            editToolbars.forEach(normalizeEditToolbar);
          }
        }
      }
    }
  });

  if (document.body) {
    toolbarObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  } else {
    document.addEventListener("DOMContentLoaded", () => {
      toolbarObserver.observe(document.body, {
        childList: true,
        subtree: true,
      });
    });
  }
}

export {
  setupEditToolbarObserver,
  applyHighlightMode,
  saveHighlights,
  restoreHighlights,
  setupHighlightEventHandlers,
  setupGlobalToolbarObserver,
};
