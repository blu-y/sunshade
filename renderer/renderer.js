import * as pdfjsLib from '../node_modules/pdfjs-dist/build/pdf.mjs';
import { PDFViewer, EventBus, PDFLinkService } from '../node_modules/pdfjs-dist/web/pdf_viewer.mjs';
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
const chatHistory = document.getElementById('chat-history');
const chatEmpty = document.getElementById('chat-empty');
const openaiChipText = document.getElementById('openai-chip-text');
const openaiStatusDot = document.getElementById('openai-dot');
const openaiChip = document.getElementById('openai-chip');
const alertPill = document.getElementById('alert-pill');
const pdfOpenBtn = document.getElementById('pdf-open');
const pdfPrevBtn = document.getElementById('pdf-prev');
const pdfNextBtn = document.getElementById('pdf-next');
const pdfZoomInBtn = document.getElementById('pdf-zoom-in');
const pdfZoomOutBtn = document.getElementById('pdf-zoom-out');
const pdfZoomLevel = document.getElementById('pdf-zoom-level');
const pdfFitBtn = document.getElementById('pdf-fit');
const pdfPageDisplay = document.getElementById('pdf-page-display');
const pdfFileInput = document.getElementById('pdf-file-input');
// const pdfFooterEl = document.getElementById('pdf-footer'); // Removed
const pdfEmptyEl = document.getElementById('pdf-empty');
const viewerContainer = document.getElementById('viewerContainer'); // New container
const layout = document.getElementById('layout');
const resizerLeft = document.getElementById('resizer-left');
const resizerRight = document.getElementById('resizer-right');
const keywordsBody = document.getElementById('keywords-body');
const briefList = document.getElementById('brief-list');
const summaryBody = document.getElementById('summary-body');
const tooltipPortal = document.getElementById('tooltip-portal');
const regenAllBtn = document.getElementById('regen-all-btn'); // Add reference
let promptsCache = null;
let pinnedChip = null;
let lastExtractedText = '';
let lastKeywordsRaw = '';
let lastBriefRaw = '';
let lastSummaryRaw = '';
let lastBriefLines = [];
let lastKeywordsList = [];

// State
let pdfDoc = null;
let currentPdfPath = null; // Track current file path for favorites
const eventBus = new EventBus();
const pdfLinkService = new PDFLinkService({ eventBus });
const pdfViewer = new PDFViewer({
  container: viewerContainer,
  eventBus: eventBus,
  linkService: pdfLinkService,
  textLayerMode: 2, // Enable text selection
});
pdfLinkService.setViewer(pdfViewer);

