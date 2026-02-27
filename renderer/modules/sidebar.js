import { state } from "./config.js";
import { DocManager } from "./docManager.js";
import { showToast } from "./uiHelpers.js";
import { renderMarkdownToHtml, formatBriefForCopy, formatKeywordsForCopy } from "./textProcessors.js";

let loadPdfCallback = null;
let regenAllCallback = null;

function setCallbacks(loadPdfFn, regenAllFn) {
  loadPdfCallback = loadPdfFn;
  regenAllCallback = regenAllFn;
}

function renderSidebar() {
  renderHistoryList();
  renderFavoriteList();
  updateTabCounts();
  updateFavoriteButtonState();
}

function updateFavoriteButtonState() {
  const btn = document.querySelector("#tab-favorite .tab-action-btn");
  if (!btn) return;

  let isFav = false;
  if (state.currentPdfPath) {
    const doc = DocManager.get(state.currentPdfPath);
    if (doc && doc.isFavorite) isFav = true;
  }

  if (isFav) {
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>`;
    btn.title = "즐겨찾기 해제";
  } else {
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`;
    btn.title = "추가";
  }
}

function renderHistoryList() {
  const historyView = document.getElementById("tab-history");
  if (!historyView) return;

  const info = historyView.querySelector(".info-text");
  const existingList = historyView.querySelector(".side-nav-list");
  if (existingList) existingList.remove();

  const list = DocManager.getList("all");
  if (list.length === 0) {
    if (info) info.style.display = "block";
    return;
  }

  if (info) info.style.display = "none";

  const ul = document.createElement("ul");
  ul.className = "side-nav-list";
  ul.style.marginTop = "0";

  let draggedItem = null;

  list.forEach((doc) => {
    const li = createSidebarListItem(doc, draggedItem, ul, false);
    ul.appendChild(li);
  });

  historyView.appendChild(ul);
}

function renderFavoriteList() {
  const favView = document.getElementById("tab-favorite");
  if (!favView) return;

  const info = favView.querySelector(".info-text");
  const existingList = favView.querySelector(".side-nav-list");
  if (existingList) existingList.remove();

  const list = DocManager.getList("favorite");
  if (list.length === 0) {
    if (info) info.style.display = "block";
    return;
  }

  if (info) info.style.display = "none";

  const ul = document.createElement("ul");
  ul.className = "side-nav-list";
  ul.style.marginTop = "0";

  let draggedItem = null;

  list.forEach((doc) => {
    const li = createSidebarListItem(doc, draggedItem, ul, true);
    ul.appendChild(li);
  });

  favView.appendChild(ul);
}

function createSidebarListItem(doc, draggedItem, ul, isFavorite) {
  const li = document.createElement("li");
  li.title = doc.path;
  li.dataset.path = doc.path;
  li.draggable = true;

  li.addEventListener("dragstart", (e) => {
    draggedItem = li;
    li.style.opacity = "0.5";
    e.dataTransfer.effectAllowed = "move";
  });

  li.addEventListener("dragend", () => {
    draggedItem = null;
    li.style.opacity = "1";
    document.querySelectorAll(".side-nav-list li").forEach((el) => {
      el.classList.remove("drop-above", "drop-below");
    });
  });

  li.addEventListener("dragover", (e) => {
    e.preventDefault();
    if (!draggedItem || draggedItem === li) return;

    const bounding = li.getBoundingClientRect();
    const offset = bounding.y + bounding.height / 2;

    document.querySelectorAll(".side-nav-list li").forEach(el => {
      if (el !== li) {
        el.classList.remove("drop-above", "drop-below");
      }
    });

    if (e.clientY - offset > 0) {
      li.classList.remove("drop-above");
      li.classList.add("drop-below");
    } else {
      li.classList.add("drop-above");
      li.classList.remove("drop-below");
    }
  });

  li.addEventListener("dragleave", () => {
    li.classList.remove("drop-above", "drop-below");
  });

  li.addEventListener("drop", (e) => {
    e.preventDefault();
    li.classList.remove("drop-above", "drop-below");
    if (!draggedItem || draggedItem === li) return;

    const bounding = li.getBoundingClientRect();
    const offset = bounding.y + bounding.height / 2;

    if (e.clientY - offset > 0) {
      li.after(draggedItem);
    } else {
      li.before(draggedItem);
    }

    const newOrderPaths = Array.from(ul.children).map(child => child.dataset.path);
    setTimeout(() => DocManager.updateOrders(newOrderPaths), 0);
  });

  const name = document.createElement("span");
  name.textContent = doc.name.replace(/\.pdf$/i, "");
  name.style.flex = "1";
  name.style.overflow = "hidden";
  name.style.textOverflow = "ellipsis";
  name.style.whiteSpace = "nowrap";

  const actions = document.createElement("div");
  actions.className = "item-action";
  actions.style.display = "flex";
  actions.style.alignItems = "center";
  actions.style.gap = "4px";

  const favBtn = document.createElement("img");
  favBtn.src = doc.isFavorite
    ? "../src/images/favorite-2.png"
    : "../src/images/favorite.png";
  favBtn.width = 14;
  favBtn.height = 14;
  favBtn.style.cursor = "pointer";
  favBtn.style.opacity = isFavorite ? "0.8" : "0.6";
  favBtn.title = "즐겨찾기 토글";

  favBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    DocManager.toggleFavorite(doc.path);
  });

  actions.appendChild(favBtn);

  if (!isFavorite) {
    const delBtn = document.createElement("img");
    delBtn.src = "../src/images/recycle-bin.png";
    delBtn.width = 14;
    delBtn.height = 14;
    delBtn.style.opacity = "0.6";
    delBtn.style.cursor = "pointer";
    delBtn.title = "삭제";

    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (confirm("삭제하시겠습니까?")) {
        DocManager.delete(doc.path);
      }
    });

    actions.appendChild(delBtn);
  }

  li.appendChild(name);
  li.appendChild(actions);

  if (state.currentPdfPath && doc.path === state.currentPdfPath) {
    li.classList.add("active");
  }

  li.addEventListener("click", () => {
    if (loadPdfCallback) loadPdfCallback(doc.path);
  });

  return li;
}

