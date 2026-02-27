import { state, uiRefs } from "./config.js";

function setAlert(message, level = "info") {
  if (!uiRefs.alertPill) return;
  if (!message) {
    uiRefs.alertPill.style.display = "none";
    uiRefs.alertPill.removeAttribute("data-tooltip");
    uiRefs.alertPill.classList.remove("has-tooltip", "error", "warn");
    return;
  }
  uiRefs.alertPill.style.display = "inline-flex";
  uiRefs.alertPill.dataset.tooltip = message;
  uiRefs.alertPill.classList.add("has-tooltip");
  uiRefs.alertPill.classList.remove("error", "warn");
  if (level === "error") uiRefs.alertPill.classList.add("error");
  if (level === "warn") uiRefs.alertPill.classList.add("warn");
  const dot = uiRefs.alertPill.querySelector(".alert-dot");
  const text = document.getElementById("alert-text");
  if (dot) {
    if (level === "error") dot.style.background = "#ef4444";
    else if (level === "warn") dot.style.background = "#f59e0b";
    else dot.style.background = "#22c55e";
  }
  if (text)
    text.textContent =
      level === "error" ? "Error" : level === "warn" ? "Warn" : "Info";
}

function logMessage(message, level = "info") {
  if (level === "error") {
    setAlert(message, "error");
    console.error(message);
  } else if (level === "warn") {
    setAlert(message, "warn");
    console.warn(message);
  } else {
    console.log(message);
  }
}

function showTooltip(chip) {
  if (!chip || !chip.dataset.desc || !uiRefs.tooltipPortal) return;

  uiRefs.tooltipPortal.textContent = chip.dataset.desc;
  uiRefs.tooltipPortal.classList.add("show");
  const rect = chip.getBoundingClientRect();

  let top = rect.bottom + 8;
  let left = rect.left + rect.width / 2 - uiRefs.tooltipPortal.offsetWidth / 2;

  if (left < 10) left = 10;
  if (left + uiRefs.tooltipPortal.offsetWidth > window.innerWidth - 10) {
    left = window.innerWidth - uiRefs.tooltipPortal.offsetWidth - 10;
  }

  uiRefs.tooltipPortal.style.top = `${top}px`;
  uiRefs.tooltipPortal.style.left = `${left}px`;
}

function showPortalTooltip(el) {
  if (!el || !el.dataset.tooltip || !uiRefs.tooltipPortal) return;

  uiRefs.tooltipPortal.textContent = el.dataset.tooltip;
  uiRefs.tooltipPortal.classList.add("show");
  const rect = el.getBoundingClientRect();

  let top = rect.bottom + 10;
  let left = rect.right - uiRefs.tooltipPortal.offsetWidth;

  if (left < 10) left = 10;
  if (left + uiRefs.tooltipPortal.offsetWidth > window.innerWidth - 10) {
    left = window.innerWidth - uiRefs.tooltipPortal.offsetWidth - 10;
  }
  if (top + uiRefs.tooltipPortal.offsetHeight > window.innerHeight - 10) {
    top = rect.top - uiRefs.tooltipPortal.offsetHeight - 10;
  }

  uiRefs.tooltipPortal.style.top = `${top}px`;
  uiRefs.tooltipPortal.style.left = `${left}px`;
}

function hideTooltip() {
  if (uiRefs.tooltipPortal) {
    uiRefs.tooltipPortal.classList.remove("show");
  }
}

function setupTooltipHandlers() {
  document.addEventListener("mouseover", (e) => {
    if (state.pinnedChip) return;
    const chip = e.target.closest(".keyword-chip");
    if (chip) { showTooltip(chip); return; }
    const hasTooltip = e.target.closest(".has-tooltip");
    if (hasTooltip) showPortalTooltip(hasTooltip);
  });

  document.addEventListener("mouseout", (e) => {
    if (state.pinnedChip) return;
    const chip = e.target.closest(".keyword-chip");
    const hasTooltip = e.target.closest(".has-tooltip");
    if (chip || hasTooltip) hideTooltip();
  });

  document.addEventListener("click", (e) => {
    const chip = e.target.closest(".keyword-chip");

    if (chip) {
      e.stopPropagation();
      if (state.pinnedChip === chip) {
        state.pinnedChip = null;
        hideTooltip();
        chip.classList.remove("active");
      } else {
        if (state.pinnedChip) state.pinnedChip.classList.remove("active");
        state.pinnedChip = chip;
        chip.classList.add("active");
        showTooltip(chip);
      }
      return;
    }

    if (state.pinnedChip && !e.target.closest("#tooltip-portal")) {
      state.pinnedChip.classList.remove("active");
      state.pinnedChip = null;
      hideTooltip();
    }
  });
}

function showToast(target, message) {
  const toast = document.createElement("div");
  toast.className = "floating-toast";
  toast.textContent = message;
  document.body.appendChild(toast);

  let rect;
  if (target && typeof target.getBoundingClientRect === "function") {
    rect = target.getBoundingClientRect();
  } else if (target && typeof target.left === "number") {
    rect = target;
  } else {
    rect = {
      left: window.innerWidth / 2,
      width: 0,
      bottom: window.innerHeight / 2,
    };
  }

  toast.style.left = `${rect.left + rect.width / 2}px`;
  toast.style.top = `${rect.bottom + 8}px`;
  toast.style.transform = "translate(-50%, 4px)";

  void toast.offsetWidth;
  toast.classList.add("show");
  toast.style.transform = "translate(-50%, 0)";

  setTimeout(() => {
    toast.classList.remove("show");
    toast.style.transform = "translate(-50%, 4px)";
    setTimeout(() => toast.remove(), 200);
  }, 1500);
}

export { setAlert, logMessage, showTooltip, showPortalTooltip, hideTooltip, setupTooltipHandlers, showToast };
