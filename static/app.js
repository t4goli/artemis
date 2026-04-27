const camera = document.querySelector("#camera");
const snapshotCanvas = document.querySelector("#snapshotCanvas");
const startCamera = document.querySelector("#startCamera");
const doneCapture = document.querySelector("#doneCapture");
const shotStrip = document.querySelector("#shotStrip");
const counter = document.querySelector("#counter");
const headingReadout = document.querySelector("#headingReadout");
const coverageReadout = document.querySelector("#coverageReadout");
const rowProgress = document.querySelector("#rowProgress");
const angleRing = document.querySelector("#angleRing");
const nextAngle = document.querySelector("#nextAngle");
const statusText = document.querySelector("#status");
const captureScreen = document.querySelector("#captureScreen");
const reviewScreen = document.querySelector("#reviewScreen");
const backToCapture = document.querySelector("#backToCapture");
const finalizeCapture = document.querySelector("#finalizeCapture");
const rowSelector = document.querySelector("#rowSelector");
const sphereCanvas = document.querySelector("#sphereCanvas");
const viewerHud = document.querySelector("#viewerHud");
const arrowLeft = document.querySelector("#arrowLeft");
const arrowRight = document.querySelector("#arrowRight");
const arrowUp = document.querySelector("#arrowUp");
const arrowDown = document.querySelector("#arrowDown");

const ROWS = [
  { id: "level", label: "Level", pitchMin: -25, pitchMax: 35, targetPitch: 5 },
  { id: "up", label: "Ceiling", pitchMin: 36, pitchMax: 90, targetPitch: 55 },
  { id: "down", label: "Floor", pitchMin: -90, pitchMax: -26, targetPitch: -45 },
];
const ROW_BANDS = {
  up: 0,
  level: 1,
  down: 2,
};
const TARGET_COUNT = 36;
const TARGET_STEP = 360 / TARGET_COUNT;
const PREVIEW_WIDTH = 2048;
const PREVIEW_HEIGHT = 1024;
const MAX_CAPTURE_WIDTH = 720;
const JPEG_QUALITY = 0.72;
const CAPTURE_COOLDOWN_MS = 650;
const PATCH_CANVAS_SIZE = 512;
const DB_NAME = "surround-stitcher";
const DB_VERSION = 1;
const SHOT_STORE = "shots";
const SESSION_KEY = "surroundStitcherSessionIdV2";

const previewCanvas = document.createElement("canvas");
const previewContext = previewCanvas.getContext("2d");
const patchCanvas = document.createElement("canvas");
const patchContext = patchCanvas.getContext("2d");
const viewer = createSphereViewer(sphereCanvas);
const coveredTargets = new Map(ROWS.map((row) => [row.id, new Set()]));
const shots = [];
const angleChips = [];
const sessionId = getOrCreateSessionId();
let stream = null;
let currentHeading = 0;
let currentPitch = 0;
let currentRowIndex = 0;
let currentRow = ROWS[currentRowIndex].id;
let lastCaptureAt = 0;
let captureTimer = null;
let headingReady = false;
let lastOrientationAt = 0;
let lastHeadingChangeAt = 0;

resetPreviewTexture();
renderRowProgress();
renderAngleRing();
updateGuidance();
restoreSavedShots();

startCamera.addEventListener("click", startCapture);
doneCapture.addEventListener("click", showReview);
backToCapture.addEventListener("click", showCapture);
finalizeCapture.addEventListener("click", finalizeStitch);
rowSelector.addEventListener("click", handleRowSelect);
window.addEventListener("deviceorientationabsolute", handleOrientation, true);
window.addEventListener("deviceorientation", handleOrientation, true);

async function startCapture() {
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Camera access requires HTTPS. Use your ngrok HTTPS URL.");
    }

    await requestOrientationAccess();

    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1600 },
        height: { ideal: 1200 },
      },
      audio: false,
    });

    camera.srcObject = stream;
    startCamera.hidden = true;
    doneCapture.hidden = false;
    setStatus("Move slowly. Follow the arrows until enough of the room is captured.");
    captureTimer = window.setInterval(autoCaptureIfNeeded, 180);
  } catch (error) {
    setStatus(`Camera failed: ${error.message}`);
  }
}