// --- DocManager: History & Favorites & Cache ---
const DocManager = {
  key: 'sunshade-docs',
  
  getAll() {
    try {
      const raw = localStorage.getItem(this.key);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  },
  
  saveAll(docs) {
    try {
      localStorage.setItem(this.key, JSON.stringify(docs));
      console.log('Docs saved. Count:', Object.keys(docs).length);
    } catch (e) {
      console.error('Failed to save docs:', e);
    }
  },
  
  get(path) {
    const docs = this.getAll();
    return docs[path] || null;
  },
  
  save(path, data) {
    const docs = this.getAll();
    docs[path] = {
      ...docs[path],
      ...data,
      path, // ensure path
      lastOpened: Date.now()
    };
    this.saveAll(docs);
    this.notifyUpdate();
  },
  
  toggleFavorite(path) {
    const docs = this.getAll();
    if (docs[path]) {
      docs[path].isFavorite = !docs[path].isFavorite;
      this.saveAll(docs);
      this.notifyUpdate();
      return docs[path].isFavorite;
    }
    return false;
  },
  
  delete(path) {
    const docs = this.getAll();
    if (docs[path]) {
      delete docs[path];
      this.saveAll(docs);
      this.notifyUpdate();
      console.log('Deleted doc:', path);
    } else {
      console.warn('Doc not found to delete:', path);
    }
  },
  
  clearHistory() {
    const docs = this.getAll();
    let changed = false;
    let count = 0;
    Object.keys(docs).forEach(path => {
      if (!docs[path].isFavorite) {
        delete docs[path];
        changed = true;
        count++;
      }
    });
    if (changed) {
      this.saveAll(docs);
      this.notifyUpdate();
      console.log(`Cleared ${count} history items`);
    } else {
      console.log('No history items to clear');
    }
  },
  
  getList(filterType) { // 'all' (history) or 'favorite'
    const docs = this.getAll();
    let list = Object.values(docs);
    if (filterType === 'favorite') {
      list = list.filter(d => d.isFavorite);
    }
    // Sort by lastOpened desc
    return list.sort((a, b) => (b.lastOpened || 0) - (a.lastOpened || 0));
  },
  
  notifyUpdate() {
    // Dispatch custom event for UI update
    window.dispatchEvent(new CustomEvent('doc-update'));
  }
};

// Sync page number
eventBus.on('pagesinit', () => {
  pdfViewer.currentScaleValue = 'auto'; 
  updatePdfControls(); // Update UI immediately after init
});
eventBus.on('pagechanging', (evt) => {
  const page = evt.pageNumber;
  const num = pdfViewer.pagesCount;
  if (pdfPageDisplay) pdfPageDisplay.textContent = `${page} / ${num}`;
  updatePdfControls(); // Ensure controls are updated
  updateOutlineHighlight(page); // Highlight outline
});
eventBus.on('scalechanging', (evt) => {
  if (pdfZoomLevel && document.activeElement !== pdfZoomLevel) {
    pdfZoomLevel.value = `${Math.round(evt.scale * 100)}%`;
  }
});
eventBus.on('pagechanging', (evt) => {
  const page = evt.pageNumber;
  const num = pdfViewer.pagesCount;
  if (pdfPageDisplay) pdfPageDisplay.textContent = `${page} / ${num}`;
  updatePdfControls();
});

eventBus.on('scalechanging', (evt) => {
  if (pdfZoomLevel) {
    pdfZoomLevel.textContent = `${Math.round(evt.scale * 100)}%`;
  }
});

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
    // Info logs to console only to avoid chip spam
    // setAlert(message, 'info'); 
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
async function loadPdf(input) {
  if (!input) return;
  if (!pdfjsLib || !viewerContainer) {
    logMessage('PDF engine not ready', 'warn');
    return;
  }
  
  let arrayBuffer;
  let filePath = '';
  let fileName = '';
  
  try {
    if (typeof input === 'string') {
      // Path based load (from history)
      filePath = input;
      fileName = input.split(/[/\\]/).pop();
      const buffer = await window.sunshadeAPI.readFile(filePath);
      arrayBuffer = buffer.buffer; 
    } else {
      // File object load (drag drop / open)
      // Use webUtils via preload to get real path
      try {
        filePath = window.sunshadeAPI.getPathForFile(input);
      } catch (e) {
        console.warn('Failed to get file path:', e);
        filePath = input.path || ''; // Fallback
      }
      
      fileName = input.name;
      
      // Fallback if path is empty
      if (!filePath) {
        console.warn('File path missing, using name as ID');
        filePath = fileName; 
      }
      
      arrayBuffer = await input.arrayBuffer();
    }
    
    console.log('Loading PDF from:', filePath); // Debug log
    currentPdfPath = filePath; // Update global state

    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    pdfDoc = await loadingTask.promise;
    
    pdfViewer.setDocument(pdfDoc);
    pdfLinkService.setDocument(pdfDoc, null);
    
    document.querySelector('.pdf-pane').classList.add('has-pdf');
    
    // Load Outline
    loadOutline(pdfDoc);

    togglePdfPlaceholder(false); 
    
    // Reset Scroll
    const scrollContent = document.querySelector('.summary-scroll-content');
    if (scrollContent) scrollContent.scrollTop = 0;
    
    // Reset Chat UI first
    if (chatHistory) {
      chatHistory.innerHTML = '';
      chatHistory.style.display = 'none';
    }
    if (chatEmpty) chatEmpty.style.display = 'block';
    
    // Update Sidebar highlight
    renderSidebar();

    // --- Cache Logic ---
    const cached = DocManager.get(filePath);
    if (cached && cached.analysis) {
      console.log('Restoring from cache:', filePath);
      
      // Restore text & analysis
      lastExtractedText = cached.extractedText || '';
      
      // Check if analysis is actually populated
      const hasKeywords = !!cached.analysis.keywords;
      const hasBrief = !!cached.analysis.brief;
      const hasSummary = !!cached.analysis.summary;
      
      if (!hasKeywords && !hasBrief && !hasSummary) {
        // If analysis exists but empty, maybe it was interrupted
        console.warn('Cached analysis is empty, regenerating...');
        updateSummaryPlaceholders(true);
        await generateSummaries();
      } else {
        // Restore UI content
        if (regenAllBtn) regenAllBtn.style.display = 'flex'; // Show regen button on restore
        // Keywords
        if (hasKeywords) {
          lastKeywordsRaw = cached.analysis.keywords;
          renderKeywords(lastKeywordsRaw);
        }
        // Brief
        if (hasBrief) {
          lastBriefRaw = cached.analysis.brief;
          const lines = parseBriefLines(lastBriefRaw).slice(0, 3);
          lastBriefLines = lines;
          briefList.innerHTML = '';
          lines.forEach((line) => {
            const li = document.createElement('li');
            li.textContent = normalizeLine(line.replace(/^\d+[\).\s-]*/, ''));
            briefList.appendChild(li);
          });
          briefList.classList.remove('placeholder');
        }
        // Summary
        if (hasSummary) {
          lastSummaryRaw = cached.analysis.summary;
          summaryBody.innerHTML = renderMarkdownToHtml(lastSummaryRaw);
          summaryBody.classList.remove('placeholder');
          summaryBody.classList.remove('info-text');
        }
        
        // Remove placeholders manually since we filled content
        if (hasKeywords) keywordsBody.classList.remove('placeholder');

        // Restore Chat History
        if (cached.chatHistory && cached.chatHistory.length > 0) {
          if (chatEmpty) chatEmpty.style.display = 'none';
          if (chatHistory) {
            chatHistory.style.display = 'block';
            chatHistory.innerHTML = '';
            cached.chatHistory.forEach(item => {
              // Use shared helper
              const q = item.q.replace(/^Q: /, '');
              const { item: el } = createChatElement(q, item.a);
              chatHistory.appendChild(el);
            });
            // Don't auto-scroll on restore
          }
        }
      }
      
    } else {
      // New file
      updateSummaryPlaceholders(true); 
      await generateSummaries();
      
      // Save after generation is handled in generateSummaries
      // But we need to save basic info first
      DocManager.save(filePath, {
        name: fileName,
        extractedText: lastExtractedText // Will be updated
      });
    }
    
    console.log(`Loaded PDF: ${fileName} (${pdfDoc.numPages} pages)`);
  } catch (err) {
    logMessage(`PDF load failed: ${err.message}`, 'error');
  }
}

// renderAllPages removed (handled by PDFViewer)

function updatePdfControls() {
  const page = pdfViewer.currentPageNumber;
  const num = pdfViewer.pagesCount;
  
  if (pdfPageDisplay) {
    pdfPageDisplay.textContent = num ? `${page} / ${num}` : '- / -';
  }
  
  const disabled = !num;
  [pdfPrevBtn, pdfNextBtn, pdfZoomInBtn, pdfZoomOutBtn, pdfFitBtn].forEach((btn) => {
    if (btn) btn.disabled = disabled;
  });
  
  if (pdfPrevBtn) pdfPrevBtn.disabled = disabled || page <= 1;
  if (pdfNextBtn) pdfNextBtn.disabled = disabled || page >= num;
}

function togglePdfPlaceholder(show) {
  if (!pdfEmptyEl || !viewerContainer) return;
  pdfEmptyEl.style.display = show ? 'flex' : 'none';
  viewerContainer.style.visibility = show ? 'hidden' : 'visible';
}

function wirePdfInput() {
  const dropTargets = [viewerContainer, pdfEmptyEl];
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
      // Use open button logic
      if (!pdfDoc) pdfOpenBtn.click();
    });
  });
}

async function scrollToPage(targetPage) {
  // handled by pdfViewer.currentPageNumber
}