function updateTabCounts() {
  const histCount = document.getElementById("hist-count");
  const favCount = document.getElementById("fav-count");

  if (histCount) {
    const total = DocManager.getList("all").length;
    histCount.textContent = `${total}개`;
  }

  if (favCount) {
    const total = DocManager.getList("favorite").length;
    favCount.textContent = `${total}개`;
  }
}

function setupTabSwitching() {
  document.querySelectorAll(".nav-tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".nav-tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));

      btn.classList.add("active");
      const tabId = `tab-${btn.dataset.tab}`;
      const content = document.getElementById(tabId);
      if (content) content.classList.add("active");
    });
  });
}

function setupSectionActions() {
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest(".section-btn");
    if (!btn) return;
    const section = btn.dataset.section;
    const action = btn.dataset.action;
    if (!section || !action) return;

    if (action === "settings") {
      window.sunshadeAPI.openSettings();
      return;
    }

    if (action === "copy") {
      let text = "";
      if (section === "keywords") text = formatKeywordsForCopy(state.lastKeywordsRaw, state.lastKeywordsList);
      if (section === "brief") text = formatBriefForCopy(state.lastBriefLines, state.lastBriefRaw);
      if (section === "summary") text = state.lastSummaryRaw;
      if (section === "chat") {
        const history = [];
        document.querySelectorAll(".chat-item").forEach((item) => {
          const q = item.querySelector(".chat-q")?.textContent;
          const aEl = item.querySelector(".chat-a");
          const a = aEl?.dataset?.raw || aEl?.textContent;
          if (q && a) history.push(`Q: ${q}\nA: ${a}`);
        });
        text = history.join("\n\n");
      }
      if (!text) {
        showToast(btn, "Nothing to copy");
        return;
      }
      try {
        await navigator.clipboard.writeText(text);
        showToast(btn, "Copied!");
      } catch (err) {
        showToast(btn, `Copy failed!: ${err.message}`);
      }
      return;
    }

    if (action === "regen" || action === "clear") {
      if (section === "chat" && action === "clear") {
        const chatHistory = document.getElementById("chat-history");
        const chatEmpty = document.getElementById("chat-empty");
        if (chatHistory) chatHistory.innerHTML = "";
        if (chatEmpty) chatEmpty.style.display = "block";
        return;
      }
      if (!state.lastExtractedText) {
        showToast(btn, "Load PDF first");
        return;
      }
      if (regenAllCallback) regenAllCallback(section, btn);
    }
  });

  document.addEventListener("click", async (e) => {
    const btn = e.target.closest(".tab-action-btn");
    if (!btn) return;

    if (btn.title === "전체 삭제") {
      if (confirm("히스토리를 전체 삭제하시겠습니까? (즐겨찾기는 유지됩니다)")) {
        DocManager.clearHistory();
      }
      return;
    }

    if (btn.title === "추가") {
      if (!state.currentPdfPath) {
        showToast(btn, "PDF를 먼저 열어주세요");
        return;
      }
      const isFav = await DocManager.toggleFavorite(state.currentPdfPath);
      updateFavoriteButtonState();
      return;
    }
  });
}

export { setCallbacks, renderSidebar, updateFavoriteButtonState, renderHistoryList, renderFavoriteList, updateTabCounts, setupTabSwitching, setupSectionActions };