async function requestOrientationAccess() {
  if (!window.DeviceOrientationEvent) return;
  if (typeof DeviceOrientationEvent.requestPermission !== "function") return;

  try {
    const permission = await DeviceOrientationEvent.requestPermission();
    if (permission !== "granted") {
      setStatus("Motion permission was blocked. Angle tracking cannot auto-capture accurately.");
    }
  } catch {
    setStatus("Motion permission was blocked. Angle tracking cannot auto-capture accurately.");
  }
}

function handleOrientation(event) {
  const heading = getCompassHeading(event);
  if (heading !== null) {
    const movement = angleDistance(currentHeading, heading);
    currentHeading = heading;
    headingReady = true;
    lastOrientationAt = Date.now();
    if (movement > 1) {
      lastHeadingChangeAt = Date.now();
    }
  }
  if (typeof event.beta === "number") currentPitch = clamp(event.beta, -90, 90);
  updateGuidance();
}

function autoCaptureIfNeeded() {
  if (!stream || Date.now() - lastCaptureAt < CAPTURE_COOLDOWN_MS) return;
  if (!headingReady) {
    setStatus("Waiting for phone angle data. Allow motion/orientation permission if your browser asks.");
    return;
  }

  const row = getRowById(currentRow);
  const currentTarget = Math.round(currentHeading / TARGET_STEP) % TARGET_COUNT;
  if (coveredTargets.get(row.id).has(currentTarget)) {
    if (Date.now() - lastHeadingChangeAt > 2500) {
      setStatus("The angle is not changing. Rotate the phone slowly from one spot.");
    }
    advanceRowIfReady();
    return;
  }

  captureFrame(row.id, currentTarget);
  lastCaptureAt = Date.now();

  if (getTotalCovered() >= TARGET_COUNT * ROWS.length) {
    showReview();
  }
}

function captureFrame(rowId, target) {
  const sourceWidth = camera.videoWidth;
  const sourceHeight = camera.videoHeight;
  if (!sourceWidth || !sourceHeight) return;

  const scale = Math.min(1, MAX_CAPTURE_WIDTH / sourceWidth);
  snapshotCanvas.width = Math.round(sourceWidth * scale);
  snapshotCanvas.height = Math.round(sourceHeight * scale);

  const context = snapshotCanvas.getContext("2d");
  context.drawImage(camera, 0, 0, snapshotCanvas.width, snapshotCanvas.height);

  const shot = {
    id: crypto.randomUUID(),
    image: snapshotCanvas.toDataURL("image/jpeg", JPEG_QUALITY),
    frameId: null,
    row: rowId,
    target,
    heading: currentHeading,
    pitch: currentPitch,
    createdAt: Date.now(),
  };

  shots.push(shot);
  saveShot(shot);
  uploadFrame(shot);
  coveredTargets.get(rowId).add(target);
  paintPreviewPatch(snapshotCanvas, shot);
  advanceRowIfReady();
  renderShots();
  updateGuidance();
}

function paintPreviewPatch(sourceCanvas, shot) {
  const rowIndex = ROW_BANDS[shot.row] ?? 1;
  const bandHeight = PREVIEW_HEIGHT / ROWS.length;
  const patchWidth = Math.ceil(PREVIEW_WIDTH / 5);
  const patchHeight = Math.ceil(bandHeight * 0.95);
  const xCenter = ((shot.target + 0.5) / TARGET_COUNT) * PREVIEW_WIDTH;
  const y = Math.round(rowIndex * bandHeight + (bandHeight - patchHeight) / 2);
  const x = Math.round(xCenter - patchWidth / 2);

  drawWrappedImage(sourceCanvas, x, y, patchWidth, patchHeight);
  viewer.loadCanvasTexture(previewCanvas);
}

