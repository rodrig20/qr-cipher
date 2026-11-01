import { BrowserQRCodeReader } from "@zxing/library";
import {
  deriveKeys,
  setupPasswordToggle,
  showToast,
  copyToClipboard,
  playFeedbackTone,
} from "./shared";
import "./input.css";

// --- Decrypt Crypto Helpers ---

function base64ToBuffer(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function extractBinaryComponents(raw) {
  const hmacSize = 32;
  return {
    salt: raw.slice(0, 16),
    iv: raw.slice(16, 28),
    data: raw.slice(28, raw.length - hmacSize),
    hmac: raw.slice(raw.length - hmacSize),
  };
}

async function decryptPayload(password, salt, iv, data, storedHmac) {
  const { key, hmacKey } = await deriveKeys(password, salt, "decrypt");

  const hmacValid = await crypto.subtle.verify("HMAC", hmacKey, storedHmac, data);
  if (!hmacValid) {
    throw new Error("WRONG_PASSWORD");
  }

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    data,
  );
  return new TextDecoder().decode(decrypted);
}

function parseQRData(qrText) {
  const lastPipe = qrText.lastIndexOf("|");
  const note = lastPipe > 0 ? qrText.slice(0, lastPipe) : null;
  const payloadB64 = lastPipe > 0 ? qrText.slice(lastPipe + 1) : qrText;
  return { note, payloadB64 };
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
    const { note, payloadB64 } = parseQRData(qrText);

    if (!payloadB64 || payloadB64.trim() === "") {
      showAlert("Invalid QR code: missing encrypted payload.", "error");
      return;
    }

    let raw;
    try {
      raw = base64ToBuffer(payloadB64);
    } catch {
      showAlert("Invalid QR code: corrupted base64 data.", "error");
      return;
    }

    if (raw.length < 60) {
      showAlert("Invalid QR code: payload data too short.", "error");
      return;
    }

    const { salt, iv, data, hmac } = extractBinaryComponents(raw);
    const text = await decryptPayload(password, salt, iv, data, hmac);

    if (note) {
      noteDisplay.textContent = note;
      noteDisplay.classList.remove("hidden");
    } else {
      noteDisplay.classList.add("hidden");
    }

    decryptedEl.textContent = text;
    resultCard.classList.remove("hidden");
    decryptBtn?.classList.add("hidden");
    showToast("Decrypted successfully.", "success");
    hideAlert();
  } catch (err) {
    if (err.message === "WRONG_PASSWORD") {
      showAlert("Incorrect passphrase (HMAC integrity check failed).", "error");
    } else if (err.name === "OperationError" || err.message?.includes("operation failed")) {
      showAlert("Decryption failed. Please check your passphrase.", "error");
    } else {
      showAlert(`Error: ${err.message || "unexpected error occurred"}.`, "error");
      console.error("Decryption error:", err);
    }
  } finally {
    isDecodingBusy = false;
    if (decryptBtn) {
      decryptBtn.disabled = false;
      decryptBtn.textContent = "Decrypt Message";
    }
  }
}

// --- QR Detection Handler ---

function onQRCodeFound(codeData) {
  if (!codeData || !isScanningLive) return;

  scannedQRText = codeData;
  isScanningLive = false;
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
    // No password entered: show Decrypt button and wait for user to click it
    decryptBtn?.classList.remove("hidden");
    showAlert("QR code detected. Enter your passphrase and click Decrypt.", "warning");
    passwordInput?.focus();
  }
}

// --- Live Camera Management ---

async function initCamera() {
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
  decryptBtn?.classList.add("hidden");

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

    isScanningLive = true;
    setCornerColor(false);

    // Continuous video scanning with ZXing
    codeReader.decodeFromVideoElementContinuously(videoEl, (result, error) => {
      if (result && isScanningLive) {
        onQRCodeFound(result.getText());
      }
    });

    // Native BarcodeDetector pass if supported
    if ("BarcodeDetector" in window) {
      try {
        const formats = await window.BarcodeDetector.getSupportedFormats();
        if (formats.includes("qr_code")) {
          const nativeDetector = new window.BarcodeDetector({ formats: ["qr_code"] });
          const scanNative = async () => {
            if (!isScanningLive) return;
            if (videoEl && videoEl.readyState >= 2 && videoEl.videoWidth > 0) {
              try {
                const barcodes = await nativeDetector.detect(videoEl);
                if (barcodes.length > 0 && barcodes[0].rawValue && isScanningLive) {
                  onQRCodeFound(barcodes[0].rawValue);
                  return;
                }
              } catch {
                // ignore
              }
            }
            if (isScanningLive) requestAnimationFrame(scanNative);
          };
          requestAnimationFrame(scanNative);
        }
      } catch {
        // ignore
      }
    }
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
  decryptBtn?.classList.add("hidden");
  setCornerColor(false);
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

  setupPasswordToggle(passwordInput, togglePassBtn, eyeIcon);

  // Decrypt on button click
  decryptBtn.onclick = () => {
    if (scannedQRText) {
      executeDecryption(scannedQRText, passwordInput.value);
    }
  };

  // Decrypt on Enter in passphrase input
  passwordInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && scannedQRText) {
      e.preventDefault();
      executeDecryption(scannedQRText, passwordInput.value);
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