// Toolbar wiring
pdfOpenBtn?.addEventListener('click', async () => {
  try {
    const path = await window.sunshadeAPI.openFileDialog();
    if (path) {
      loadPdf(path);
    }
  } catch (err) {
    console.error('File open failed', err);
  }
});
// pdfFileInput listener removed/ignored since we use native dialog
/*
pdfFileInput?.addEventListener('change', () => {
  const file = pdfFileInput.files?.[0];
  if (file) {
    loadPdf(file);
    pdfFileInput.value = '';
  }
});
*/
let isPageWidthFit = false;

// Button actions delegated to pdfViewer
pdfPrevBtn?.addEventListener('click', () => {
  pdfViewer.currentPageNumber--;
});
pdfNextBtn?.addEventListener('click', () => {
  pdfViewer.currentPageNumber++;
});
pdfZoomInBtn?.addEventListener('click', () => {
  pdfViewer.currentScale += 0.1;
  isPageWidthFit = false;
  pdfFitBtn.classList.remove('active');
});
pdfZoomOutBtn?.addEventListener('click', () => {
  pdfViewer.currentScale -= 0.1;
  isPageWidthFit = false;
  pdfFitBtn.classList.remove('active');
});
pdfFitBtn?.addEventListener('click', () => {
  if (isPageWidthFit) {
    isPageWidthFit = false;
    pdfFitBtn.classList.remove('active');
  } else {
    isPageWidthFit = true;
    pdfFitBtn.classList.add('active');
    pdfViewer.currentScaleValue = 'page-width';
  }
});

// Auto-fit on resize
const resizeObserver = new ResizeObserver(() => {
  if (isPageWidthFit && pdfDoc) {
    pdfViewer.currentScaleValue = 'page-width';
  }
});
if (viewerContainer) resizeObserver.observe(viewerContainer);

// Manual zoom input
pdfZoomLevel?.addEventListener('change', () => {
  const val = parseInt(pdfZoomLevel.value, 10);
  if (!isNaN(val) && val > 0) {
    pdfViewer.currentScaleValue = val / 100;
  } else {
    // Reset to current if invalid
    pdfZoomLevel.value = `${Math.round(pdfViewer.currentScale * 100)}%`;
  }
});
pdfZoomLevel?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    pdfZoomLevel.blur(); // Trigger change
  }
});

// Ask button placeholder
askBtn?.addEventListener('click', () => {
  const q = askInput?.value.trim();
  if (!q) return;
  runChat(q).catch((err) => logMessage(`Chat error: ${err.message}`, 'error'));
});

// Auto-resize textarea and Enter to send
askInput?.addEventListener('input', () => {
  askInput.style.height = 'auto';
  askInput.style.height = Math.min(askInput.scrollHeight, 200) + 'px';
});

askInput?.addEventListener('keydown', (e) => {
  if (e.isComposing) return;
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    askBtn.click();
  }
});

// Model selector logic
let currentModel = localStorage.getItem('sunshade-model') || 'gpt-5.1-codex';
const modelSelector = document.getElementById('model-selector');
const modelDropdown = document.getElementById('model-dropdown');
const currentModelName = document.getElementById('current-model-name');

// Init UI from saved state
if (currentModelName) currentModelName.textContent = currentModel;
if (modelDropdown) {
  modelDropdown.querySelectorAll('.model-option').forEach(el => {
    el.classList.toggle('selected', el.dataset.model === currentModel);
  });
}

modelSelector?.addEventListener('click', (e) => {
  e.stopPropagation();
  modelDropdown.classList.toggle('show');
});

document.addEventListener('click', () => {
  modelDropdown?.classList.remove('show');
});

modelDropdown?.addEventListener('click', (e) => {
  const option = e.target.closest('.model-option');
  if (!option) return;
  e.stopPropagation();
  
  // Update state
  currentModel = option.dataset.model;
  currentModelName.textContent = currentModel;
  localStorage.setItem('sunshade-model', currentModel); // Save to local storage
  
  // Update UI
  document.querySelectorAll('.model-option').forEach(el => el.classList.remove('selected'));
  option.classList.add('selected');
  modelDropdown.classList.remove('show');
  
  console.log(`Model switched to ${currentModel}`);
});

async function runChat(question) {
  if (!askBtn) return;
  askBtn.disabled = true;
  // askBtn.textContent = '...'; // Keep icon instead of text change
  setAlert('응답 생성 중...', 'info');

  // Create new chat item
  const answerBody = appendChatItem(question);
  let accumulated = '';
  
  // Reset input height
  if (askInput) {
    askInput.value = '';
    askInput.style.height = 'auto';
  }

  // Inject context if available
  let finalQuestion = question;
  if (lastExtractedText && lastExtractedText.length > 50) {
    finalQuestion = `Reference Document:\n${lastExtractedText}\n\nQuestion: ${question}`;
  }

  try {
    // Stream Chat
    await new Promise((resolve, reject) => {
      window.sunshadeAPI.openaiStream(
        [{ role: 'user', content: finalQuestion }],
        undefined, // default instructions
        {
          onChunk: (chunk) => {
            accumulated += chunk;
            answerBody.innerHTML = renderMarkdownToHtml(accumulated);
            // Scroll parent container to bottom
            const scrollContent = document.querySelector('.summary-scroll-content');
            if (scrollContent) {
                scrollContent.scrollTop = scrollContent.scrollHeight;
            }
          },
          onDone: () => resolve(),
          onError: (err) => reject(err)
        },
        currentModel // Pass selected model
      );
    });
    setAlert(null);
    
    // Save chat history after done
    if (currentPdfPath) {
      // Get current chat history
      const history = [];
      document.querySelectorAll('.chat-item').forEach(item => {
        const q = item.querySelector('.chat-q')?.textContent;
        const a = item.querySelector('.chat-a')?.innerHTML; // Save HTML for markdown
        if (q && a) history.push({ q, a });
      });
      DocManager.save(currentPdfPath, { chatHistory: history });
    }
    
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
    // askBtn.textContent = prevLabel || '질문'; // Icon button, no text reset needed
  }
}

