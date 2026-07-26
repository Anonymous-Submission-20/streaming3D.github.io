const DATA_URL = "./assets/data/examples.json?v=20260726-01";
const VIEWER_ROOT_MARGIN = "700px 0px";
const FRAME_INTERVAL_MS = 900;
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const objectList = document.querySelector("#object-result-list");
const streamList = document.querySelector("#stream-result-list");
const pendingViewers = new Map();

const viewerObserver = "IntersectionObserver" in window
  ? new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        activateViewer(entry.target);
        viewerObserver.unobserve(entry.target);
      });
    }, { rootMargin: VIEWER_ROOT_MARGIN })
  : null;

function createElement(tag, options = {}) {
  const element = document.createElement(tag);
  if (options.className) element.className = options.className;
  if (options.text) element.textContent = options.text;
  Object.entries(options.attributes || {}).forEach(([name, value]) => {
    if (value !== null && value !== undefined) element.setAttribute(name, String(value));
  });
  return element;
}

function normalizePath(path) {
  if (typeof path !== "string") return "";
  const normalized = path.replace(/^\.\//, "./");
  if (normalized.includes("/frames/") && !normalized.includes("?")) {
    return `${normalized}?v=20260726-white-01`;
  }
  return normalized;
}

function createHeading(item, index, total) {
  const heading = createElement("div", { className: "result-heading" });
  const titleLine = createElement("div", { className: "result-title-line" });
  titleLine.append(
    createElement("h3", { text: item.title }),
    createElement("span", { className: "dataset", text: item.dataset }),
  );
  heading.append(
    titleLine,
    createElement("span", {
      className: "result-count",
      text: `${String(index + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}`,
    }),
  );
  return heading;
}

function createPanel(label) {
  const panel = createElement("div", { className: "panel" });
  panel.append(createElement("p", { className: "panel-label", text: label }));
  return panel;
}

function createModelPanel(item, label, source, poster) {
  const panel = createPanel(label);
  const shell = createElement("div", {
    className: "viewer-shell",
    attributes: { "aria-label": `${label} model for ${item.title}`, "aria-busy": "true" },
  });
  const placeholder = createElement("div", {
    className: "viewer-placeholder",
    text: "3D model loads when visible",
  });
  shell.append(placeholder);
  panel.append(shell);

  const descriptor = {
    shell,
    source: normalizePath(source),
    poster: normalizePath(poster),
    label,
    item,
    viewer: null,
  };
  pendingViewers.set(shell, descriptor);
  if (viewerObserver) viewerObserver.observe(shell);
  else activateViewer(shell);
  return descriptor;
}

async function activateViewer(shell) {
  const descriptor = pendingViewers.get(shell);
  if (!descriptor || descriptor.viewer || !descriptor.source) return;

  try {
    await customElements.whenDefined("model-viewer");
    if (!shell.isConnected) return;

    const viewer = createElement("model-viewer", {
      attributes: {
        src: descriptor.source,
        alt: `Interactive ${descriptor.label} 3D model for ${descriptor.item.title}`,
        "camera-controls": "",
        "touch-action": "pan-y",
        "environment-image": "neutral",
        "shadow-intensity": "0.8",
        exposure: "1.05",
        "camera-orbit": descriptor.item.cameraOrbit || "0deg 75deg auto",
        "camera-target": "auto auto auto",
        "interaction-prompt": "none",
        loading: "lazy",
        reveal: "auto",
      },
    });

    if (descriptor.poster) viewer.setAttribute("poster", descriptor.poster);

    const progress = createElement("div", {
      className: "viewer-progress",
      attributes: { slot: "progress-bar", role: "progressbar", "aria-label": `Loading ${descriptor.label}` },
    });
    const progressFill = createElement("span");
    progress.append(progressFill);
    viewer.append(progress);

    viewer.addEventListener("progress", (event) => {
      const value = Number(event.detail?.totalProgress);
      if (Number.isFinite(value)) progressFill.style.width = `${Math.round(value * 100)}%`;
    });
    viewer.addEventListener("load", () => {
      descriptor.viewer = viewer;
      viewer.dataset.loadState = "loaded";
      shell.classList.add("is-loaded");
      shell.setAttribute("aria-busy", "false");
      progress.remove();
      alignRowCameras(shell.closest(".result-row"));
    });
    viewer.addEventListener("error", () => {
      shell.setAttribute("aria-busy", "false");
      placeholder.className = "viewer-error";
      placeholder.textContent = "This 3D model could not be loaded.";
    });

    descriptor.viewer = viewer;
    shell.prepend(viewer);
  } catch {
    shell.setAttribute("aria-busy", "false");
    placeholder.className = "viewer-error";
    placeholder.textContent = "The 3D viewer is unavailable.";
  }
}

function createStreamPanel(item) {
  const panel = createPanel("Input stream");
  const frames = Array.isArray(item.frames) ? item.frames.filter(Boolean) : [];
  const shell = createElement("div", {
    className: "stream-shell",
    attributes: {
      "aria-label": `Input stream for ${item.title}`,
    },
  });

  if (frames.length === 0) {
    shell.append(createElement("p", {
      className: "viewer-error",
      text: "Input frames are unavailable for this example.",
    }));
    panel.append(shell);
    return panel;
  }

  const frame = createElement("img", {
    className: "stream-frame",
    attributes: {
      src: normalizePath(frames[0]),
      alt: `Input stream for ${item.title}`,
      decoding: "async",
    },
  });
  const scrubberWrap = createElement("div", { className: "stream-scrubber-wrap" });
  const scrubber = createElement("input", {
    className: "stream-scrubber",
    attributes: {
      type: "range",
      min: "0",
      max: String(frames.length - 1),
      step: "1",
      value: "0",
      "aria-label": `Scrub through the ${item.title} input stream`,
    },
  });
  scrubberWrap.append(scrubber);
  shell.append(frame, scrubberWrap);

  let frameIndex = 0;
  let timer = null;
  let visible = false;

  const showFrame = (index) => {
    frameIndex = (Number(index) + frames.length) % frames.length;
    frame.src = normalizePath(frames[frameIndex]);
    scrubber.value = String(frameIndex);
    const progress = frames.length > 1 ? (frameIndex / (frames.length - 1)) * 100 : 0;
    scrubber.style.setProperty("--stream-progress", `${progress}%`);

    const nextFrame = new Image();
    nextFrame.src = normalizePath(frames[(frameIndex + 1) % frames.length]);
  };

  const pause = () => {
    if (timer !== null) window.clearInterval(timer);
    timer = null;
  };

  const play = () => {
    if (timer !== null || !visible || reduceMotion.matches || frames.length < 2) return;
    timer = window.setInterval(() => showFrame(frameIndex + 1), FRAME_INTERVAL_MS);
  };

  scrubber.addEventListener("pointerdown", pause);
  scrubber.addEventListener("input", () => showFrame(Number(scrubber.value)));
  scrubber.addEventListener("change", play);

  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      visible = entries.some((entry) => entry.isIntersecting);
      if (visible) play();
      else pause();
    }, { threshold: 0.2 });
    observer.observe(shell);
  } else {
    visible = true;
    play();
  }

  panel.append(shell);
  return panel;
}

