import { uiRefs } from "./config.js";
import { onThemeChange as onPdfThemeChange } from "./pdfDarkMode.js";
import { DocManager } from "./docManager.js";

const savedTheme = localStorage.getItem("sunshade-theme") || "light";
document.documentElement.dataset.theme = savedTheme;
if (uiRefs.themeIcon) {
  uiRefs.themeIcon.src = savedTheme === "dark" ? "../src/images/night-mode.png" : "../src/images/night-mode-2.png";
}

function init() {
  if (uiRefs.themeToggle) {
    uiRefs.themeToggle.addEventListener("click", () => {
      const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      localStorage.setItem("sunshade-theme", next);
      if (uiRefs.themeIcon) {
        uiRefs.themeIcon.src = next === "dark" ? "../src/images/night-mode.png" : "../src/images/night-mode-2.png";
      }
      onPdfThemeChange(next);
    });
  }
}

function getTheme() {
  return document.documentElement.dataset.theme || "light";
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("sunshade-theme", theme);
  if (uiRefs.themeIcon) {
    uiRefs.themeIcon.src = theme === "dark" ? "../src/images/night-mode.png" : "../src/images/night-mode-2.png";
  }
  onPdfThemeChange(theme);
}

export { init, getTheme, setTheme };