function drawWrappedImage(image, x, y, width, height) {
  patchCanvas.width = PATCH_CANVAS_SIZE;
  patchCanvas.height = PATCH_CANVAS_SIZE;
  patchContext.clearRect(0, 0, PATCH_CANVAS_SIZE, PATCH_CANVAS_SIZE);
  patchContext.drawImage(image, 0, 0, PATCH_CANVAS_SIZE, PATCH_CANVAS_SIZE);
  patchContext.globalCompositeOperation = "destination-in";

  const horizontalMask = patchContext.createLinearGradient(0, 0, PATCH_CANVAS_SIZE, 0);
  horizontalMask.addColorStop(0, "rgba(0,0,0,0)");
  horizontalMask.addColorStop(0.22, "rgba(0,0,0,1)");
  horizontalMask.addColorStop(0.78, "rgba(0,0,0,1)");
  horizontalMask.addColorStop(1, "rgba(0,0,0,0)");
  patchContext.fillStyle = horizontalMask;
  patchContext.fillRect(0, 0, PATCH_CANVAS_SIZE, PATCH_CANVAS_SIZE);

  const verticalMask = patchContext.createLinearGradient(0, 0, 0, PATCH_CANVAS_SIZE);
  verticalMask.addColorStop(0, "rgba(0,0,0,0)");
  verticalMask.addColorStop(0.18, "rgba(0,0,0,1)");
  verticalMask.addColorStop(0.82, "rgba(0,0,0,1)");
  verticalMask.addColorStop(1, "rgba(0,0,0,0)");
  patchContext.fillStyle = verticalMask;
  patchContext.fillRect(0, 0, PATCH_CANVAS_SIZE, PATCH_CANVAS_SIZE);
  patchContext.globalCompositeOperation = "source-over";

  const normalizedX = ((x % PREVIEW_WIDTH) + PREVIEW_WIDTH) % PREVIEW_WIDTH;

  if (normalizedX + width <= PREVIEW_WIDTH) {
    previewContext.drawImage(patchCanvas, normalizedX, y, width, height);
    return;
  }

  const firstWidth = PREVIEW_WIDTH - normalizedX;
  const secondWidth = width - firstWidth;
  const firstSourceWidth = PATCH_CANVAS_SIZE * (firstWidth / width);

  previewContext.drawImage(patchCanvas, 0, 0, firstSourceWidth, PATCH_CANVAS_SIZE, normalizedX, y, firstWidth, height);
  previewContext.drawImage(
    patchCanvas,
    firstSourceWidth,
    0,
    PATCH_CANVAS_SIZE - firstSourceWidth,
    PATCH_CANVAS_SIZE,
    0,
    y,
    secondWidth,
    height
  );
}

function updateGuidance() {
  const row = getRowById(currentRow);
  const target = Math.round(currentHeading / TARGET_STEP) % TARGET_COUNT;
  const rowCoverage = coveredTargets.get(row.id).size;
  const nextMissing = findNextMissingTarget(row.id, target);
  const totalCovered = getTotalCovered();

  headingReadout.textContent = `${row.label} ${Math.round(currentHeading)} deg`;
  coverageReadout.textContent = `${totalCovered} / ${TARGET_COUNT * ROWS.length}`;

  setArrowState(row, nextMissing, target);

  if (!stream) {
    nextAngle.textContent = "Start camera to begin guided capture.";
  } else if (rowCoverage >= TARGET_COUNT) {
    nextAngle.textContent = nextRowInstruction();
  } else {
    nextAngle.textContent = `${row.label}: ${rowDirectionText(row)} Rotate slowly toward the arrow.`;
  }

  renderCoverage();
}

function setArrowState(row, missingTarget, currentTarget) {
  arrowLeft.classList.remove("active");
  arrowRight.classList.remove("active");
  arrowUp.classList.remove("active");
  arrowDown.classList.remove("active");

  if (!stream) return;

  if (row.id === "up") {
    arrowUp.classList.add("active");
    return;
  }
  if (row.id === "down") {
    arrowDown.classList.add("active");
    return;
  }
  if (missingTarget === null) return;

  const clockwise = (missingTarget - currentTarget + TARGET_COUNT) % TARGET_COUNT;
  const counterClockwise = (currentTarget - missingTarget + TARGET_COUNT) % TARGET_COUNT;
  if (clockwise <= counterClockwise) {
    arrowRight.classList.add("active");
  } else {
    arrowLeft.classList.add("active");
  }
}

function renderCoverage() {
  for (let index = 0; index < angleChips.length; index += 1) {
    angleChips[index].classList.toggle("covered", coveredTargets.get(currentRow).has(index));
    angleChips[index].classList.toggle("current", index === Math.round(currentHeading / TARGET_STEP) % TARGET_COUNT);
  }

  for (const row of ROWS) {
    const meter = rowProgress.querySelector(`[data-row-meter="${row.id}"]`);
    if (!meter) continue;
    const fill = Math.round((coveredTargets.get(row.id).size / TARGET_COUNT) * 100);
    meter.style.setProperty("--fill", `${fill}%`);
  }
}

