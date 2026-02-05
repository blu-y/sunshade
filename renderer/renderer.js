import * as pdfjsLib from '../node_modules/pdfjs-dist/build/pdf.mjs';
import { PDFPageView, EventBus } from '../node_modules/pdfjs-dist/web/pdf_viewer.mjs';

const workerUrl = new URL(
  '../node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

// UI refs
const askBtn = document.getElementById('ask-btn');
const askInput = document.getElementById('ask-input');
const openaiChipText = document.getElementById('openai-chip-text');
const openaiStatusDot = document.getElementById('openai-dot');
const openaiChip = document.getElementById('openai-chip');
const alertPill = document.getElementById('alert-pill');
const pdfPrevBtn = document.getElementById('pdf-prev');
const pdfNextBtn = document.getElementById('pdf-next');
const pdfZoomInBtn = document.getElementById('pdf-zoom-in');
const pdfZoomOutBtn = document.getElementById('pdf-zoom-out');
const pdfFitBtn = document.getElementById('pdf-fit');
const pdfPageDisplay = document.getElementById('pdf-page-display');
const pdfFileInput = document.getElementById('pdf-file-input');
const pdfFooterEl = document.getElementById('pdf-footer');
const pdfEmptyEl = document.getElementById('pdf-empty');
const pdfPagesEl = document.getElementById('pdf-pages');
const layout = document.getElementById('layout');
const resizerLeft = document.getElementById('resizer-left');
const resizerRight = document.getElementById('resizer-right');

// State
let pdfDoc = null;
let pdfScale = 1.0;
let pdfPage = 1;
let pageViews = [];
const eventBus = new EventBus();

// Default chip state
if (openaiChipText && openaiStatusDot && openaiChip) {
  openaiChipText.textContent = 'Sign in required';
  openaiStatusDot.style.background = '#f97316';
  openaiChip.dataset.state = 'signed-out';
}

// Alerts
function setAlert(message, level = 'info') {
  if (!alertPill) return;
  if (!message) {
    alertPill.style.display = 'none';
    alertPill.removeAttribute('data-tooltip');
    alertPill.classList.remove('has-tooltip', 'error', 'warn');
    return;
  }
  alertPill.style.display = 'inline-flex';
  alertPill.dataset.tooltip = message;
  alertPill.classList.add('has-tooltip');
  alertPill.classList.remove('error', 'warn');
  if (level === 'error') alertPill.classList.add('error');
  if (level === 'warn') alertPill.classList.add('warn');
  const dot = alertPill.querySelector('.alert-dot');
  const text = document.getElementById('alert-text');
  if (dot) {
    if (level === 'error') dot.style.background = '#ef4444';
    else if (level === 'warn') dot.style.background = '#f59e0b';
    else dot.style.background = '#22c55e';
  }
  if (text) text.textContent = level === 'error' ? 'Error' : level === 'warn' ? 'Warn' : 'Info';
}

function logMessage(message, level = 'info') {
  if (level === 'error') {
    setAlert(message, 'error');
    console.error(message);
  } else if (level === 'warn') {
    setAlert(message, 'warn');
    console.warn(message);
  } else {
    setAlert(message, 'info');
    console.log(message);
  }
}

// OpenAI status
async function refreshOpenAIStatus() {
  if (!openaiChipText || !openaiStatusDot || !openaiChip) return;
  try {
    const status = await window.sunshadeAPI.openaiAuthStatus();
    if (status.hasTokens) {
      openaiChipText.textContent = 'Signed in';
      openaiStatusDot.style.background = '#22c55e';
      openaiChip.dataset.tooltip = 'Click to sign out';
      openaiChip.classList.add('has-tooltip');
      openaiChip.dataset.state = 'signed-in';
      setAlert(null);
    } else {
      openaiChipText.textContent = 'Sign in required';
      openaiStatusDot.style.background = '#f97316';
      openaiChip.dataset.tooltip = 'OpenAI Codex: not signed in';
      openaiChip.classList.add('has-tooltip');
      openaiChip.dataset.state = 'signed-out';
    }
  } catch (err) {
    openaiChipText.textContent = `Error`;
    openaiStatusDot.style.background = '#ef4444';
    openaiChip.dataset.tooltip = `Status check failed: ${err.message}`;
    openaiChip.classList.add('has-tooltip');
    openaiChip.dataset.state = 'error';
    setAlert(`OpenAI status error: ${err.message}`, 'error');
  }
}

openaiChip?.addEventListener('click', async () => {
  if (!openaiChip || !openaiChipText || !openaiStatusDot) return;
  const state = openaiChip.dataset.state;
  if (state === 'signed-in') {
    const ok = confirm('Sign out from OpenAI Codex?');
    if (!ok) return;
    openaiChipText.textContent = 'Signing out...';
    openaiStatusDot.style.background = '#f97316';
    try {
      await window.sunshadeAPI.openaiLogout();
      openaiChipText.textContent = 'Signed out';
      openaiStatusDot.style.background = '#f97316';
      openaiChip.dataset.state = 'signed-out';
      openaiChip.dataset.tooltip = 'OpenAI Codex: not signed in';
    } catch (err) {
      openaiChipText.textContent = 'Logout failed';
      openaiStatusDot.style.background = '#ef4444';
      openaiChip.dataset.state = 'error';
      openaiChip.dataset.tooltip = `Logout failed: ${err.message}`;
      console.error(err);
    }
    return;
  }

  // sign in
  openaiChipText.textContent = 'Opening browser...';
  openaiStatusDot.style.background = '#f59e0b';
  openaiChip.dataset.state = 'signing-in';
  openaiChip.dataset.tooltip = 'Signing in...';
  try {
    await window.sunshadeAPI.openaiLogin();
    openaiChipText.textContent = 'Signed in';
    openaiStatusDot.style.background = '#22c55e';
    openaiChip.dataset.state = 'signed-in';
    openaiChip.dataset.tooltip = 'Click to sign out';
    setAlert(null);
  } catch (err) {
    openaiChipText.textContent = 'Login failed';
    openaiStatusDot.style.background = '#ef4444';
    openaiChip.dataset.state = 'error';
    openaiChip.dataset.tooltip = `Login failed: ${err.message}`;
    console.error(err);
    setAlert(`OpenAI login failed: ${err.message}`, 'error');
  }
});

refreshOpenAIStatus().catch((err) => console.error('OpenAI status error', err));

// PDF render helpers
async function loadPdf(file) {
  if (!pdfjsLib || !pdfPagesEl) {
    logMessage('PDF engine not ready', 'warn');
    return;
  }
  try {
    const arrayBuffer = await file.arrayBuffer();
    pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    pdfPage = 1;
    pdfScale = 1.0;
    await renderAllPages();
    updatePdfControls();
    logMessage(`Loaded PDF: ${file.name} (${pdfDoc.numPages} pages)`, 'info');
  } catch (err) {
    logMessage(`PDF load failed: ${err.message}`, 'error');
  }
}

async function renderAllPages() {
  if (!pdfDoc || !pdfPagesEl) return;
  pdfPagesEl.innerHTML = '';
  pageViews = [];
  togglePdfPlaceholder(false);
  pdfPagesEl.style.display = 'block';
  for (let i = 1; i <= pdfDoc.numPages; i += 1) {
    const page = await pdfDoc.getPage(i);
    const viewport = page.getViewport({ scale: pdfScale });
    const container = document.createElement('div');
    container.className = 'pdf-page';
    pdfPagesEl.appendChild(container);

    const pageView = new PDFPageView({
      container,
      id: i,
      scale: pdfScale,
      defaultViewport: viewport,
      eventBus,
      textLayerMode: 1,
      annotationMode: 0,
    });
    pageView.setPdfPage(page);
    await pageView.draw();
    pageViews.push(pageView);
  }
  pdfFooterEl.style.display = 'block';
  pdfFooterEl.textContent = `Page 1 of ${pdfDoc.numPages}`;
  setAlert(null);
}

function updatePdfControls() {
  if (pdfPageDisplay) {
    pdfPageDisplay.textContent = pdfDoc
      ? `${pdfPage} / ${pdfDoc.numPages}`
      : '- / -';
  }
  const disabled = !pdfDoc;
  [pdfPrevBtn, pdfNextBtn, pdfZoomInBtn, pdfZoomOutBtn, pdfFitBtn].forEach((btn) => {
    if (btn) btn.disabled = disabled;
  });
  if (pdfPrevBtn) pdfPrevBtn.disabled = disabled || pdfPage <= 1;
  if (pdfNextBtn) pdfNextBtn.disabled = disabled || (pdfDoc && pdfPage >= pdfDoc.numPages);
  if (pdfFooterEl) {
    pdfFooterEl.textContent = pdfDoc
      ? `Page ${pdfPage} of ${pdfDoc.numPages}`
      : ' ';
  }
}

function togglePdfPlaceholder(show) {
  if (!pdfEmptyEl || !pdfPagesEl || !pdfFooterEl) return;
  pdfEmptyEl.style.display = show ? 'flex' : 'none';
  pdfFooterEl.style.display = show ? 'none' : 'block';
  pdfPagesEl.style.display = show ? 'none' : 'block';
}

function wirePdfInput() {
  const dropTargets = [pdfPagesEl, pdfEmptyEl];
  dropTargets.forEach((el) => {
    el?.addEventListener('dragover', (e) => {
      e.preventDefault();
    });
    el?.addEventListener('drop', (e) => {
      e.preventDefault();
      const file = e.dataTransfer.files?.[0];
      if (file && file.type === 'application/pdf') {
        loadPdf(file);
      }
    });
    el?.addEventListener('click', () => {
      if (!pdfDoc) pdfFileInput?.click();
    });
  });
}

async function scrollToPage(targetPage) {
  if (!pageViews.length || !pdfPagesEl) return;
  const idx = Math.min(Math.max(targetPage, 1), pageViews.length) - 1;
  const targetDiv = pageViews[idx]?.div;
  if (targetDiv) targetDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
  pdfPage = idx + 1;
  updatePdfControls();
}

// Toolbar wiring
pdfFileInput?.addEventListener('change', () => {
  const file = pdfFileInput.files?.[0];
  if (file) {
    loadPdf(file);
    pdfFileInput.value = '';
  }
});
pdfPrevBtn?.addEventListener('click', async () => {
  if (!pdfDoc || pdfPage <= 1) return;
  pdfPage -= 1;
  await scrollToPage(pdfPage);
});
pdfNextBtn?.addEventListener('click', async () => {
  if (!pdfDoc || pdfPage >= pdfDoc.numPages) return;
  pdfPage += 1;
  await scrollToPage(pdfPage);
});
pdfZoomInBtn?.addEventListener('click', async () => {
  if (!pdfDoc) return;
  pdfScale = Math.min(pdfScale + 0.1, 3);
  await renderAllPages();
});
pdfZoomOutBtn?.addEventListener('click', async () => {
  if (!pdfDoc) return;
  pdfScale = Math.max(pdfScale - 0.1, 0.4);
  await renderAllPages();
});
pdfFitBtn?.addEventListener('click', async () => {
  if (!pdfDoc || !pdfPagesEl) return;
  const containerWidth = pdfPagesEl.clientWidth || 800;
  const page = await pdfDoc.getPage(pdfPage);
  const viewport = page.getViewport({ scale: 1 });
  pdfScale = containerWidth / viewport.width;
  await renderAllPages();
});

// Ask button placeholder
askBtn?.addEventListener('click', () => {
  const q = askInput?.value.trim();
  if (!q) return;
  logMessage(`샘플 응답 대기: "${q}" (LLM 연동 예정)`, 'info');
});

// Resizers with persistence
function loadLayoutState() {
  try {
    const raw = localStorage.getItem('sunshade-layout');
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed.left) document.documentElement.style.setProperty('--col-left', parsed.left);
    if (parsed.right) document.documentElement.style.setProperty('--col-right', parsed.right);
  } catch (err) {
    console.warn('Failed to load layout state', err);
  }
}

