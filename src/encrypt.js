import QRCode from "qrcode/lib/browser.js";
import {
  deriveKeys,
  setupPasswordToggle,
  setLoading,
  showToast,
  copyToClipboard,
} from "./shared";
import "./input.css";

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

function renderQRCodeCanvas(qrText, qrDiv, qrContainer) {
  qrDiv.innerHTML = "";
  QRCode.toCanvas(
    qrText,
    {
      width: 280,
      margin: 1,
      errorCorrectionLevel: "M",
    },
    function (error, canvas) {
      if (error) {
        console.error("QR generation error:", error);
        showToast("Error generating QR code: text may be too long.", "error");
        return;
      }
      qrDiv.appendChild(canvas);
      addWhiteBorder(canvas);
      qrContainer.classList.remove("hidden");
      qrContainer.scrollIntoView({ behavior: "smooth", block: "nearest" });
      showToast("QR code generated successfully.", "success");
    },
  );
}

function showEncryptAlert(message, type = "warning") {
  const alertEl = document.getElementById("encrypt-alert");
  const textEl = document.getElementById("alert-text");
  if (!alertEl || !textEl) return;

  alertEl.classList.remove(
    "hidden",
    "bg-red-950/40", "border-red-900/60", "text-red-300",
    "bg-zinc-800", "border-zinc-700", "text-zinc-300",
  );

  if (type === "error") {
    alertEl.classList.add("bg-red-950/40", "border-red-900/60", "text-red-300");
  } else {
    alertEl.classList.add("bg-zinc-800", "border-zinc-700", "text-zinc-300");
  }

  textEl.textContent = message;
}

function hideEncryptAlert() {
  const alertEl = document.getElementById("encrypt-alert");
  if (alertEl) alertEl.classList.add("hidden");
}

let currentPayloadB64 = "";

async function handleEncrypt(elements) {
  const { noteInput, plainTextInput, passwordInput, qrDiv, qrContainer, encryptBtn, noteBadge } = elements;
  hideEncryptAlert();

  const note = noteInput.value.trim();
  const text = plainTextInput.value;
  const password = passwordInput.value;

  if (!text || text.trim() === "") {
    showEncryptAlert("Please enter the text you want to encrypt.");
    plainTextInput.focus();
    return;
  }

  if (!password || password.trim() === "") {
    showEncryptAlert("Please enter a passphrase.");
    passwordInput.focus();
    return;
  }

  const originalContent = encryptBtn.innerHTML;
  setLoading(encryptBtn, true, "Encrypting...");

  try {
    const sanitizedNote = sanitizeNote(note);
    const { salt, iv } = generateRandomComponents();
    const { ciphertext, hmac } = await encryptText(text, password, salt, iv);
    const payloadB64 = encodePayload(ciphertext, salt, iv, hmac);
    const qrText = buildQRText(sanitizedNote, payloadB64);
    currentPayloadB64 = qrText;

    if (sanitizedNote && noteBadge) {
      noteBadge.textContent = sanitizedNote;
      noteBadge.classList.remove("hidden");
    } else if (noteBadge) {
      noteBadge.classList.add("hidden");
    }

    renderQRCodeCanvas(qrText, qrDiv, qrContainer);
  } catch (err) {
    console.error("Encryption error:", err);
    showEncryptAlert(`Encryption failed: ${err.message || "unexpected error"}.`, "error");
  } finally {
    setLoading(encryptBtn, false, originalContent);
  }
}

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
  const noteBadge = document.getElementById("result-note-badge");
  const downloadBtn = document.getElementById("download-btn");
  const copyPayloadBtn = document.getElementById("copy-payload-btn");
  const copyPayloadText = document.getElementById("copy-payload-text");

  setupPasswordToggle(passwordInput, togglePassBtn, eyeIcon);

  function updateCharCount() {
    const count = plainTextInput.value.length;
    charCount.textContent = `${count} / 800`;
    if (count > 800) {
      charCount.className = "text-red-400 font-mono text-[11px] font-medium";
    } else {
      charCount.className = "text-zinc-500 font-mono text-[11px]";
    }
  }

  plainTextInput.addEventListener("input", updateCharCount);
  updateCharCount();

  const elements = { noteInput, plainTextInput, passwordInput, qrDiv, qrContainer, encryptBtn, noteBadge };

  encryptBtn.onclick = () => handleEncrypt(elements);

  plainTextInput.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      handleEncrypt(elements);
    }
  });

  passwordInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleEncrypt(elements);
    }
  });

  downloadBtn.onclick = () => {
    const canvas = qrDiv.querySelector("canvas");
    if (!canvas) return;
    const note = noteInput.value.trim();
    const filename = note ? `qr-cipher_${sanitizeNote(note)}.png` : "qr-cipher.png";
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = filename;
    a.click();
    showToast("QR code image downloaded.", "success");
  };

  copyPayloadBtn.onclick = () => {
    if (currentPayloadB64) {
      copyToClipboard(currentPayloadB64, copyPayloadText);
    }
  };
});
