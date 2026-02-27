import { state, uiRefs, pdfLinkService } from "./config.js";

const outlinePageMap = new Map();

async function loadOutline(doc) {
  if (!uiRefs.outlineView) return;
  uiRefs.outlineView.textContent = "목차 불러오는 중...";
  try {
    const outline = await doc.getOutline();
    if (!outline || outline.length === 0) {
      uiRefs.outlineView.textContent = "목차 정보가 없습니다.";
      return;
    }
    uiRefs.outlineView.innerHTML = "";
    uiRefs.outlineView.style.textAlign = "left";
    uiRefs.outlineView.style.paddingTop = "0";

    renderOutlineTree(outline, uiRefs.outlineView);
    resolveOutlinePages(outline, doc);
  } catch (err) {
    console.error("Outline load error:", err);
    uiRefs.outlineView.textContent = "목차를 불러올 수 없습니다.";
  }
}

async function resolveOutlinePages(items, doc) {
  const queue = [...items];
  while (queue.length > 0) {
    const item = queue.shift();
    if (item.items && item.items.length > 0) {
      queue.push(...item.items);
    }

    if (item.dest) {
      try {
        let dest = item.dest;
        if (typeof dest === "string") {
          dest = await doc.getDestination(dest);
        }
        if (Array.isArray(dest)) {
          const ref = dest[0];
          const pageIndex = await doc.getPageIndex(ref);
          const pageNum = pageIndex + 1;

          if (!outlinePageMap.has(pageNum)) {
            outlinePageMap.set(pageNum, []);
          }
          if (item._dom) {
            outlinePageMap.get(pageNum).push(item._dom);
          }
        }
      } catch (e) {
      }
    }
  }
}

function updateOutlineHighlight(pageNum) {
  document
    .querySelectorAll(".outline-item.active")
    .forEach((el) => el.classList.remove("active"));

  const pages = Array.from(outlinePageMap.keys()).sort((a, b) => a - b);
  let targetPage = -1;

  for (const p of pages) {
    if (p <= pageNum) {
      targetPage = p;
    } else {
      break;
    }
  }

  if (targetPage !== -1) {
    const items = outlinePageMap.get(targetPage);
    if (items && items.length > 0) {
      items.forEach((el) => {
        el.classList.add("active");
        if (targetPage === pageNum) {
          el.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      });
    }
  }
}

function renderOutlineTree(items, container) {
  const ul = document.createElement("div");
  ul.style.display = "flex";
  ul.style.flexDirection = "column";
  ul.style.gap = "2px";

  items.forEach((item) => {
    const div = document.createElement("div");

    const row = document.createElement("div");
    row.className = "outline-item";
    row.title = item.title;

    item._dom = row;

    const hasChildren = item.items && item.items.length > 0;
    const toggle = document.createElement("span");
    toggle.className = "outline-toggle";
    toggle.innerHTML = hasChildren
      ? `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>`
      : "";
    if (!hasChildren) toggle.style.visibility = "hidden";

    row.appendChild(toggle);

    const text = document.createElement("span");
    text.textContent = item.title;
    text.style.whiteSpace = "nowrap";
    text.style.overflow = "hidden";
    text.style.textOverflow = "ellipsis";
    text.style.flex = "1";
    row.appendChild(text);

    row.addEventListener("click", (e) => {
      if (e.target.closest(".outline-toggle")) return;
      if (item.dest) {
        pdfLinkService.goToDestination(item.dest);
      }
    });

    div.appendChild(row);

    if (hasChildren) {
      const childContainer = document.createElement("div");
      childContainer.className = "outline-children expanded";
      renderOutlineTree(item.items, childContainer);
      div.appendChild(childContainer);

      toggle.classList.add("rotated");

      toggle.addEventListener("click", (e) => {
        e.stopPropagation();
        const expanded = childContainer.classList.toggle("expanded");
        toggle.classList.toggle("rotated", expanded);
      });
    }

    ul.appendChild(div);
  });

  container.appendChild(ul);
}

export { loadOutline, updateOutlineHighlight };
