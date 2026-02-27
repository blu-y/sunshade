import { state, uiRefs } from "./config.js";
import { DocManager } from "./docManager.js";
import { setAlert, showToast } from "./uiHelpers.js";
import { renderMarkdownToHtml } from "./textProcessors.js";

function createChatElement(question, answer = "") {
  const item = document.createElement("div");
  item.className = "chat-item";
  item.style.position = "relative";

  const qEl = document.createElement("div");
  qEl.className = "chat-q";
  qEl.textContent = question;

  const aEl = document.createElement("div");
  aEl.className = "chat-a";

  const isHtml = answer.includes("<p>") || answer.includes("<span class=\"katex");
  aEl.innerHTML = isHtml ? answer : renderMarkdownToHtml(answer);
  aEl.dataset.raw = answer;

  const delBtn = document.createElement("img");
  delBtn.src = "../src/images/recycle-bin.png";
  delBtn.className = "chat-del-btn";
  delBtn.style.position = "absolute";
  delBtn.style.top = "10px";
  delBtn.style.right = "10px";
  delBtn.style.width = "14px";
  delBtn.style.height = "14px";
  delBtn.style.cursor = "pointer";
  delBtn.style.opacity = "0";
  delBtn.style.transition = "opacity 0.2s";
  delBtn.title = "이 대화 삭제";

  item.addEventListener("mouseenter", () => (delBtn.style.opacity = "0.5"));
  item.addEventListener("mouseleave", () => (delBtn.style.opacity = "0"));
  delBtn.addEventListener("mouseenter", () => (delBtn.style.opacity = "1"));

  delBtn.addEventListener("click", () => {
    const rect = delBtn.getBoundingClientRect();

    item.remove();
    saveChatHistory();

    const historyContainer = document.getElementById("chat-history");
    const emptyContainer = document.getElementById("chat-empty");
    if (historyContainer && historyContainer.children.length === 0) {
      if (emptyContainer) emptyContainer.style.display = "block";
    }

    const clearBtn = document.querySelector(
      '#card-chat .section-btn[data-action="clear"]',
    );
    showToast(clearBtn || document.body, "Deleted");
  });

  item.appendChild(qEl);
  item.appendChild(aEl);
  item.appendChild(delBtn);

  return { item, aEl };
}

function appendChatItem(question) {
  if (!uiRefs.chatHistory) return null;

  if (uiRefs.chatEmpty) uiRefs.chatEmpty.style.display = "none";
  uiRefs.chatHistory.style.display = "block";
  uiRefs.chatHistory.classList.remove("placeholder");

  const { item, aEl } = createChatElement(question, "");

  uiRefs.chatHistory.appendChild(item);

  const scrollContent = document.querySelector(".summary-scroll-content");
  if (scrollContent) {
    scrollContent.scrollTo({
      top: scrollContent.scrollHeight,
      behavior: "smooth",
    });
  }

  return aEl;
}

function saveChatHistory() {
  if (!state.currentPdfPath) return;
  const history = [];
  document.querySelectorAll(".chat-item").forEach((item) => {
    const q = item.querySelector(".chat-q")?.textContent;
    const aEl = item.querySelector(".chat-a");
    const a = aEl?.dataset?.raw || aEl?.innerHTML;
    if (q && a) history.push({ q, a });
  });
  const doc = DocManager.get(state.currentPdfPath);
  if (doc) {
    DocManager.save(state.currentPdfPath, { chatHistory: history });
  }
}

function renderError(message) {
  if (!uiRefs.chatHistory) return;
  if (uiRefs.chatEmpty) uiRefs.chatEmpty.style.display = "none";
  uiRefs.chatHistory.style.display = "block";

  const item = document.createElement("div");
  item.className = "chat-item";
  item.innerHTML = `<div class="chat-a" style="color:#ef4444; padding-left:0;">⚠️ ${message}</div>`;

  uiRefs.chatHistory.appendChild(item);
  item.scrollIntoView({ behavior: "smooth", block: "end" });
}

async function runChat(question) {
  if (!uiRefs.askBtn) return;
  uiRefs.askBtn.disabled = true;
  setAlert("응답 생성 중...", "info");

  const answerBody = appendChatItem(question);
  let accumulated = "";

  if (uiRefs.askInput) {
    uiRefs.askInput.value = "";
    uiRefs.askInput.style.height = "auto";
  }

  let finalQuestion = question;
  if (state.lastExtractedText && state.lastExtractedText.length > 50) {
    finalQuestion = `Reference Document:\n${state.lastExtractedText}\n\nQuestion: ${question}`;
  }

  try {
    await new Promise((resolve, reject) => {
      window.sunshadeAPI.openaiStream(
        [{ role: "user", content: finalQuestion }],
        undefined,
        {
          onChunk: (chunk) => {
            accumulated += chunk;
            answerBody.innerHTML = renderMarkdownToHtml(accumulated);
            answerBody.dataset.raw = accumulated;
            const scrollContent = document.querySelector(
              ".summary-scroll-content",
            );
            if (scrollContent) {
              scrollContent.scrollTop = scrollContent.scrollHeight;
            }
          },
          onDone: () => resolve(),
          onError: (err) => reject(err),
        },
        state.currentModel,
      );
    });
    setAlert(null);

    if (state.currentPdfPath) {
      const history = [];
      document.querySelectorAll(".chat-item").forEach((item) => {
        const q = item.querySelector(".chat-q")?.textContent;
        const aEl = item.querySelector(".chat-a");
        const a = aEl?.dataset?.raw || aEl?.innerHTML;
        if (q && a) history.push({ q, a });
      });
      DocManager.save(state.currentPdfPath, { chatHistory: history });
    }
  } catch (err) {
    const msg = err?.message || "알 수 없는 오류";
    const quota = msg.includes("insufficient_quota") || msg.includes("429");
    const friendly = quota
      ? "Codex 사용 한도를 초과했거나 계정 상태를 확인해야 합니다."
      : `OpenAI 요청 실패: ${msg}`;
    setAlert(friendly, "error");
    renderError(friendly);
    throw err;
  } finally {
    uiRefs.askBtn.disabled = false;
  }
}

function setupChatInputHandlers() {
  uiRefs.askBtn?.addEventListener("click", () => {
    const q = uiRefs.askInput?.value.trim();
    if (!q) return;
    runChat(q).catch((err) => setAlert(`Chat error: ${err.message}`, "error"));
  });

  uiRefs.askInput?.addEventListener("input", () => {
    uiRefs.askInput.style.height = "auto";
    uiRefs.askInput.style.height = Math.min(uiRefs.askInput.scrollHeight, 200) + "px";
  });

  uiRefs.askInput?.addEventListener("keydown", (e) => {
    if (e.isComposing) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      uiRefs.askBtn.click();
    }
  });
}

export { createChatElement, appendChatItem, saveChatHistory, renderError, runChat, setupChatInputHandlers };