function renderRowProgress() {
  rowProgress.innerHTML = "";
  for (const row of ROWS) {
    const meter = document.createElement("div");
    meter.className = "row-meter";
    meter.dataset.rowMeter = row.id;
    meter.innerHTML = `${row.label}<span></span>`;
    rowProgress.append(meter);
  }
}

function renderAngleRing() {
  angleRing.innerHTML = "";
  angleChips.length = 0;
  for (let index = 0; index < TARGET_COUNT; index += 1) {
    const chip = document.createElement("div");
    chip.className = "angle-chip";
    angleRing.append(chip);
    angleChips.push(chip);
  }
}

function renderShots() {
  shotStrip.innerHTML = "";
  for (const shot of shots) {
    const img = document.createElement("img");
    img.src = shot.image;
    img.className = "shot";
    shotStrip.append(img);
  }
  counter.textContent = `${shots.length} shots`;
}

function showReview() {
  if (captureTimer) {
    window.clearInterval(captureTimer);
    captureTimer = null;
  }
  viewer.loadCanvasTexture(previewCanvas);
  captureScreen.hidden = true;
  reviewScreen.hidden = false;
  viewerHud.textContent = "Drag to look around. Black areas are missing.";
}

function showCapture() {
  captureScreen.hidden = false;
  reviewScreen.hidden = true;
  if (stream && !captureTimer) {
    captureTimer = window.setInterval(autoCaptureIfNeeded, 180);
  }
}

function handleRowSelect(event) {
  const button = event.target.closest("[data-row]");
  if (!button) return;

  const rowIndex = ROWS.findIndex((row) => row.id === button.dataset.row);
  if (rowIndex === -1) return;

  currentRowIndex = rowIndex;
  currentRow = ROWS[currentRowIndex].id;
  updateRowButtons();
  updateGuidance();
}

async function finalizeStitch() {
  if (shots.length < 8) {
    viewerHud.textContent = "Capture more photos before finalizing.";
    return;
  }

  await waitForFrameUploads();
  const selectedShots = selectFinalizeShots();
  const frames = selectedShots
    .filter((shot) => shot.frameId)
    .map((shot) => ({
      id: shot.frameId,
      row: shot.row,
      target: shot.target,
      heading: shot.heading,
      pitch: shot.pitch,
    }));

  if (frames.length < 8) {
    viewerHud.textContent = "Still uploading captured photos. Try Finalize again in a moment.";
    return;
  }

  finalizeCapture.disabled = true;
  viewerHud.textContent = `Enhancing ${frames.length} selected photos. You can keep previewing.`;

  try {
    const response = await fetch("/api/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, frames }),
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.error || "Finalizing failed.");
    }

    await viewer.loadImageTexture(result.image);
    viewerHud.textContent =
      result.method === "hugin"
        ? "Hugin full 360. Drag to look around."
        : result.fallback
          ? "Fallback photo-map 360. Drag to look around."
          : "Final 360. Drag to look around.";
  } catch (error) {
    viewer.loadCanvasTexture(previewCanvas);
    viewerHud.textContent = `Enhance failed. Showing instant preview. ${error.message}`;
  } finally {
    finalizeCapture.disabled = false;
  }
}

function selectFinalizeShots() {
  const selected = [];
  const perRowLimit = {
    level: 36,
    up: 36,
    down: 36,
  };

  for (const row of ROWS) {
    const rowShots = shots
      .filter((shot) => shot.row === row.id && shot.frameId)
      .sort((a, b) => a.target - b.target);

    selected.push(...pickEvenlySpaced(rowShots, perRowLimit[row.id]));
  }

  return selected;
}

function pickEvenlySpaced(items, limit) {
  if (items.length <= limit) return items;

  const picked = [];
  const used = new Set();
  for (let index = 0; index < limit; index += 1) {
    const sourceIndex = Math.round((index * (items.length - 1)) / (limit - 1));
    if (!used.has(sourceIndex)) {
      used.add(sourceIndex);
      picked.push(items[sourceIndex]);
    }
  }
  return picked;
}

