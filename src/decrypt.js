import { BrowserQRCodeReader } from "../vendor/zxing-library.js";
import jsQR from "../vendor/jsqr.js";
import {
  deriveKeys,
  setupPasswordToggle,
  showToast,
  copyToClipboard,
  playFeedbackTone,
  base45Decode,
} from "./shared";
import "./input.css";

// --- Decrypt Crypto Helpers ---

function extractBinaryComponents(raw) {
  return {
    salt: raw.slice(0, 16),
    iv: raw.slice(16, 28),
    data: raw.slice(28),
  };
}

async function decryptPayload(password, salt, iv, data) {
  const { key } = await deriveKeys(password, salt, "decrypt");

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    data,
  );
  return new TextDecoder().decode(decrypted);
}

function parseQRData(qrText) {
  const firstColon = qrText.indexOf(":");
  const note = firstColon > 0 ? qrText.slice(0, firstColon) : null;
  const payload = firstColon >= 0 ? qrText.slice(firstColon + 1) : qrText;
  return { note, payload };
}

// --- Application State ---

const codeReader = new BrowserQRCodeReader();
let currentStream = null;
let currentTrack = null;
let currentFacingMode = "environment";
let isTorchOn = false;
let isScanningLive = true;
let scannedQRText = null;
let isDecodingBusy = false;
let scanRafId = null;
let nativeDetector = null;
let scanCanvas = null;
let scanCtx = null;

// --- DOM Elements ---

let videoEl;
let passwordInput;
let togglePassBtn;
let eyeIcon;
let decryptBtn;
let rescanBtn;
let alertBanner;
let alertMsg;
let resultCard;
let decryptedEl;
let noteDisplay;
let copyBtn;
let copyBtnText;
let torchBtn;
let flipBtn;
let fileUploadInput;
let cameraErrorEl;
let cameraErrorMsg;
let cornerMarkers;
let pastePayloadEl;
let modeCameraBtn;
let modeTextBtn;
let cameraModeEl;
let textModeEl;

// --- Alert Helpers ---

function showAlert(message, type = "error") {
  if (!alertBanner || !alertMsg) return;
  alertBanner.classList.remove(
    "hidden",
    "bg-red-950/40", "border-red-900/60", "text-red-300",
    "bg-zinc-800", "border-zinc-700", "text-zinc-300",
    "bg-emerald-950/40", "border-emerald-900/60", "text-emerald-300",
  );

  if (type === "warning") {
    alertBanner.classList.add("bg-zinc-800", "border-zinc-700", "text-zinc-300");
  } else if (type === "success") {
    alertBanner.classList.add("bg-emerald-950/40", "border-emerald-900/60", "text-emerald-300");
  } else {
    alertBanner.classList.add("bg-red-950/40", "border-red-900/60", "text-red-300");
  }

  alertMsg.textContent = message;
}

function hideAlert() {
  if (alertBanner) alertBanner.classList.add("hidden");
}

function setCornerColor(isDetected) {
  if (!cornerMarkers) return;
  cornerMarkers.forEach((el) => {
    if (isDetected) {
      el.classList.remove("border-white/80");
      el.classList.add("border-emerald-400");
    } else {
      el.classList.remove("border-emerald-400");
      el.classList.add("border-white/80");
    }
  });
}

// --- Decryption Execution ---

async function executeDecryption(qrText, password) {
  if (!qrText || isDecodingBusy) return;
  if (!password || password.trim() === "") {
    showAlert("Please enter your passphrase to decrypt.", "warning");
    passwordInput?.focus();
    return;
  }

  isDecodingBusy = true;
  hideAlert();
  if (decryptBtn) {
    decryptBtn.disabled = true;
    decryptBtn.textContent = "Decrypting...";
  }

  try {
    const { note, payload } = parseQRData(qrText);

    if (!payload || payload.trim() === "") {
      showAlert("Invalid QR code: missing encrypted payload.", "error");
      return;
    }

    let raw;
    try {
      raw = base45Decode(payload);
    } catch {
      showAlert("Invalid QR code: corrupted payload data.", "error");
      return;
    }

    if (raw.length < 2) {
      showAlert("Invalid QR code: payload data too short.", "error");
      return;
    }

    const length = (raw[0] << 8) | raw[1];
    // Minimum payload: salt (16) + IV (12) + AES-GCM tag (16)
    if (length < 16 + 12 + 16) {
      showAlert("Invalid QR code: payload data too short.", "error");
      return;
    }

    if (raw.length < 2 + length) {
      showAlert("Invalid QR code: truncated payload data.", "error");
      return;
    }

    const payloadBytes = raw.slice(2, 2 + length);
    const { salt, iv, data } = extractBinaryComponents(payloadBytes);
    const text = await decryptPayload(password, salt, iv, data);

    if (note) {
      noteDisplay.textContent = note;
      noteDisplay.classList.remove("hidden");
    } else {
      noteDisplay.classList.add("hidden");
    }

    decryptedEl.textContent = text;
    resultCard.classList.remove("hidden");
    showToast("Decrypted successfully.", "success");
    hideAlert();
    // Hide the top note banner once decrypted
    const banner = document.getElementById("scan-note-banner");
    if (banner) banner.classList.add("hidden");
  } catch (err) {
    if (err.name === "OperationError" || err.message?.includes("operation failed")) {
      showAlert("Decryption failed. Please check your passphrase.", "error");
    } else {
      showAlert(`Error: ${err.message || "unexpected error occurred"}.`, "error");
      console.error("Decryption error:", err);
    }
  } finally {
    isDecodingBusy = false;
    if (decryptBtn) {
      decryptBtn.disabled = false;
      decryptBtn.textContent = "Decrypt";
    }
  }
}