function copyCamera(source, target) {
  if (
    source === target
    || source.dataset.loadState !== "loaded"
    || target.dataset.loadState !== "loaded"
    || typeof source.getCameraOrbit !== "function"
  ) return;

  const orbit = source.getCameraOrbit();
  const targetPoint = source.getCameraTarget();
  target.cameraOrbit = `${orbit.theta}rad ${orbit.phi}rad ${orbit.radius}m`;
  target.cameraTarget = `${targetPoint.x}m ${targetPoint.y}m ${targetPoint.z}m`;
  if (typeof source.getFieldOfView === "function") {
    target.fieldOfView = `${source.getFieldOfView()}deg`;
  }
  target.jumpCameraToGoal?.();
}

function alignRowCameras(row) {
  if (!row || row.dataset.cameraSyncReady === "true") return;
  const viewers = [...row.querySelectorAll("model-viewer")];
  if (viewers.length < 2 || viewers.some((viewer) => viewer.dataset.loadState !== "loaded")) return;

  row.dataset.cameraSyncReady = "true";
  const source = viewers[0];
  const initialOrbit = source.getCameraOrbit?.();
  if (initialOrbit) {
    viewers.slice(1).forEach((target) => {
      target.cameraOrbit = `${initialOrbit.theta}rad ${initialOrbit.phi}rad auto`;
      target.cameraTarget = "auto auto auto";
      target.jumpCameraToGoal?.();
    });
  }

  let syncing = false;
  viewers.forEach((viewer) => {
    viewer.addEventListener("camera-change", () => {
      if (syncing) return;
      syncing = true;
      viewers.forEach((target) => copyCamera(viewer, target));
      requestAnimationFrame(() => { syncing = false; });
    });
  });
}

function renderObjectResult(item, index, total) {
  const row = createElement("article", { className: "result-row" });
  const grid = createElement("div", { className: "result-grid" });
  const poster = item.thumbnail || item.frames?.[0] || "";
  const gt = createModelPanel(item, "Ground truth", item.models?.gt, poster);
  const sam = createModelPanel(item, "SAM3D", item.models?.sam3d, poster);
  const ours = createModelPanel(item, "Streaming3D", item.models?.stream3d, poster);
  grid.append(gt.shell.parentElement, sam.shell.parentElement, ours.shell.parentElement);
  row.append(createHeading(item, index, total), grid);
  return row;
}

function renderStreamResult(item, index, total) {
  const row = createElement("article", { className: "result-row" });
  const grid = createElement("div", { className: "result-grid" });
  const poster = item.thumbnail || item.frames?.[0] || "";
  const stream = createStreamPanel(item);
  const sam = createModelPanel(item, "SAM3D", item.models?.sam3d, poster);
  const ours = createModelPanel(item, "Streaming3D", item.models?.stream3d, poster);
  grid.append(stream, sam.shell.parentElement, ours.shell.parentElement);
  row.append(createHeading(item, index, total), grid);
  return row;
}

function renderCollection(container, items, renderer) {
  const fragment = document.createDocumentFragment();
  items.forEach((item, index) => fragment.append(renderer(item, index, items.length)));
  container.replaceChildren(fragment);
}

async function init() {
  try {
    const response = await fetch(DATA_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const results = Array.isArray(data.results) ? data.results.slice(0, 6) : [];
    const comparisons = Array.isArray(data.comparisons) ? data.comparisons.slice(0, 6) : [];
    if (results.length !== 6 || comparisons.length !== 6) {
      throw new Error("Expected six examples in each visualization group.");
    }
    renderCollection(objectList, results, renderObjectResult);
    renderCollection(streamList, comparisons, renderStreamResult);
  } catch (error) {
    console.error(error);
    objectList.innerHTML = '<p class="load-message">Object results could not be loaded.</p>';
    streamList.innerHTML = '<p class="load-message">Streaming comparisons could not be loaded.</p>';
  }
}

init();