function uploadFrame(shot) {
  fetch("/api/frame", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, image: shot.image }),
  })
    .then((response) => response.json())
    .then((result) => {
      shot.frameId = result.id;
      saveShot(shot);
    })
    .catch(() => {
      shot.frameId = null;
      saveShot(shot);
    });
}

async function waitForFrameUploads() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 5000) {
    if (shots.every((shot) => shot.frameId)) return;
    await new Promise((resolve) => window.setTimeout(resolve, 150));
  }
}

function getOrCreateSessionId() {
  const existing = localStorage.getItem(SESSION_KEY);
  if (existing) return existing;
  const next = crypto.randomUUID();
  localStorage.setItem(SESSION_KEY, next);
  return next;
}

function openShotDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SHOT_STORE)) {
        db.createObjectStore(SHOT_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveShot(shot) {
  try {
    const db = await openShotDb();
    const transaction = db.transaction(SHOT_STORE, "readwrite");
    transaction.objectStore(SHOT_STORE).put({ ...shot, sessionId });
  } catch {
    setStatus("Photos are captured, but this browser blocked local saving.");
  }
}

async function getSavedShots() {
  const db = await openShotDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(SHOT_STORE, "readonly");
    const request = transaction.objectStore(SHOT_STORE).getAll();
    request.onsuccess = () => resolve(request.result.filter((shot) => shot.sessionId === sessionId));
    request.onerror = () => reject(request.error);
  });
}

async function restoreSavedShots() {
  let savedShots = [];
  try {
    savedShots = await getSavedShots();
  } catch {
    return;
  }

  if (!savedShots.length) return;

  resetPreviewTexture();
  shots.length = 0;
  for (const covered of coveredTargets.values()) covered.clear();

  savedShots
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
    .forEach((shot) => {
      const restored = { ...shot, frameId: null };
      shots.push(restored);
      coveredTargets.get(restored.row)?.add(restored.target);
      repaintSavedShot(restored);
      uploadFrame(restored);
    });

  advanceRowIfReady();
  renderShots();
  updateGuidance();
  setStatus(`Restored ${shots.length} saved photos. They are re-uploading in the background.`);
}

function repaintSavedShot(shot) {
  const image = new Image();
  image.onload = () => paintPreviewPatch(image, shot);
  image.src = shot.image;
}

function resetPreviewTexture() {
  previewCanvas.width = PREVIEW_WIDTH;
  previewCanvas.height = PREVIEW_HEIGHT;
  previewContext.fillStyle = "#000";
  previewContext.fillRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
  viewer.loadCanvasTexture(previewCanvas);
}

function getCompassHeading(event) {
  if (typeof event.webkitCompassHeading === "number") {
    return normalizeDegrees(event.webkitCompassHeading);
  }
  if (typeof event.alpha === "number") {
    return normalizeDegrees(360 - event.alpha);
  }
  return null;
}

function nextRowInstruction() {
  const next = ROWS.find((row) => coveredTargets.get(row.id).size < TARGET_COUNT);
  if (!next) return "Coverage complete. Tap Done to review.";
  return `${next.label} still needs coverage. Angle the phone ${next.id === "up" ? "up" : next.id === "down" ? "down" : "level"}.`;
}

function rowDirectionText(row) {
  if (row.id === "up") return "Tilt upward for the ceiling.";
  if (row.id === "down") return "Tilt downward for the floor.";
  return "Hold the phone level.";
}

function advanceRowIfReady() {
  if (coveredTargets.get(currentRow).size < TARGET_COUNT) return;
  const nextIndex = ROWS.findIndex((row) => coveredTargets.get(row.id).size < TARGET_COUNT);
  if (nextIndex === -1 || nextIndex === currentRowIndex) return;
  currentRowIndex = nextIndex;
  currentRow = ROWS[currentRowIndex].id;
  updateRowButtons();
}

function updateRowButtons() {
  rowSelector.querySelectorAll("[data-row]").forEach((button) => {
    button.classList.toggle("active", button.dataset.row === currentRow);
  });
}