function createChatElement(question, answer = '') {
  const item = document.createElement('div');
  item.className = 'chat-item';
  item.style.position = 'relative';
  
  const qEl = document.createElement('div');
  qEl.className = 'chat-q';
  qEl.textContent = question;
  
  const aEl = document.createElement('div');
  aEl.className = 'chat-a';
  aEl.innerHTML = answer; // Use innerHTML for markdown
  
  // Delete button
  const delBtn = document.createElement('img');
  delBtn.src = '../src/images/recycle-bin.png';
  delBtn.className = 'chat-del-btn';
  delBtn.style.position = 'absolute';
  delBtn.style.top = '10px';
  delBtn.style.right = '10px';
  delBtn.style.width = '14px';
  delBtn.style.height = '14px';
  delBtn.style.cursor = 'pointer';
  delBtn.style.opacity = '0';
  delBtn.style.transition = 'opacity 0.2s';
  delBtn.title = '이 대화 삭제';
  
  // Hover logic
  item.addEventListener('mouseenter', () => delBtn.style.opacity = '0.5');
  item.addEventListener('mouseleave', () => delBtn.style.opacity = '0');
  delBtn.addEventListener('mouseenter', () => delBtn.style.opacity = '1');
  
  delBtn.addEventListener('click', () => {
    // Save position before removal
    const rect = delBtn.getBoundingClientRect();
    
    // No confirm, immediate delete
    item.remove();
    saveChatHistory(); // Sync
    
    // Check if empty
    const historyContainer = document.getElementById('chat-history');
    const emptyContainer = document.getElementById('chat-empty');
    if (historyContainer && historyContainer.children.length === 0) {
        if (emptyContainer) emptyContainer.style.display = 'block';
    }
    
    // Show toast below the main clear button (consistent position)
    const clearBtn = document.querySelector('#card-chat .section-btn[data-action="clear"]');
    showToast(clearBtn || document.body, 'Deleted');
  });
  
  item.appendChild(qEl);
  item.appendChild(aEl);
  item.appendChild(delBtn);
  
  return { item, aEl };
}

function appendChatItem(question) {
  if (!chatHistory) return null;
  
  if (chatEmpty) chatEmpty.style.display = 'none';
  chatHistory.style.display = 'block';
  chatHistory.classList.remove('placeholder');

  const { item, aEl } = createChatElement(question, '');
  
  chatHistory.appendChild(item);
  
  // Auto scroll parent to bottom
  const scrollContent = document.querySelector('.summary-scroll-content');
  if (scrollContent) {
      scrollContent.scrollTo({ top: scrollContent.scrollHeight, behavior: 'smooth' });
  }
  
  return aEl;
}

// Regenerate All Handler
regenAllBtn?.addEventListener('click', async () => {
  if (!lastExtractedText) {
    showToast(regenAllBtn, 'Load PDF first');
    return;
  }
  // Immediate regen without confirm
  promptsCache = null;
  updateSummaryPlaceholders(true);
  regenAllBtn.style.display = 'none'; // Hide while generating
  await generateSummaries();
});

// Helper to sync chat history
function saveChatHistory() {
  if (!currentPdfPath) return;
  const history = [];
  document.querySelectorAll('.chat-item').forEach(item => {
    const q = item.querySelector('.chat-q')?.textContent;
    const a = item.querySelector('.chat-a')?.innerHTML;
    if (q && a) history.push({ q, a });
  });
  const doc = DocManager.get(currentPdfPath);
  if (doc) {
    doc.chatHistory = history;
    DocManager.save(currentPdfPath, { chatHistory: history });
  }
}

function renderError(message) {
  if (!chatHistory) return;
  if (chatEmpty) chatEmpty.style.display = 'none';
  chatHistory.style.display = 'block';
  
  const item = document.createElement('div');
  item.className = 'chat-item';
  item.innerHTML = `<div class="chat-a" style="color:#ef4444; padding-left:0;">⚠️ ${message}</div>`;
  
  chatHistory.appendChild(item);
  item.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

function updateSummaryPlaceholders(hasPdf) {
  const setInfo = (el, text) => {
    if (!el) return;
    el.classList.add('info-text');
    el.classList.add('placeholder');
    el.textContent = text;
  };
  if (!hasPdf) {
    if (regenAllBtn) regenAllBtn.style.display = 'none'; // Hide if no PDF
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
    // If parsing failed but we have raw text (streaming intermediate), show raw text?
    // For keywords, raw JSON is ugly. We might show "Generating..." until done.
    if (!reply) keywordsBody.textContent = '생성 실패';
    else keywordsBody.textContent = '...'; 
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
  
  // Insert newline before emojis if missing
  // Using Unicode property escapes for emojis
  try {
    cleaned = cleaned.replace(/([^\n])\s*(?=\p{Extended_Pictographic})/gu, '$1\n');
  } catch (e) {
    // Fallback if regex fails (older browsers)
    cleaned = cleaned.replace(/([^\n])\s*(?=[🤖🧠🛠️🚀🌎🧑‍💻📈💡🧭🏁🎯🔧⚙️📌📍])/gu, '$1\n');
  }

  // Split by newline
  const lines = cleaned.split('\n').map(l => l.trim()).filter(Boolean);
  return dedupeLines(lines);
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

  // 1. Protect math expressions from marked parser
  // Use a UUID-like token that won't be touched by markdown parser
  // Avoid underscores which can be interpreted as italic/bold
  const mathExprs = [];
  const protectedMd = md.replace(/(\$\$[\s\S]+?\$\$|\$[^\$]+?\$)/g, (match) => {
    mathExprs.push(match);
    return `MathToken${mathExprs.length - 1}EndToken`;
  });

  // 2. Parse Markdown
  let html = marked.parse(protectedMd, { mangle: false, headerIds: false });

  // 3. Restore and render math
  html = html.replace(/MathToken(\d+)EndToken/g, (_, index) => {
    const expr = mathExprs[parseInt(index)];
    if (!expr) return ''; // safety check
    
    // Strip delimiters for katex
    if (expr.startsWith('$$')) {
      const content = expr.slice(2, -2);
      try {
        return katex.renderToString(content, { throwOnError: false, displayMode: true });
      } catch {
        return expr;
      }
    } else {
      const content = expr.slice(1, -1);
      try {
        return katex.renderToString(content, { throwOnError: false, displayMode: false });
      } catch {
        return expr;
      }
    }
  });

  return html;
}

// renderMath helper is no longer needed separately, but we can keep it for legacy calls or remove it.
// For now, let's keep the function definition but it won't be used by renderMarkdownToHtml anymore.
function renderMath(html) {
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

// Tooltip helpers (Portal + Pinned)
function showTooltip(chip) {
  if (!chip || !chip.dataset.desc || !tooltipPortal) return;
  
  tooltipPortal.textContent = chip.dataset.desc;
  tooltipPortal.classList.add('show');
  const rect = chip.getBoundingClientRect();
  
  // Position below the chip, centered
  let top = rect.bottom + 8;
  let left = rect.left + (rect.width / 2) - (tooltipPortal.offsetWidth / 2);
  
  // Boundary check
  if (left < 10) left = 10;
  if (left + tooltipPortal.offsetWidth > window.innerWidth - 10) {
    left = window.innerWidth - tooltipPortal.offsetWidth - 10;
  }
  
  tooltipPortal.style.top = `${top}px`;
  tooltipPortal.style.left = `${left}px`;
}

function hideTooltip() {
  if (tooltipPortal) {
    tooltipPortal.classList.remove('show');
  }
}

// Toggle active tooltip on click/hover for scrollable panel
// Using portal to escape overflow:hidden
document.addEventListener('mouseover', (e) => {
  if (pinnedChip) return; // Don't interfere if pinned
  const chip = e.target.closest('.keyword-chip');
  if (chip) showTooltip(chip);
});

document.addEventListener('mouseout', (e) => {
  if (pinnedChip) return; // Don't interfere if pinned
  const chip = e.target.closest('.keyword-chip');
  if (chip) hideTooltip();
});

document.addEventListener('click', (e) => {
  const chip = e.target.closest('.keyword-chip');
  
  // Case 1: Clicked on a chip
  if (chip) {
    e.stopPropagation(); // Prevent document click
    if (pinnedChip === chip) {
      // Toggle off
      pinnedChip = null;
      hideTooltip();
      chip.classList.remove('active');
    } else {
      // Toggle on (new pin)
      if (pinnedChip) pinnedChip.classList.remove('active');
      pinnedChip = chip;
      chip.classList.add('active');
      showTooltip(chip);
    }
    return;
  }
  
  // Case 2: Clicked outside (and not on portal itself if we want to allow selecting text in tooltip)
  if (pinnedChip && !e.target.closest('#tooltip-portal')) {
    pinnedChip.classList.remove('active');
    pinnedChip = null;
    hideTooltip();
  }
});

// Generic stream helper
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
        onError: reject
      },
      currentModel // Pass global model preference
    );
  });
}

