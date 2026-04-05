import QRCode from "qrcode/lib/browser.js";
import {
  deriveKeys,
  setupPasswordToggle,
  setLoading,
} from "./shared";
import "/src/input.css";

// --- Encrypt-only helpers ---

function bufferToBase64(buf) {
  return btoa(String.fromCharCode(...buf));
}

function concatBuffers(...arrays) {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

function sanitizeNote(note) {
  return note
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9 _-]/g, "");
}

// --- Encrypt-specific crypto helpers ---

function generateRandomComponents() {
  return {
    salt: crypto.getRandomValues(new Uint8Array(16)),
    iv: crypto.getRandomValues(new Uint8Array(12)),
  };
}

async function encryptText(text, password, salt, iv) {
  const { key, hmacKey } = await deriveKeys(password, salt, "encrypt");
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(text),
    ),
  );
  const hmac = new Uint8Array(
    await crypto.subtle.sign("HMAC", hmacKey, ciphertext),
  );
  return { ciphertext, hmac };
}

function encodePayload(ciphertext, salt, iv, hmac) {
  const binaryPayload = concatBuffers(salt, iv, ciphertext, hmac);
  return bufferToBase64(binaryPayload);
}

function buildQRText(note, payloadB64) {
  return note ? `${note}|${payloadB64}` : payloadB64;
}

// --- QR rendering ---

function addWhiteBorder(canvas) {
  const borderSize = 16;
  const ctx = canvas.getContext("2d");
  const qrImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

  canvas.width += borderSize * 2;
  canvas.height += borderSize * 2;

  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.putImageData(qrImageData, borderSize, borderSize);
}

function generateQRCode(qrText, qrDiv, qrContainer) {
  qrDiv.innerHTML = "";
  QRCode.toCanvas(qrText, {
    width: 256,
    margin: 0,
    errorCorrectionLevel: "H",
  }, function (error, canvas) {
    if (error) {
      console.error("QR generation error:", error);
      alert(`Failed to generate QR code: ${error.message || "unknown error"}. The text may be too long.`);
      return;
    }
    qrDiv.appendChild(canvas);
    addWhiteBorder(canvas);
    qrContainer.classList.remove("hidden");
  });
}

// --- Main encrypt action ---

async function encrypt(noteInput, plainTextInput, passwordInput, qrDiv, qrContainer, encryptBtn) {
  const note = noteInput.value;
  const text = plainTextInput.value;
  const password = passwordInput.value;

  if (!text || text.trim() === "") {
    alert("Please enter the text you want to encrypt.");
    return;
  }

  if (!password || password.trim() === "") {
    alert("Please enter a password / passphrase.");
    return;
  }

  const originalText = encryptBtn.textContent;
  setLoading(encryptBtn, true, originalText);

  try {
    const sanitizedNote = sanitizeNote(note);
    const { salt, iv } = generateRandomComponents();
    const { ciphertext, hmac } = await encryptText(text, password, salt, iv);
    const payloadB64 = encodePayload(ciphertext, salt, iv, hmac);
    const qrText = buildQRText(sanitizedNote, payloadB64);

    generateQRCode(qrText, qrDiv, qrContainer);
  } catch (err) {
    console.error("Encryption error:", err);
    alert(`Encryption failed: ${err.message || "unknown error occurred"}.`);
  } finally {
    setLoading(encryptBtn, false, originalText);
    passwordInput.value = "";
  }
}

// --- Download ---

function setupDownload(qrDiv, noteInput) {
  document.getElementById("download-btn").onclick = () => {
    const canvas = qrDiv.querySelector("canvas");
    if (!canvas) return;
    const note = noteInput.value.trim();
    const filename = note ? `qr-cipher_${sanitizeNote(note)}.png` : "qr-cipher.png";
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = filename;
    a.click();
  };
}

// --- Init ---

document.addEventListener("DOMContentLoaded", () => {
  const noteInput = document.getElementById("note");
  const plainTextInput = document.getElementById("plaintext");
  const passwordInput = document.getElementById("passphrase");
  const qrDiv = document.getElementById("qrcode");
  const qrContainer = document.getElementById("qrcode-container");
  const togglePassBtn = document.getElementById("toggle-pass");
  const eyeIcon = document.getElementById("eye-icon");
  const encryptBtn = document.getElementById("encrypt-btn");
  const charCount = document.getElementById("char-count");

  document.getElementById("back-btn").onclick = () =>
    (window.location.href = "index.html");

  setupPasswordToggle(passwordInput, togglePassBtn, eyeIcon);

  // Character counter
  function updateCharCount() {
    const count = plainTextInput.value.length;
    charCount.textContent = count;
    charCount.classList.toggle("text-red-400", count > 800);
    charCount.classList.toggle("text-gray-400", count <= 800);
  }

  updateCharCount();
  plainTextInput.addEventListener("input", updateCharCount);

  encryptBtn.onclick = () =>
    encrypt(noteInput, plainTextInput, passwordInput, qrDiv, qrContainer, encryptBtn);

  setupDownload(qrDiv, noteInput);
});