function findNextMissingTarget(rowId, startTarget) {
  const covered = coveredTargets.get(rowId);
  if (covered.size >= TARGET_COUNT) return null;
  for (let offset = 0; offset < TARGET_COUNT; offset += 1) {
    const target = (startTarget + offset) % TARGET_COUNT;
    if (!covered.has(target)) return target;
  }
  return null;
}

function getRowById(rowId) {
  return ROWS.find((row) => row.id === rowId) ?? ROWS[0];
}

function getTotalCovered() {
  return ROWS.reduce((sum, row) => sum + coveredTargets.get(row.id).size, 0);
}

function normalizeDegrees(value) {
  return ((value % 360) + 360) % 360;
}

function angleDistance(a, b) {
  const difference = Math.abs(normalizeDegrees(a) - normalizeDegrees(b));
  return Math.min(difference, 360 - difference);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function setStatus(message) {
  statusText.textContent = message;
}

function createSphereViewer(canvas) {
  const gl = canvas.getContext("webgl", { antialias: true });
  if (!gl) {
    return {
      loadCanvasTexture: () => setStatus("This browser does not support WebGL."),
      loadImageTexture: () => setStatus("This browser does not support WebGL."),
    };
  }

  const vertexShader = compileShader(
    gl,
    gl.VERTEX_SHADER,
    `
      attribute vec2 a_position;
      varying vec2 v_uv;
      void main() {
        v_uv = a_position * 0.5 + 0.5;
        gl_Position = vec4(a_position, 0.0, 1.0);
      }
    `
  );

  const fragmentShader = compileShader(
    gl,
    gl.FRAGMENT_SHADER,
    `
      precision mediump float;
      uniform sampler2D u_texture;
      uniform vec2 u_resolution;
      uniform float u_yaw;
      uniform float u_pitch;
      varying vec2 v_uv;
      const float PI = 3.141592653589793;

      mat3 rotateY(float angle) {
        float s = sin(angle);
        float c = cos(angle);
        return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c);
      }

      mat3 rotateX(float angle) {
        float s = sin(angle);
        float c = cos(angle);
        return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c);
      }

      void main() {
        vec2 xy = v_uv * 2.0 - 1.0;
        xy.x *= u_resolution.x / u_resolution.y;
        vec3 direction = normalize(vec3(xy.x, -xy.y, -1.0));
        direction = rotateY(u_yaw) * rotateX(u_pitch) * direction;
        float longitude = atan(direction.x, -direction.z);
        float latitude = asin(clamp(direction.y, -1.0, 1.0));
        vec2 uv = vec2(longitude / (2.0 * PI) + 0.5, latitude / PI + 0.5);
        gl_FragColor = texture2D(u_texture, uv);
      }
    `
  );

  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);

  const positionLocation = gl.getAttribLocation(program, "a_position");
  const resolutionLocation = gl.getUniformLocation(program, "u_resolution");
  const yawLocation = gl.getUniformLocation(program, "u_yaw");
  const pitchLocation = gl.getUniformLocation(program, "u_pitch");
  const textureLocation = gl.getUniformLocation(program, "u_texture");
  const texture = gl.createTexture();

  let yaw = 0;
  let pitch = 0;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  canvas.addEventListener("pointerdown", (event) => {
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    yaw -= dx * 0.006;
    pitch = clamp(pitch + dy * 0.006, -1.25, 1.25);
    draw();
  });

  canvas.addEventListener("pointerup", () => {
    dragging = false;
  });
  canvas.addEventListener("pointercancel", () => {
    dragging = false;
  });
  window.addEventListener("resize", draw);

  function loadCanvasTexture(sourceCanvas) {
    uploadTextureSource(sourceCanvas);
    draw();
  }

  function loadImageTexture(imageUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        uploadTextureSource(image);
        draw();
        resolve();
      };
      image.onerror = reject;
      image.src = imageUrl;
    });
  }

  function uploadTextureSource(source) {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }

  function draw() {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width * window.devicePixelRatio));
    const height = Math.max(1, Math.floor(rect.height * window.devicePixelRatio));

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(textureLocation, 0);
    gl.uniform2f(resolutionLocation, canvas.width, canvas.height);
    gl.uniform1f(yawLocation, yaw);
    gl.uniform1f(pitchLocation, pitch);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  return { loadCanvasTexture, loadImageTexture };
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return shader;
}
