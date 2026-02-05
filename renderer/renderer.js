import * as pdfjsLib from '../node_modules/pdfjs-dist/build/pdf.mjs';
import { PDFPageView, EventBus } from '../node_modules/pdfjs-dist/web/pdf_viewer.mjs';
import { marked } from '../node_modules/marked/lib/marked.esm.js';
import katex from '../node_modules/katex/dist/katex.mjs';

const workerUrl = new URL(
  '../node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

// UI refs
const askBtn = document.getElementById('ask-btn');
const askInput = document.getElementById('ask-input');
const askOutput = document.getElementById('ask-output');
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
const keywordsBody = document.getElementById('keywords-body');
const briefList = document.getElementById('brief-list');
const summaryBody = document.getElementById('summary-body');
let promptsCache = null;
let lastExtractedText = '';
let lastKeywordsRaw = '';
let lastBriefRaw = '';
let lastSummaryRaw = '';
let lastBriefLines = [];
let lastKeywordsList = [];

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
    updateSummaryPlaceholders(true);
    await generateSummaries();
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
  updateSummaryPlaceholders(!show && !!pdfDoc);
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
  runChat(q).catch((err) => logMessage(`Chat error: ${err.message}`, 'error'));
});

async function runChat(question) {
  if (!askBtn) return;
  askBtn.disabled = true;
  const prevLabel = askBtn.textContent;
  askBtn.textContent = '생성 중...';
  setAlert('응답 생성 중...', 'info');
  try {
    const res = await window.sunshadeAPI.openaiChatCompletion([
      { role: 'user', content: question }
    ]);
    renderAnswer(question, res.reply);
    setAlert(null);
  } catch (err) {
    const msg = err?.message || '알 수 없는 오류';
    const quota = msg.includes('insufficient_quota') || msg.includes('429');
    const friendly = quota
      ? 'Codex 사용 한도를 초과했거나 계정 상태를 확인해야 합니다.'
      : `OpenAI 요청 실패: ${msg}`;
    setAlert(friendly, 'error');
    renderError(friendly);
    throw err;
  } finally {
    askBtn.disabled = false;
    askBtn.textContent = prevLabel || '질문';
  }
}

function renderAnswer(question, answer) {
  if (!askOutput) return;
  askOutput.classList.remove('muted');
  askOutput.innerHTML = '';
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = '응답';
  const qEl = document.createElement('div');
  qEl.style.fontWeight = '600';
  qEl.style.marginBottom = '6px';
  qEl.textContent = `Q: ${question}`;
  const aEl = document.createElement('div');
  aEl.textContent = answer;
  askOutput.appendChild(label);
  askOutput.appendChild(qEl);
  askOutput.appendChild(aEl);
}

function renderError(message) {
  if (!askOutput) return;
  askOutput.classList.remove('muted');
  askOutput.innerHTML = '';
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = '오류';
  const body = document.createElement('div');
  body.textContent = message;
  body.style.color = '#b91c1c';
  askOutput.appendChild(label);
  askOutput.appendChild(body);
}

function updateSummaryPlaceholders(hasPdf) {
  const setInfo = (el, text) => {
    if (!el) return;
    el.classList.add('info-text');
    el.classList.add('placeholder');
    el.textContent = text;
  };
  if (!hasPdf) {
    setInfo(keywordsBody, '파일을 선택하면 키워드가 표시됩니다.');
    if (briefList) {
      briefList.classList.add('info-text');
      briefList.classList.add('placeholder');
      briefList.innerHTML = '';
      const li = document.createElement('li');
      li.textContent = '파일을 선택하면 3줄 요약이 표시됩니다.';
      briefList.appendChild(li);
    }
    setInfo(summaryBody, '파일을 선택하면 요약이 표시됩니다.');
    return;
  }
  // PDF가 있을 때는 내용만 비워둠 (추후 실제 요약 채움)
  if (keywordsBody) {
    keywordsBody.textContent = '';
    keywordsBody.classList.remove('placeholder');
  }
  if (briefList) {
    briefList.innerHTML = '';
    briefList.classList.remove('placeholder');
  }
  if (summaryBody) {
    summaryBody.textContent = '';
    summaryBody.classList.remove('placeholder');
  }
}

