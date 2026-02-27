import { pdfjsLib, eventBus } from "./config.js";

const SCANNED_THRESHOLD = 0.85;
const MIN_IMAGE_DIM = 100;

function multiplyMatrix(a, b) {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

function transformPoint(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function extractImageBBoxes(opList, viewportTransform) {
  const bboxes = [];
  const ctmStack = [];
  let ctm = viewportTransform.slice();
  const OPS = pdfjsLib.OPS;

  for (let i = 0; i < opList.fnArray.length; i++) {
    const op = opList.fnArray[i];
    const args = opList.argsArray[i];

    switch (op) {
      case OPS.save:
        ctmStack.push(ctm.slice());
        break;
      case OPS.restore:
        if (ctmStack.length) ctm = ctmStack.pop();
        break;
      case OPS.transform:
        ctm = multiplyMatrix(ctm, args);
        break;
      case OPS.paintImageXObject:
      case OPS.paintInlineImageXObject:
      case OPS.paintInlineImageXObjectGroup: {
        const corners = [
          transformPoint(ctm, 0, 0),
          transformPoint(ctm, 1, 0),
          transformPoint(ctm, 0, 1),
          transformPoint(ctm, 1, 1),
        ];
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const [cx, cy] of corners) {
          if (cx < minX) minX = cx;
          if (cy < minY) minY = cy;
          if (cx > maxX) maxX = cx;
          if (cy > maxY) maxY = cy;
        }
        bboxes.push({ x: minX, y: minY, w: maxX - minX, h: maxY - minY });
        break;
      }
      case OPS.paintImageXObjectRepeat: {
        const [objId, scaleX, scaleY, posArr] = args;
        for (let p = 0; p < posArr.length; p += 2) {
          const localM = [scaleX, 0, 0, scaleY, posArr[p], posArr[p + 1]];
          const m = multiplyMatrix(ctm, localM);
          const corners = [
            transformPoint(m, 0, 0),
            transformPoint(m, 1, 0),
            transformPoint(m, 0, 1),
            transformPoint(m, 1, 1),
          ];
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (const [cx, cy] of corners) {
            if (cx < minX) minX = cx;
            if (cy < minY) minY = cy;
            if (cx > maxX) maxX = cx;
            if (cy > maxY) maxY = cy;
          }
          bboxes.push({ x: minX, y: minY, w: maxX - minX, h: maxY - minY });
        }
        break;
      }
    }
  }
  return bboxes;
}

function createOverlay(sourceCanvas, bboxes) {
  const overlay = document.createElement("canvas");
  overlay.className = "pdf-image-overlay";
  overlay.width = sourceCanvas.width;
  overlay.height = sourceCanvas.height;
  overlay.style.pointerEvents = "none";
  const ctx = overlay.getContext("2d");
  const pad = 1;
  for (const b of bboxes) {
    const sx = Math.max(0, Math.floor(b.x) - pad);
    const sy = Math.max(0, Math.floor(b.y) - pad);
    const sw = Math.min(sourceCanvas.width - sx, Math.ceil(b.w) + pad * 2);
    const sh = Math.min(sourceCanvas.height - sy, Math.ceil(b.h) + pad * 2);
    if (sw > 0 && sh > 0) {
      ctx.drawImage(sourceCanvas, sx, sy, sw, sh, sx, sy, sw, sh);
    }
  }
  return overlay;
}

function isScannedPage(bboxes, canvasW, canvasH) {
  const pageArea = canvasW * canvasH;
  if (pageArea === 0) return false;
  for (const b of bboxes) {
    if (Math.abs(b.w * b.h) / pageArea > SCANNED_THRESHOLD) return true;
  }
  return false;
}

function removeOverlay(pageDiv) {
  const existing = pageDiv.querySelector("canvas.pdf-image-overlay");
  if (existing) existing.remove();
}

const pageGeneration = new Map();

async function processPage(pageView) {
  const pageDiv = pageView.div;
  removeOverlay(pageDiv);

  if (document.documentElement.dataset.theme !== "dark") return;

  const canvas = pageDiv.querySelector(".canvasWrapper > canvas:first-child");
  if (!canvas) return;

  const pdfPage = pageView.pdfPage;
  if (!pdfPage) return;

  const gen = (pageGeneration.get(pageView.id) || 0) + 1;
  pageGeneration.set(pageView.id, gen);

  try {
    const opList = await pdfPage.getOperatorList();

    if (pageGeneration.get(pageView.id) !== gen) return;
    if (document.documentElement.dataset.theme !== "dark") return;

    const outputScale = pageView.outputScale;
    const vt = pageView.viewport.transform;
    const scaledTransform = outputScale
      ? multiplyMatrix([outputScale.sx, 0, 0, outputScale.sy, 0, 0], vt)
      : vt;

    console.log("[pdfDarkMode] page", pageView.id,
      "ops:", opList.fnArray.length,
      "canvas:", canvas.width, "x", canvas.height,
      "outputScale:", outputScale?.sx, outputScale?.sy,
      "vt:", vt);

    const bboxes = extractImageBBoxes(opList, scaledTransform)
      .filter(b => b.w >= MIN_IMAGE_DIM && b.h >= MIN_IMAGE_DIM);
    console.log("[pdfDarkMode] page", pageView.id, "bboxes:", bboxes.length, bboxes);

    if (bboxes.length === 0) { console.log("[pdfDarkMode] no images found, skipping"); return; }
    if (isScannedPage(bboxes, canvas.width, canvas.height)) { console.log("[pdfDarkMode] scanned page detected, skipping"); return; }

    removeOverlay(pageDiv);
    const overlay = createOverlay(canvas, bboxes);
    const canvasWrapper = pageDiv.querySelector(".canvasWrapper");
    if (canvasWrapper) {
      canvasWrapper.appendChild(overlay);
      console.log("[pdfDarkMode] overlay appended, overlay size:", overlay.width, "x", overlay.height);
    }
  } catch (err) {
    console.warn("pdfDarkMode: overlay failed for page", pageView.id, err);
  }
}

function onThemeChange(theme, pdfViewer) {
  if (!pdfViewer?._pages) return;
  for (const pageView of pdfViewer._pages) {
    const pageDiv = pageView?.div;
    if (!pageDiv) continue;
    if (theme === "dark") {
      processPage(pageView);
    } else {
      removeOverlay(pageDiv);
    }
  }
}

function init() {
  eventBus.on("pagerendered", ({ source, pageNumber }) => {
    if (document.documentElement.dataset.theme === "dark") {
      processPage(source);
    }
  });
}

export { init, onThemeChange, processPage, removeOverlay };