function saveLayoutState() {
  try {
    const left = getComputedStyle(document.documentElement).getPropertyValue('--col-left').trim();
    const right = getComputedStyle(document.documentElement).getPropertyValue('--col-right').trim();
    localStorage.setItem('sunshade-layout', JSON.stringify({ left, right }));
  } catch (err) {
    console.warn('Failed to save layout state', err);
  }
}

function setupResizer(resizer, side) {
  if (!resizer || !layout) return;
  let startX = 0;
  let startWidth = 0;
  resizer.addEventListener('mousedown', (e) => {
    startX = e.clientX;
    const styles = getComputedStyle(document.documentElement);
    startWidth =
      side === 'left'
        ? parseInt(styles.getPropertyValue('--col-left'))
        : parseInt(styles.getPropertyValue('--col-right'));
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    e.preventDefault();
  });

  const onMouseMove = (e) => {
    const delta = e.clientX - startX;
    if (side === 'left') {
      const newWidth = Math.max(200, Math.min(500, startWidth + delta));
      document.documentElement.style.setProperty('--col-left', `${newWidth}px`);
    } else {
      const newWidth = Math.max(300, Math.min(700, startWidth - delta));
      document.documentElement.style.setProperty('--col-right', `${newWidth}px`);
    }
  };

  const onMouseUp = () => {
    saveLayoutState();
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  };
}

wirePdfInput();
loadLayoutState();
setupResizer(resizerLeft, 'left');
setupResizer(resizerRight, 'right');
updatePdfControls();
togglePdfPlaceholder(true);