function renderKeywords(reply) {
  if (!keywordsBody) return;
  keywordsBody.innerHTML = '';
  lastKeywordsList = [];
  try {
    const parsed = tryParseKeywords(reply);
    if (parsed.length) {
      lastKeywordsList = parsed;
      parsed.slice(0, 12).forEach(({ term, desc }) => {
        const chip = document.createElement('span');
        chip.className = 'keyword-chip';
        chip.textContent = term;
        if (desc) chip.dataset.desc = desc;
        keywordsBody.appendChild(chip);
      });
    }
  } catch {
    // ignore
  }
  if (!keywordsBody.children.length) {
    keywordsBody.textContent = '생성 실패';
  }
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

function normalizeLine(line) {
  return sanitizeText(line).replace(/\s+/g, ' ');
}

function dedupeSummary(text) {
  const t = sanitizeText(text);
  if (!t) return '';
  // Case 1: two halves identical (perfect duplication)
  const half = Math.floor(t.length / 2);
  if (half > 20 && t.slice(0, half) === t.slice(half)) {
    return t.slice(0, half).trim();
  }
  // Case 2: dedupe by paragraphs/sections
  const paras = t.replace(/\r/g, '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const seen = new Set();
  const uniq = [];
  paras.forEach((p) => {
    if (seen.has(p)) return;
    seen.add(p);
    uniq.push(p);
  });
  return uniq.join('\n\n');
}

function formatKeywordsForCopy(raw) {
  const source = lastKeywordsList.length ? lastKeywordsList : tryParseKeywords(raw);
  if (!source || !source.length) return '';
  return source
    .map(({ term, desc }) => `${term} - ${desc}`.trim())
    .filter(Boolean)
    .join('\n');
}

function formatBriefForCopy() {
  if (lastBriefLines?.length) {
    return lastBriefLines.map(normalizeLine).join('\n');
  }
  return parseBriefLines(lastBriefRaw).map(normalizeLine).join('\n');
}

function parseBriefLines(raw) {
  if (!raw) return [];
  let cleaned = sanitizeText(raw).replace(/\r/g, '');
  // 이모지 앞에서 분리 (변형 선택자 포함)
  const parts = cleaned
    .split(/(?=[🤖🧠🛠️🚀🌎🧑‍💻📈💡🧭🏁🎯🔧⚙️📌📍])/u)
    .map((l) => l.trim())
    .filter(Boolean);
  const merged = mergeEmojiSingles(parts).map(normalizeLine).filter(Boolean);
  return dedupeLines(merged);
}

function sanitizeText(text) {
  return (text || '').replace(/\uFFFD/g, '').trim();
}

function mergeEmojiSingles(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^[🤖🧠🛠️🚀🌎🧑‍💻📈💡🧭🏁🎯🔧⚙️📌📍]$/u.test(line) && i + 1 < lines.length) {
      out.push(`${line} ${lines[i + 1]}`.trim());
      i += 1;
    } else {
      out.push(line);
    }
  }
  return out;
}

function renderMarkdownToHtml(md) {
  if (!md) return '';
  const html = marked.parse(md, { mangle: false, headerIds: false });
  return renderMath(html);
}

function renderMath(html) {
  if (!html) return '';
  // block math $$...$$
  html = html.replace(/\$\$([\s\S]+?)\$\$/g, (_, expr) => {
    try {
      return katex.renderToString(expr, { throwOnError: false, displayMode: true });
    } catch (e) {
      return `$$${expr}$$`;
    }
  });
  // inline math $...$
  html = html.replace(/\$([^\$]+?)\$/g, (_, expr) => {
    try {
      return katex.renderToString(expr, { throwOnError: false, displayMode: false });
    } catch (e) {
      return `$${expr}$`;
    }
  });
  return html;
}