async function generateSummaries() {
  if (!pdfDoc) return;
  try {
    const prompts = await loadPrompts();
    // Increase limit to capture full content (approx 100 pages or 300k chars)
    const text = await extractPdfText(pdfDoc, 100, 300000);
    if (!text) return;
    lastExtractedText = text;
    
    // Debug: save extracted text
    // window.sunshadeAPI.saveDebugText(text).catch(err => console.warn('Debug save failed', err));

    // Mark as analyzing
    DocManager.save(currentPdfPath, { 
      name: pdfFileInput.files?.[0]?.name || currentPdfPath.split(/[/\\]/).pop(), 
      isAnalyzing: true 
    });

    const tasks = [];

    // keywords
    if (keywordsBody) {
      keywordsBody.textContent = '생성 중...';
      // keywordsBody.classList.remove('placeholder'); // Keep placeholder style initially
      
      let rawAcc = '';
      const systemPrompt = prompts.system || 'You are Sunshade.';
      const taskPrompt = prompts.sections?.keywords || 'Extract keywords.';
      
      tasks.push(runStreamTask(
        [
          { role: 'user', content: `${taskPrompt}\n\n${text}` }
        ],
        `${systemPrompt}\n\n${taskPrompt}`, // Combine system + task prompt for instructions
        (chunk) => {
          if (rawAcc === '') keywordsBody.classList.remove('placeholder'); // Remove on first chunk
          rawAcc += chunk;
        },
        () => {
          lastKeywordsRaw = rawAcc;
          renderKeywords(lastKeywordsRaw);
        }
      ).catch(err => {
         keywordsBody.textContent = '오류 발생';
         console.error(err);
      }));
    }

  // 3줄 요약
  if (briefList) {
    briefList.innerHTML = '<li>생성 중...</li>';
    // briefList.classList.remove('placeholder'); // Keep placeholder style
    
    let rawAcc = '';
    const systemPrompt = prompts.system || 'You are Sunshade.';
    const taskPrompt = prompts.sections?.brief || 'Give 3 bullet sentences.';

    tasks.push(runStreamTask(
      [
        { role: 'user', content: `${taskPrompt}\n\n${text}` }
      ],
      `${systemPrompt}\n\n${taskPrompt}`, // Combine system + task prompt
      (chunk) => {
        if (rawAcc === '') briefList.classList.remove('placeholder'); // Remove on first chunk
        rawAcc += chunk;
        // Try parsing lines on the fly?
        const lines = parseBriefLines(rawAcc).slice(0, 3);
        if (lines.length > 0) {
           briefList.innerHTML = '';
           lines.forEach(line => {
             const li = document.createElement('li');
             li.textContent = normalizeLine(line.replace(/^\d+[\).\s-]*/, ''));
             briefList.appendChild(li);
           });
        }
      },
      () => {
        lastBriefRaw = rawAcc;
        // Final polish
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
    ).catch(err => console.error(err)));
  }

    // 요약
    if (summaryBody) {
      summaryBody.textContent = '생성 중...';
      // summaryBody.classList.remove('placeholder'); // Keep placeholder style
      summaryBody.classList.remove('info-text');
      
      let rawAcc = '';
      let isFirst = true;
      const systemPrompt = prompts.system || 'You are Sunshade.';
      const taskPrompt = prompts.sections?.summary || 'Summarize.';

      tasks.push(runStreamTask(
        [
          { role: 'user', content: `${taskPrompt}\n\n${text}` }
        ],
        `${systemPrompt}\n\n${taskPrompt}`, // Combine system + task prompt
        (chunk) => {
          if (isFirst) {
            summaryBody.innerHTML = '';
            summaryBody.classList.remove('placeholder'); // Remove on first chunk
            isFirst = false;
          }
          rawAcc += chunk;
          summaryBody.innerHTML = renderMarkdownToHtml(rawAcc);
        },
        () => {
          lastSummaryRaw = dedupeSummary(rawAcc);
          summaryBody.innerHTML = renderMarkdownToHtml(lastSummaryRaw || '생성 실패');
        }
      ).catch(err => {
         summaryBody.textContent = '오류 발생';
         console.error(err);
      }));
    }
    
    // Save when all done
    Promise.allSettled(tasks).then(() => {
      DocManager.save(currentPdfPath, {
        extractedText: text,
        isAnalyzing: false,
        analysis: {
          keywords: lastKeywordsRaw,
          brief: lastBriefRaw,
          summary: lastSummaryRaw
        }
      });
      console.log('Analysis saved to history');
      if (regenAllBtn) regenAllBtn.style.display = 'flex'; // Show regen button
    });

  } catch (err) {
    console.error('generateSummaries error', err);
    setAlert(`요약 생성 실패: ${err.message}`, 'error');
    DocManager.save(currentPdfPath, { isAnalyzing: false }); // Stop loading
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

// Load Outline
async function loadOutline(doc) {
  if (!outlineView) return;
  outlineView.textContent = '목차 불러오는 중...';
  try {
    const outline = await doc.getOutline();
    if (!outline || outline.length === 0) {
      outlineView.textContent = '목차 정보가 없습니다.';
      return;
    }
    outlineView.innerHTML = '';
    outlineView.style.textAlign = 'left';
    outlineView.style.paddingTop = '0';
    
    // Render tree first
    renderOutlineTree(outline, outlineView);
    
    // Resolve page numbers in background for highlighting
    resolveOutlinePages(outline);
  } catch (err) {
    console.error('Outline load error:', err);
    outlineView.textContent = '목차를 불러올 수 없습니다.';
  }
}

// Map to store page number -> DOM elements
const outlinePageMap = new Map();

async function resolveOutlinePages(items) {
  // Flatten items to process
  const queue = [...items];
  while (queue.length > 0) {
    const item = queue.shift();
    if (item.items && item.items.length > 0) {
      queue.push(...item.items);
    }
    
    if (item.dest) {
      try {
        let dest = item.dest;
        if (typeof dest === 'string') {
          dest = await pdfDoc.getDestination(dest);
        }
        if (Array.isArray(dest)) {
          const ref = dest[0];
          const pageIndex = await pdfDoc.getPageIndex(ref);
          const pageNum = pageIndex + 1;
          
          // Store in map
          if (!outlinePageMap.has(pageNum)) {
            outlinePageMap.set(pageNum, []);
          }
          if (item._dom) {
            outlinePageMap.get(pageNum).push(item._dom);
          }
        }
      } catch (e) {
        // ignore resolve errors
      }
    }
  }
}

function updateOutlineHighlight(pageNum) {
  // Remove previous active
  document.querySelectorAll('.outline-item.active').forEach(el => el.classList.remove('active'));
  
  // Find range match
  // Look for the outline item with the largest page number <= current pageNum
  const pages = Array.from(outlinePageMap.keys()).sort((a, b) => a - b);
  let targetPage = -1;
  
  for (const p of pages) {
    if (p <= pageNum) {
      targetPage = p;
    } else {
      break; // pages are sorted, so we can stop early
    }
  }
  
  if (targetPage !== -1) {
    const items = outlinePageMap.get(targetPage);
    if (items && items.length > 0) {
      items.forEach(el => {
        el.classList.add('active');
        // Only scroll if it's a new section start (optional optimization)
        if (targetPage === pageNum) {
           el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      });
    }
  }
}

function renderOutlineTree(items, container) {
  const ul = document.createElement('div');
  ul.style.display = 'flex';
  ul.style.flexDirection = 'column';
  ul.style.gap = '2px'; // Spacing between items
  
  items.forEach(item => {
    const div = document.createElement('div');
    
    // Item row
    const row = document.createElement('div');
    row.className = 'outline-item';
    row.title = item.title;
    
    // Store DOM reference for highlighting
    item._dom = row;
    
    // Toggle icon
    const hasChildren = item.items && item.items.length > 0;
    const toggle = document.createElement('span');
    toggle.className = 'outline-toggle';
    // Chevron Right SVG
    toggle.innerHTML = hasChildren 
      ? `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>`
      : ''; 
    // If no children, keep toggle space but empty to align
    if (!hasChildren) toggle.style.visibility = 'hidden';
    
    row.appendChild(toggle);
    
    // File/Section Icon
    // const icon = document.createElement('span');
    // icon.className = 'outline-icon';
    // icon.innerHTML = '📄'; // or SVG
    // row.appendChild(icon);
    
    const text = document.createElement('span');
    text.textContent = item.title;
    text.style.whiteSpace = 'nowrap';
    text.style.overflow = 'hidden';
    text.style.textOverflow = 'ellipsis';
    text.style.flex = '1';
    row.appendChild(text);
    
    // Click to navigate (text only, or whole row?)
    // Let's make whole row clickable except toggle
    row.addEventListener('click', (e) => {
      if (e.target.closest('.outline-toggle')) return; // handled by toggle
      if (item.dest) {
        pdfLinkService.goToDestination(item.dest);
      }
    });
    
    div.appendChild(row);
    
    // Children
    if (hasChildren) {
      const childContainer = document.createElement('div');
      childContainer.className = 'outline-children expanded'; // Default expanded
      renderOutlineTree(item.items, childContainer);
      div.appendChild(childContainer);
      
      // Default rotated
      toggle.classList.add('rotated');
      
      // Toggle logic
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const expanded = childContainer.classList.toggle('expanded');
        toggle.classList.toggle('rotated', expanded);
      });
    }
    
    ul.appendChild(div);
  });
  
  container.appendChild(ul);
}

function showToast(target, message) {
  const toast = document.createElement('div');
  toast.className = 'floating-toast';
  toast.textContent = message;
  document.body.appendChild(toast);

  let rect;
  if (target && typeof target.getBoundingClientRect === 'function') {
    rect = target.getBoundingClientRect();
  } else if (target && typeof target.left === 'number') {
    rect = target; // Use passed coordinates
  } else {
    // Fallback to center
    rect = { left: window.innerWidth / 2, width: 0, bottom: window.innerHeight / 2 };
  }

  toast.style.left = `${rect.left + rect.width / 2}px`;
  toast.style.top = `${rect.bottom + 8}px`;
  toast.style.transform = 'translate(-50%, 4px)';

  // Trigger reflow
  void toast.offsetWidth;
  toast.classList.add('show');
  toast.style.transform = 'translate(-50%, 0)';

  setTimeout(() => {
    toast.classList.remove('show');
    toast.style.transform = 'translate(-50%, 4px)';
    setTimeout(() => toast.remove(), 200);
  }, 1500);
}

// Tab switching logic
document.querySelectorAll('.nav-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    // Remove active class from all tabs
    document.querySelectorAll('.nav-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    
    // Add active to clicked tab
    btn.classList.add('active');
    const tabId = `tab-${btn.dataset.tab}`;
    const content = document.getElementById(tabId);
    if (content) content.classList.add('active');
  });
});