// --- Note Banner Helper ---

function showNoteFromQR(qrText) {
  try {
    const { note } = parseQRData(qrText);
    const noteTextEl = document.getElementById("scan-note-text");
    const banner = document.getElementById("scan-note-banner");
    if (note && noteTextEl && banner) {
      noteTextEl.textContent = note;
      banner.classList.remove("hidden");
    }
  } catch {
    // ignore malformed input
  }
}

// --- Unified Decrypt (works in both camera and text modes) ---

function isTextModeActive() {
  return Boolean(textModeEl && !textModeEl.classList.contains("hidden"));
}

function getActiveQRText() {
  if (isTextModeActive()) {
    return pastePayloadEl?.value?.trim() || "";
  }
  return scannedQRText || "";
}

function startDecryption() {
  const textMode = isTextModeActive();
  const qrText = getActiveQRText();

  if (!qrText) {
    showAlert(textMode ? "Paste the QR code text first." : "Scan a QR code first.", "warning");
    (textMode ? pastePayloadEl : passwordInput)?.focus();
    return;
  }

  showNoteFromQR(qrText);
  executeDecryption(qrText, passwordInput?.value || "");
}

// --- QR Detection Handler ---

function onQRCodeFound(codeData) {
  if (!codeData || !isScanningLive) return;

  scannedQRText = codeData;
  isScanningLive = false;
  stopScanLoop();
  playFeedbackTone();
  setCornerColor(true);

  // Stop active video decoding
  try {
    codeReader.reset();
  } catch {
    // ignore
  }

  const password = passwordInput?.value;
  if (password && password.trim().length > 0) {
    // Password already entered: decrypt immediately without showing button
    executeDecryption(codeData, password);
  } else {
    // No password entered: show only the note at the top, wait for password
    const { note } = parseQRData(codeData);
    if (note) {
      const noteTextEl = document.getElementById("scan-note-text");
      const banner = document.getElementById("scan-note-banner");
      if (noteTextEl) noteTextEl.textContent = note;
      if (banner) banner.classList.remove("hidden");
    }
    resultCard?.classList.add("hidden");
    decryptBtn?.classList.remove("hidden");
    showAlert("QR code detected. Enter your passphrase and click Decrypt.", "warning");
    passwordInput?.focus();
  }
}

// --- Live Scanning Loop ---
//
// ZXing's decodeFromVideoElementContinuously() builds its own internal video
// element and its promise rejects silently under browser autoplay policies, so
// the preview kept rendering while nothing was ever decoded. We drive the frame
// loop ourselves instead: native BarcodeDetector when the browser exposes it
// (hardware accelerated), jsQR on canvas frames otherwise.

async function createNativeDetector() {
  if (!("BarcodeDetector" in window)) return null;
  try {
    const formats = await window.BarcodeDetector.getSupportedFormats();
    if (!formats.includes("qr_code")) return null;
    return new window.BarcodeDetector({ formats: ["qr_code"] });
  } catch {
    return null;
  }
}

function stopScanLoop() {
  isScanningLive = false;
  if (scanRafId !== null) {
    cancelAnimationFrame(scanRafId);
    scanRafId = null;
  }
}