function tryParseKeywords(raw) {
  if (!raw) return [];
  const cleaned = sanitizeText(raw);
  const candidates = [];

  const attempt = (str) => {
    try {
      const parsed = JSON.parse(str);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && typeof parsed === 'object') return [parsed];
    } catch {
      return null;
    }
    return null;
  };

  // 1) direct
  let parsed = attempt(cleaned);
  if (!parsed) {
    // 2) wrap objects separated by '},{'
    if (cleaned.includes('},{') && !cleaned.trim().startsWith('[')) {
      parsed = attempt(`[${cleaned}]`);
    }
  }
  if (!parsed) {
    // 3) extract objects via regex
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
      const term = sanitizeText(item.term || item.keyword || item.name || '');
      const desc = sanitizeText(item.desc || item.description || '');
      if (!term) return null;
      return { term, desc };
    })
    .filter(Boolean);
}

// Toggle active tooltip on click for scrollable panel
document.addEventListener('click', (e) => {
  const chip = e.target.closest('.keyword-chip');
  if (!chip) {
    document.querySelectorAll('.keyword-chip.active').forEach((el) => el.classList.remove('active'));
    return;
  }
  const alreadyActive = chip.classList.contains('active');
  document.querySelectorAll('.keyword-chip.active').forEach((el) => el.classList.remove('active'));
  if (!alreadyActive) chip.classList.add('active');
});

async function generateSummaries() {
  if (!pdfDoc) return;
  try {
    const prompts = await loadPrompts();
    const text = await extractPdfText(pdfDoc, 6, 12000);
    if (!text) return;
    lastExtractedText = text;

    // keywords
    if (keywordsBody) {
      keywordsBody.textContent = '생성 중...';
      keywordsBody.classList.remove('placeholder');
      const res = await window.sunshadeAPI.openaiChatCompletion(
        [
          { role: 'system', content: prompts.system || 'You are Sunshade.' },
          { role: 'user', content: `${prompts.sections?.keywords || 'Extract keywords.'}\n\n${text}` }
        ],
        prompts.sections?.keywords
      );
      lastKeywordsRaw = res.reply || '';
      renderKeywords(lastKeywordsRaw);
    }

  // 3줄 요약
  if (briefList) {
    briefList.innerHTML = '<li>생성 중...</li>';
    briefList.classList.remove('placeholder');
    const res = await window.sunshadeAPI.openaiChatCompletion(
      [
        { role: 'system', content: prompts.system || 'You are Sunshade.' },
        { role: 'user', content: `${prompts.sections?.brief || 'Give 3 bullet sentences.'}\n\n${text}` }
      ],
      prompts.sections?.brief
    );
    lastBriefRaw = res.reply || '';
    const lines = parseBriefLines(lastBriefRaw).slice(0, 3);
    lastBriefLines = lines;
    briefList.innerHTML = '';
      if (lines.length === 0) {
        const li = document.createElement('li');
        li.textContent = '생성 실패';
        briefList.appendChild(li);
      } else {
        lines.forEach((line) => {
          const li = document.createElement('li');
          li.textContent = normalizeLine(line.replace(/^\d+[\).\s-]*/, ''));
          briefList.appendChild(li);
        });
      }
    }

    // 요약
    if (summaryBody) {
      summaryBody.textContent = '생성 중...';
      summaryBody.classList.remove('placeholder');
      const res = await window.sunshadeAPI.openaiChatCompletion(
        [
          { role: 'system', content: prompts.system || 'You are Sunshade.' },
          { role: 'user', content: `${prompts.sections?.summary || 'Summarize.'}\n\n${text}` }
        ],
        prompts.sections?.summary
      );
      lastSummaryRaw = dedupeSummary(res.reply || '');
      console.log('summary raw:', lastSummaryRaw);
      summaryBody.innerHTML = renderMarkdownToHtml(lastSummaryRaw || '생성 실패');
    }
  } catch (err) {
    console.error('generateSummaries error', err);
    setAlert(`요약 생성 실패: ${err.message}`, 'error');
  }
}