// Tab switching logic
document.querySelectorAll('.nav-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    // Remove active class from all tabs
    document.querySelectorAll('.nav-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    
    // Add active to clicked tab
    btn.classList.add('active');
    const tabId = `tab-${btn.dataset.tab}`;
    const content = document.getElementById(tabId);
    if (content) content.classList.add('active');
  });
});

// Section action handlers (settings / copy / regenerate)
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.section-btn');
  if (!btn) return;
  const section = btn.dataset.section;
  const action = btn.dataset.action;
  if (!section || !action) return;

  if (action === 'settings') {
    window.sunshadeAPI.openSettings();
    return;
  }

  if (action === 'copy') {
    let text = '';
    if (section === 'keywords') text = formatKeywordsForCopy(lastKeywordsRaw);
    if (section === 'brief') text = formatBriefForCopy();
    if (section === 'summary') text = lastSummaryRaw;
    if (section === 'chat') {
        // Copy entire chat history
        const history = [];
        document.querySelectorAll('.chat-item').forEach(item => {
            const q = item.querySelector('.chat-q')?.textContent;
            const a = item.querySelector('.chat-a')?.textContent;
            if (q && a) history.push(`Q: ${q}\nA: ${a}`);
        });
        text = history.join('\n\n');
    }
    if (!text) {
      showToast(btn, 'Nothing to copy');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      showToast(btn, 'Copied!');
    } catch (err) {
      showToast(btn, `Copy failed!: ${err.message}`);
    }
    return;
  }

  if (action === 'regen' || action === 'clear') {
    if (section === 'chat' && action === 'clear') {
        if (chatHistory) chatHistory.innerHTML = '';
        if (chatEmpty) chatEmpty.style.display = 'block';
        saveChatHistory(); // Sync clear
        showToast(btn, 'Cleared');
        return;
    }
    if (!lastExtractedText) {
      showToast(btn, 'Load PDF first');
      return;
    }
    try {
      promptsCache = null; // Force reload prompts
      const prompts = await loadPrompts();
      if (section === 'keywords') {
        keywordsBody.textContent = '다시 생성 중...';
        let rawAcc = '';
        runStreamTask(
          [
            { role: 'system', content: prompts.system || 'You are Sunshade.' },
            { role: 'user', content: `${prompts.sections?.keywords || 'Extract keywords.'}\n\n${lastExtractedText}` }
          ],
          prompts.sections?.keywords,
          (chunk) => { rawAcc += chunk; },
          () => {
            lastKeywordsRaw = rawAcc;
            renderKeywords(lastKeywordsRaw);
            // Update cache
            const doc = DocManager.get(currentPdfPath);
            if (doc) {
                doc.analysis.keywords = lastKeywordsRaw;
                DocManager.save(currentPdfPath, { analysis: doc.analysis });
            }
          }
        );
      } else if (section === 'brief') {
        briefList.innerHTML = '<li>다시 생성 중...</li>';
        let rawAcc = '';
        runStreamTask(
          [
            { role: 'system', content: prompts.system || 'You are Sunshade.' },
            { role: 'user', content: `${prompts.sections?.brief || 'Give 3 bullet sentences.'}\n\n${lastExtractedText}` }
          ],
          prompts.sections?.brief,
          (chunk) => {
             rawAcc += chunk;
             const lines = parseBriefLines(rawAcc).slice(0, 3);
             if (lines.length > 0) {
               briefList.innerHTML = '';
               lines.forEach(line => {
                 const li = document.createElement('li');
                 li.textContent = normalizeLine(line.replace(/^\d+[\).\s-]*/, ''));
                 briefList.appendChild(li);
               });
             }
          },
          () => {
            lastBriefRaw = rawAcc;
             const lines = parseBriefLines(lastBriefRaw).slice(0, 3);
             lastBriefLines = lines;
             // Update cache
             const doc = DocManager.get(currentPdfPath);
             if (doc) {
                 doc.analysis.brief = lastBriefRaw;
                 DocManager.save(currentPdfPath, { analysis: doc.analysis });
             }
          }
        );
      } else if (section === 'summary') {
        summaryBody.textContent = '다시 생성 중...';
        let rawAcc = '';
        let isFirst = true;
        runStreamTask(
          [
            { role: 'system', content: prompts.system || 'You are Sunshade.' },
            { role: 'user', content: `${prompts.sections?.summary || 'Summarize.'}\n\n${lastExtractedText}` }
          ],
          prompts.sections?.summary,
          (chunk) => {
            if (isFirst) { summaryBody.innerHTML = ''; isFirst = false; }
            rawAcc += chunk;
            summaryBody.innerHTML = renderMarkdownToHtml(rawAcc);
          },
          () => {
            lastSummaryRaw = dedupeSummary(rawAcc);
            summaryBody.innerHTML = renderMarkdownToHtml(lastSummaryRaw);
            // Update cache
            const doc = DocManager.get(currentPdfPath);
            if (doc) {
                doc.analysis.summary = lastSummaryRaw;
                DocManager.save(currentPdfPath, { analysis: doc.analysis });
            }
          }
        );
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
updateSummaryPlaceholders(false); // Init placeholders

// Sidebar render helpers
function renderSidebar() {
  renderHistoryList();
  renderFavoriteList();
  updateTabCounts();
  updateFavoriteButtonState();
}

function updateFavoriteButtonState() {
  const btn = document.querySelector('#tab-favorite .tab-action-btn');
  if (!btn) return;
  
  let isFav = false;
  if (currentPdfPath) {
    const doc = DocManager.get(currentPdfPath);
    if (doc && doc.isFavorite) isFav = true;
  }
  
  if (isFav) {
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>`;
    btn.title = '즐겨찾기 해제';
  } else {
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`;
    btn.title = '추가';
  }
}

function renderHistoryList() {
  const historyView = document.getElementById('tab-history');
  if (!historyView) return;
  
  const info = historyView.querySelector('.info-text');
  const existingList = historyView.querySelector('.side-nav-list');
  if (existingList) existingList.remove();
  
  const list = DocManager.getList('all');
  if (list.length === 0) {
    if (info) info.style.display = 'block';
    return;
  }
  
  if (info) info.style.display = 'none';
  
  const ul = document.createElement('ul');
  ul.className = 'side-nav-list';
  ul.style.marginTop = '0';
  
  list.forEach(doc => {
    const li = document.createElement('li');
    li.title = doc.path;
    
    // Name
    const name = document.createElement('span');
    name.textContent = doc.name;
    name.style.flex = '1';
    name.style.overflow = 'hidden';
    name.style.textOverflow = 'ellipsis';
    name.style.whiteSpace = 'nowrap';
    
    // Actions container
    const actions = document.createElement('div');
    actions.className = 'item-action';
    actions.style.display = 'flex';
    actions.style.alignItems = 'center';
    actions.style.gap = '4px';
    
    // Favorite btn
    const favBtn = document.createElement('img');
    favBtn.src = doc.isFavorite ? '../src/images/favorite-2.png' : '../src/images/favorite.png';
    favBtn.width = 14;
    favBtn.height = 14;
    favBtn.style.cursor = 'pointer';
    favBtn.style.opacity = '0.6';
    favBtn.title = '즐겨찾기 토글';
    
    favBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      DocManager.toggleFavorite(doc.path);
    });
    
    // Delete btn (Trash icon)
    const delBtn = document.createElement('img');
    delBtn.src = '../src/images/recycle-bin.png';
    delBtn.width = 14;
    delBtn.height = 14;
    delBtn.style.opacity = '0.6';
    delBtn.style.cursor = 'pointer';
    delBtn.title = '삭제';
    
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm('삭제하시겠습니까?')) {
        DocManager.delete(doc.path);
      }
    });
    
    actions.appendChild(favBtn);
    actions.appendChild(delBtn);
    
    li.appendChild(name);
    li.appendChild(actions);
    
    // Highlight current
    if (currentPdfPath && doc.path === currentPdfPath) {
        li.classList.add('active');
    }
    
    li.addEventListener('click', () => {
      loadPdf(doc.path);
    });
    
    ul.appendChild(li);
  });
  
  historyView.appendChild(ul);
}