function startScanLoop() {
  stopScanLoop();
  isScanningLive = true;
  setCornerColor(false);

  if (!scanCanvas) {
    scanCanvas = document.createElement("canvas");
    scanCtx = scanCanvas.getContext("2d", { willReadFrequently: true });
  }

  const tick = async () => {
    if (!isScanningLive || !videoEl) return;

    const width = videoEl.videoWidth;
    const height = videoEl.videoHeight;

    if (videoEl.readyState >= 2 && width > 0 && height > 0) {
      // Fast path: browser-native detection
      if (nativeDetector) {
        try {
          const codes = await nativeDetector.detect(videoEl);
          if (isScanningLive && codes.length > 0 && codes[0]?.rawValue) {
            onQRCodeFound(codes[0].rawValue);
            return;
          }
        } catch {
          nativeDetector = null; // fall back to jsQR for the remaining frames
        }
      }

      // General path: decode a canvas copy of the current frame
      try {
        if (scanCanvas.width !== width) scanCanvas.width = width;
        if (scanCanvas.height !== height) scanCanvas.height = height;
        scanCtx.drawImage(videoEl, 0, 0, width, height);
        const frame = scanCtx.getImageData(0, 0, width, height);
        const found = jsQR(frame.data, frame.width, frame.height, {
          inversionAttempts: "attemptBoth",
        });
        if (isScanningLive && found?.data) {
          onQRCodeFound(found.data);
          return;
        }
      } catch {
        // ignore transient per-frame errors
      }
    }

    // Re-schedule only if the loop was not stopped during an await above
    if (isScanningLive) {
      scanRafId = requestAnimationFrame(tick);
    }
  };

  scanRafId = requestAnimationFrame(tick);
}

// --- Live Camera Management ---

async function initCamera() {
  stopScanLoop();
  try {
    codeReader.reset();
  } catch {
    // ignore
  }

  if (currentStream) {
    currentStream.getTracks().forEach((t) => t.stop());
    currentStream = null;
  }

  cameraErrorEl?.classList.add("hidden");

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: currentFacingMode },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });

    currentStream = stream;
    videoEl.srcObject = stream;
    videoEl.setAttribute("playsinline", "true");
    await videoEl.play();

    const videoTrack = stream.getVideoTracks()[0];
    currentTrack = videoTrack;

    if (videoTrack && videoTrack.applyConstraints) {
      const caps = videoTrack.getCapabilities ? videoTrack.getCapabilities() : {};
      const advanced = [];
      if (caps.focusMode && caps.focusMode.includes("continuous")) {
        advanced.push({ focusMode: "continuous" });
      }
      if (caps.exposureMode && caps.exposureMode.includes("continuous")) {
        advanced.push({ exposureMode: "continuous" });
      }
      if (advanced.length > 0) {
        videoTrack.applyConstraints({ advanced }).catch(() => {});
      }
      if (caps.torch) {
        torchBtn?.classList.remove("hidden");
      } else {
        torchBtn?.classList.add("hidden");
      }
    }

    nativeDetector = await createNativeDetector();
    startScanLoop();
  } catch (err) {
    console.error("Camera startup error:", err);
    let message = "Camera access unavailable.";
    if (err.name === "NotAllowedError") {
      message = "Camera permission was denied in your browser.";
    } else if (err.name === "NotFoundError") {
      message = "No camera hardware detected.";
    }
    if (cameraErrorMsg) cameraErrorMsg.textContent = message;
    cameraErrorEl?.classList.remove("hidden");
  }
}

async function toggleTorch() {
  if (!currentTrack) return;
  try {
    isTorchOn = !isTorchOn;
    await currentTrack.applyConstraints({
      advanced: [{ torch: isTorchOn }],
    });
    if (torchBtn) {
      torchBtn.classList.toggle("text-amber-300", isTorchOn);
      torchBtn.classList.toggle("bg-zinc-800", isTorchOn);
    }
  } catch (e) {
    console.warn("Torch toggle error:", e);
  }
}

function flipCamera() {
  currentFacingMode = currentFacingMode === "environment" ? "user" : "environment";
  initCamera();
}

function resetScanner() {
  scannedQRText = null;
  hideAlert();
  resultCard?.classList.add("hidden");
  noteDisplay?.classList.add("hidden");
  const banner = document.getElementById("scan-note-banner");
  if (banner) banner.classList.add("hidden");
  setCornerColor(false);

  if (isTextModeActive()) {
    // Text mode: clear the payload input, never touch the camera
    if (pastePayloadEl) pastePayloadEl.value = "";
    pastePayloadEl?.focus();
    return;
  }

  isScanningLive = true;
  initCamera();
}

// --- Image File Scanning Support ---