async function loadPrompts() {
  if (promptsCache) return promptsCache;
  try {
    const res = await window.sunshadeAPI.loadPrompts();
    promptsCache = res || {};
    return promptsCache;
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
      parts.push(strings.join(' '));
      if (parts.join(' ').length > maxChars) break;
    }
    return parts.join(' ').slice(0, maxChars);
  } catch (err) {
    console.error('extractPdfText error', err);
    return '';
  }
}

// Section action handlers (settings / copy / regenerate)
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.section-btn');
  if (!btn) return;
  const section = btn.dataset.section;
  const action = btn.dataset.action;
  if (!section || !action) return;

  if (action === 'settings') {
    alert('프롬프트는 src/llm/prompts.json 파일에서 수정할 수 있습니다.');
    return;
  }

  if (action === 'copy') {
    let text = '';
    if (section === 'keywords') text = formatKeywordsForCopy(lastKeywordsRaw);
    if (section === 'brief') text = formatBriefForCopy();
    if (section === 'summary') text = lastSummaryRaw;
    if (!text) {
      setAlert('복사할 내용이 없습니다. 먼저 PDF를 열어 생성하세요.', 'warn');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setAlert('복사 완료', 'info');
    } catch (err) {
      setAlert(`클립보드 복사 실패: ${err.message}`, 'error');
    }
    return;
  }

  if (action === 'regen') {
    if (!lastExtractedText) {
      setAlert('먼저 PDF를 로드하세요.', 'warn');
      return;
    }
    try {
      const prompts = await loadPrompts();
      if (section === 'keywords') {
        keywordsBody.textContent = '다시 생성 중...';
        const res = await window.sunshadeAPI.openaiChatCompletion(
          [
            { role: 'system', content: prompts.system || 'You are Sunshade.' },
            { role: 'user', content: `${prompts.sections?.keywords || 'Extract keywords.'}\n\n${lastExtractedText}` }
          ],
          prompts.sections?.keywords
        );
        lastKeywordsRaw = res.reply || '';
        renderKeywords(lastKeywordsRaw);
      } else if (section === 'brief') {
        briefList.innerHTML = '<li>다시 생성 중...</li>';
        const res = await window.sunshadeAPI.openaiChatCompletion(
          [
            { role: 'system', content: prompts.system || 'You are Sunshade.' },
            { role: 'user', content: `${prompts.sections?.brief || 'Give 3 bullet sentences.'}\n\n${lastExtractedText}` }
          ],
          prompts.sections?.brief
        );
        lastBriefRaw = res.reply || '';
        const lines = parseBriefLines(lastBriefRaw).slice(0, 3);
        lastBriefLines = lines;
        briefList.innerHTML = '';
        lines.forEach((line) => {
          const li = document.createElement('li');
          li.textContent = normalizeLine(line.replace(/^\d+[\).\s-]*/, ''));
          briefList.appendChild(li);
        });
      } else if (section === 'summary') {
        summaryBody.textContent = '다시 생성 중...';
        const res = await window.sunshadeAPI.openaiChatCompletion(
          [
            { role: 'system', content: prompts.system || 'You are Sunshade.' },
            { role: 'user', content: `${prompts.sections?.summary || 'Summarize.'}\n\n${lastExtractedText}` }
          ],
          prompts.sections?.summary
        );
        lastSummaryRaw = dedupeSummary(res.reply || '');
        console.log('summary raw (regen):', lastSummaryRaw);
        summaryBody.innerHTML = renderMarkdownToHtml(lastSummaryRaw || '생성 실패');
      }
      setAlert(null);
    } catch (err) {
      setAlert(`재생성 실패: ${err.message}`, 'error');
    }
  }
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
