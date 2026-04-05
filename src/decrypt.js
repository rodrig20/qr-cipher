import jsQR from "jsqr";
import {
  deriveKeys,
  setupPasswordToggle,
  setLoading,
} from "./shared";
import "/src/input.css";

// --- Decrypt-only helpers ---

function base64ToBuffer(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

// --- Decrypt-specific crypto helpers ---

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

// --- UI helpers ---

function parseQRData(qrText) {
  const lastPipe = qrText.lastIndexOf("|");
  const note = lastPipe > 0 ? qrText.slice(0, lastPipe) : null;
  const payloadB64 = lastPipe > 0 ? qrText.slice(lastPipe + 1) : qrText;
  return { note, payloadB64 };
}

function displayResult(decodedDiv, noteDisplay, text, note, captureBtn) {
  if (note) {
    noteDisplay.textContent = note;
    noteDisplay.classList.remove("hidden");
  } else {
    noteDisplay.classList.add("hidden");
  }
  decodedDiv.textContent = text;
  decodedDiv.classList.remove("hidden");
  captureBtn.textContent = "Try again";
  captureBtn.classList.remove("bg-blue-600", "hover:bg-blue-500");
  captureBtn.classList.add("bg-yellow-600", "hover:bg-yellow-500");
}

function displayError(decodedDiv, noteDisplay, message, isWarning = false) {
  decodedDiv.textContent = message;
  decodedDiv.classList.remove("hidden");
  decodedDiv.classList.toggle("bg-red-800", !isWarning);
  decodedDiv.classList.toggle("bg-yellow-800", isWarning);
  decodedDiv.classList.toggle("border-red-600", !isWarning);
  decodedDiv.classList.toggle("border-yellow-600", isWarning);
  noteDisplay.classList.add("hidden");
}

// --- Main decrypt action ---

async function decodeData(qrText, password, decodedDiv, noteDisplay, captureBtn) {
  decodedDiv.classList.remove("bg-red-800", "bg-yellow-800", "border-red-600", "border-yellow-600");

  if (!password) {
    displayError(decodedDiv, noteDisplay, "Please enter your password first.", true);
    return;
  }

  if (!qrText || qrText.trim() === "") {
    displayError(decodedDiv, noteDisplay, "No QR code detected. Please try again.", true);
    return;
  }

  setLoading(captureBtn, true, captureBtn.textContent);

  try {
    const { note, payloadB64 } = parseQRData(qrText);

    if (!payloadB64 || payloadB64.trim() === "") {
      displayError(decodedDiv, noteDisplay, "Invalid QR code: missing encrypted data.", true);
      return;
    }

    let raw;
    try {
      raw = base64ToBuffer(payloadB64);
    } catch (e) {
      displayError(decodedDiv, noteDisplay, "Invalid QR code: corrupted data format.", true);
      return;
    }

    if (raw.length < 60) {
      displayError(decodedDiv, noteDisplay, "Invalid QR code: data too short (minimum 60 bytes required).", true);
      return;
    }

    const { salt, iv, data, hmac } = extractBinaryComponents(raw);

    if (data.length === 0) {
      displayError(decodedDiv, noteDisplay, "Invalid QR code: no encrypted content found.", true);
      return;
    }

    const text = await decryptPayload(password, salt, iv, data, hmac);
    displayResult(decodedDiv, noteDisplay, text, note, captureBtn);
  } catch (err) {
    if (err.message === "WRONG_PASSWORD") {
      displayError(decodedDiv, noteDisplay, "Wrong password. The integrity check failed. Please try again.", true);
    } else if (err.name === "OperationError" || err.message?.includes("operation failed")) {
      displayError(decodedDiv, noteDisplay, "Wrong password. The decryption failed. Please try again.", true);
    } else if (err.name === "EncodingError" || err.message?.includes("encoding")) {
      displayError(decodedDiv, noteDisplay, "Decrypted data has invalid encoding. Wrong password or corrupted data.", true);
    } else {
      displayError(decodedDiv, noteDisplay, `Unexpected error: ${err.message || "unknown error occurred"}.`);
      console.error("Decryption error:", err);
    }
  } finally {
    setLoading(captureBtn, false);
  }
}

// --- Camera ---

async function startCamera(video) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
    });
    video.srcObject = stream;
    video.setAttribute("playsinline", true);
    await video.play();
    return stream;
  } catch (err) {
    if (err.name === "NotAllowedError") {
      alert("Camera access denied. Please allow camera permissions and try again.");
    } else if (err.name === "NotFoundError") {
      alert("No camera found on this device.");
    } else if (err.name === "NotReadableError") {
      alert("Camera is already in use by another application. Please close it and try again.");
    } else {
      alert(`Camera error: ${err.message || "unknown error"}`);
    }
    throw err;
  }
}

function captureAndScan(stream, video, canvas, ctx, passwordInput, captureBtn, decodedDiv, noteDisplay, onScanDone) {
  if (!stream || !passwordInput.value) return;

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  ctx.drawImage(video, 0, 0);

  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const code = jsQR(img.data, img.width, img.height);

  if (code) {
    decodeData(code.data, passwordInput.value, decodedDiv, noteDisplay, captureBtn);
    video.pause();
    stream.getTracks().forEach((t) => t.stop());
    captureBtn.disabled = false;
    onScanDone();
  }
}

// --- Init ---

document.addEventListener("DOMContentLoaded", () => {
  const backButton = document.getElementById("back-btn");
  const passwordInput = document.getElementById("passphrase");
  const togglePassBtn = document.getElementById("toggle-pass");
  const eyeIcon = document.getElementById("eye-icon");
  const decodedDiv = document.getElementById("decrypted");
  const noteDisplay = document.getElementById("note-display");
  const video = document.getElementById("preview");
  const canvas = document.getElementById("canvas");
  const ctx = canvas.getContext("2d");
  const captureBtn = document.getElementById("capture-btn");

  backButton.onclick = () => (window.location.href = "index.html");

  setupPasswordToggle(passwordInput, togglePassBtn, eyeIcon);

  decodedDiv.classList.add("hidden");
  noteDisplay.classList.add("hidden");

  let stream;
  let isScanning = true;

  captureBtn.onclick = () => {
    if (isScanning) {
      captureAndScan(stream, video, canvas, ctx, passwordInput, captureBtn, decodedDiv, noteDisplay, () => { isScanning = false; });
    } else {
      decodedDiv.textContent = "";
      decodedDiv.classList.add("hidden");
      noteDisplay.classList.add("hidden");
      captureBtn.textContent = "Capture QR";
      captureBtn.classList.remove("bg-yellow-600", "hover:bg-yellow-500");
      captureBtn.classList.add("bg-blue-600", "hover:bg-blue-500");
      startCamera(video).then(s => { stream = s; });
      isScanning = true;
    }
  };

  startCamera(video).then(s => { stream = s; });

  window.addEventListener("beforeunload", () => {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
    }
  });
});