function renderFavoriteList() {
  const favView = document.getElementById('tab-favorite');
  if (!favView) return;
  
  const info = favView.querySelector('.info-text');
  const existingList = favView.querySelector('.side-nav-list');
  if (existingList) existingList.remove();
  
  const list = DocManager.getList('favorite');
  if (list.length === 0) {
    if (info) info.style.display = 'block';
    return;
  }
  
  if (info) info.style.display = 'none';
  
  const ul = document.createElement('ul');
  ul.className = 'side-nav-list';
  ul.style.marginTop = '0';
  
  list.forEach(doc => {
    const li = document.createElement('li');
    li.title = doc.path;
    
    const name = document.createElement('span');
    name.textContent = doc.name;
    name.style.flex = '1';
    name.style.overflow = 'hidden';
    name.style.textOverflow = 'ellipsis';
    name.style.whiteSpace = 'nowrap';
    
    // Actions container
    const actions = document.createElement('div');
    actions.className = 'item-action';
    actions.style.display = 'flex';
    actions.style.alignItems = 'center';
    actions.style.gap = '4px';
    
    // Favorite btn (Always active)
    const favBtn = document.createElement('img');
    favBtn.src = '../src/images/favorite-2.png';
    favBtn.width = 14;
    favBtn.height = 14;
    favBtn.style.cursor = 'pointer';
    favBtn.style.opacity = '0.8';
    favBtn.title = '즐겨찾기 해제';
    
    favBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      DocManager.toggleFavorite(doc.path);
    });
    
    actions.appendChild(favBtn);
    
    li.appendChild(name);
    li.appendChild(actions);
    
    // Highlight current
    if (currentPdfPath && doc.path === currentPdfPath) {
        li.classList.add('active');
    }
    
    li.addEventListener('click', () => {
      loadPdf(doc.path);
    });
    
    ul.appendChild(li);
  });
  
  favView.appendChild(ul);
}

function updateTabCounts() {
  const histCount = document.getElementById('hist-count');
  const favCount = document.getElementById('fav-count');
  
  if (histCount) {
    const total = DocManager.getList('all').length;
    histCount.textContent = `${total}개`;
  }
  
  if (favCount) {
    const total = DocManager.getList('favorite').length;
    favCount.textContent = `${total}개`;
  }
}

window.addEventListener('doc-update', () => {
  renderSidebar();
});

renderSidebar();

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.tab-action-btn');
  if (!btn) return;
  
  if (btn.title === '전체 삭제') {
    if (confirm('히스토리를 전체 삭제하시겠습니까? (즐겨찾기는 유지됩니다)')) {
      DocManager.clearHistory();
    }
    return;
  }
  
  if (btn.title === '추가') {
    if (!currentPdfPath) {
      showToast(btn, 'PDF를 먼저 열어주세요');
      return;
    }
    const isFav = DocManager.toggleFavorite(currentPdfPath);
    // showToast(btn, isFav ? '즐겨찾기 추가됨' : '즐겨찾기 해제됨'); // Toast handled by toggle logic? No.
    // Update button state immediately
    updateFavoriteButtonState();
    return;
  }
});