async function scanFromImageFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = async () => {
      try {
        const result = await codeReader.decodeFromImageElement(img);
        if (result && result.getText()) {
          onQRCodeFound(result.getText());
          showToast("QR code detected from image.", "success");
          return;
        }
      } catch {
        if ("BarcodeDetector" in window) {
          try {
            const nativeDetector = new window.BarcodeDetector({ formats: ["qr_code"] });
            const barcodes = await nativeDetector.detect(img);
            if (barcodes.length > 0 && barcodes[0].rawValue) {
              onQRCodeFound(barcodes[0].rawValue);
              showToast("QR code detected from image.", "success");
              return;
            }
          } catch {
            // ignore
          }
        }
        showAlert("No readable QR code found in the uploaded image.", "warning");
      }
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

// --- Initialization ---

function initApp() {
  videoEl = document.getElementById("preview");
  passwordInput = document.getElementById("passphrase");
  togglePassBtn = document.getElementById("toggle-pass");
  eyeIcon = document.getElementById("eye-icon");
  decryptBtn = document.getElementById("decrypt-btn");
  rescanBtn = document.getElementById("rescan-btn");
  alertBanner = document.getElementById("alert-banner");
  alertMsg = document.getElementById("alert-msg");
  resultCard = document.getElementById("result-card");
  decryptedEl = document.getElementById("decrypted");
  noteDisplay = document.getElementById("note-display");
  copyBtn = document.getElementById("copy-btn");
  copyBtnText = document.getElementById("copy-btn-text");
  torchBtn = document.getElementById("torch-btn");
  flipBtn = document.getElementById("flip-btn");
  fileUploadInput = document.getElementById("file-upload");
  cameraErrorEl = document.getElementById("camera-error");
  cameraErrorMsg = document.getElementById("camera-error-msg");
  cornerMarkers = document.querySelectorAll(".corner-marker");
  pastePayloadEl = document.getElementById("paste-payload");
  modeCameraBtn = document.getElementById("mode-camera");
  modeTextBtn = document.getElementById("mode-text");
  cameraModeEl = document.getElementById("camera-mode");
  textModeEl = document.getElementById("text-mode");

  setupPasswordToggle(passwordInput, togglePassBtn, eyeIcon);

  // Mode toggle: camera <-> text
  function switchMode(mode) {
    const isCamera = mode === "camera";
    cameraModeEl?.classList.toggle("hidden", !isCamera);
    textModeEl?.classList.toggle("hidden", isCamera);

    if (rescanBtn) {
      rescanBtn.textContent = isCamera ? "Scan another code" : "Enter another code";
    }

    if (isCamera) {
      modeCameraBtn?.classList.add("bg-zinc-800", "text-zinc-100");
      modeCameraBtn?.classList.remove("text-zinc-400");
      modeTextBtn?.classList.remove("bg-zinc-800", "text-zinc-100");
      modeTextBtn?.classList.add("text-zinc-400");
      initCamera();
    } else {
      modeTextBtn?.classList.add("bg-zinc-800", "text-zinc-100");
      modeTextBtn?.classList.remove("text-zinc-400");
      modeCameraBtn?.classList.remove("bg-zinc-800", "text-zinc-100");
      modeCameraBtn?.classList.add("text-zinc-400");
      try {
        codeReader.reset();
      } catch {
        // ignore
      }
      stopScanLoop();
      if (currentStream) {
        currentStream.getTracks().forEach((t) => t.stop());
        currentStream = null;
      }
      isScanningLive = false;
    }
  }

  modeCameraBtn.onclick = () => switchMode("camera");
  modeTextBtn.onclick = () => switchMode("text");

  // Decrypt on button click (works in both camera and text modes)
  decryptBtn.onclick = () => startDecryption();

  // Decrypt on Enter in passphrase input
  passwordInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      startDecryption();
    }
  });

  rescanBtn.onclick = () => resetScanner();

  torchBtn.onclick = () => toggleTorch();
  flipBtn.onclick = () => flipCamera();
  fileUploadInput.onchange = (e) => {
    const file = e.target.files?.[0];
    if (file) scanFromImageFile(file);
    e.target.value = "";
  };

  copyBtn.onclick = () => {
    if (decryptedEl.textContent) {
      copyToClipboard(decryptedEl.textContent, copyBtnText);
    }
  };

  initCamera();

  window.addEventListener("beforeunload", () => {
    stopScanLoop();
    try {
      codeReader.reset();
    } catch {
      // ignore
    }
    if (currentStream) {
      currentStream.getTracks().forEach((t) => t.stop());
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}
