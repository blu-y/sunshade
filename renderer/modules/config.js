import * as pdfjsLib from "../../node_modules/pdfjs-dist/build/pdf.mjs";
import {
  PDFViewer,
  EventBus,
  PDFLinkService,
} from "../../node_modules/pdfjs-dist/web/pdf_viewer.mjs";
import { marked } from "../../node_modules/marked/lib/marked.esm.js";
import katex from "../../node_modules/katex/dist/katex.mjs";

const workerUrl = new URL(
  "../../node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

// Global state object
const state = {
  userDataPath: "",
  pdfDoc: null,
  pdfDocumentProxy: null,
  currentPdfPath: null,
  promptsCache: null,
  pinnedChip: null,
  lastExtractedText: "",
  lastKeywordsRaw: "",
  lastBriefRaw: "",
  lastSummaryRaw: "",
  lastBriefLines: [],
  lastKeywordsList: [],
  pendingHighlightDefaultColor: null,
  isApplyingHighlightDefault: false,
  isHighlightModeEnabled: false,
  saveDebounceTimer: null,
  hasUnsavedHighlights: false,
  currentModel: localStorage.getItem("sunshade-model") || "gpt-5.1-codex",
  isPageWidthFit: false,
};

window.sunshadeAPI.getUserDataPath().then((path) => {
  state.userDataPath = path;
});

const eventBus = new EventBus();
const pdfLinkService = new PDFLinkService({ eventBus });
const highlightModeValue = pdfjsLib.AnnotationEditorType?.HIGHLIGHT ?? 9;
const noEditorModeValue = pdfjsLib.AnnotationEditorType?.NONE ?? 0;

// UI element references
const uiRefs = {
  askBtn: document.getElementById("ask-btn"),
  askInput: document.getElementById("ask-input"),
  chatHistory: document.getElementById("chat-history"),
  chatEmpty: document.getElementById("chat-empty"),
  openaiChipText: document.getElementById("openai-chip-text"),
  openaiStatusDot: document.getElementById("openai-dot"),
  openaiChip: document.getElementById("openai-chip"),
  alertPill: document.getElementById("alert-pill"),
  pdfOpenBtn: document.getElementById("pdf-open"),
  pdfPrevBtn: document.getElementById("pdf-prev"),
  pdfNextBtn: document.getElementById("pdf-next"),
  pdfZoomInBtn: document.getElementById("pdf-zoom-in"),
  pdfZoomOutBtn: document.getElementById("pdf-zoom-out"),
  pdfZoomLevel: document.getElementById("pdf-zoom-level"),
  pdfFitBtn: document.getElementById("pdf-fit"),
  pdfHighlightBtn: document.getElementById("pdf-highlight"),
  pdfPageDisplay: document.getElementById("pdf-page-display"),
  pdfFileInput: document.getElementById("pdf-file-input"),
  pdfEmptyEl: document.getElementById("pdf-empty"),
  viewerContainer: document.getElementById("viewerContainer"),
  layout: document.getElementById("layout"),
  resizerLeft: document.getElementById("resizer-left"),
  resizerRight: document.getElementById("resizer-right"),
  keywordsBody: document.getElementById("keywords-body"),
  briefList: document.getElementById("brief-list"),
  summaryBody: document.getElementById("summary-body"),
  tooltipPortal: document.getElementById("tooltip-portal"),
  outlineView: document.getElementById("outline-view"),
  regenAllBtn: document.getElementById("regen-all-btn"),
  themeToggle: document.getElementById("theme-toggle"),
  themeIcon: document.getElementById("theme-toggle-icon"),
  modelSelector: document.getElementById("model-selector"),
  modelDropdown: document.getElementById("model-dropdown"),
  currentModelName: document.getElementById("current-model-name"),
};

export { pdfjsLib, PDFViewer, EventBus, PDFLinkService, marked, katex, eventBus, pdfLinkService, highlightModeValue, noEditorModeValue, uiRefs, state };
