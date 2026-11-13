import { argon2id } from "../vendor/hash-wasm.js";

// --- Key derivation ---

export async function deriveKeys(password, salt, mode) {
  const material = await argon2id({
    password,
    salt,
    parallelism: 4,
    iterations: 6,
    memorySize: 262144,
    hashLength: 32,
    outputType: "binary",
  });

  const key = await crypto.subtle.importKey(
    "raw",
    material,
    { name: "AES-GCM", length: 256 },
    false,
    [mode],
  );

  return { key };
}

// --- Password visibility toggle ---

export const EYE_OPEN_SVG = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
           d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
         <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
           d="M2.458 12C3.732 7.943 7.523 5 12 5
              c4.477 0 8.268 2.943 9.542 7
              -1.274 4.057-5.065 7-9.542 7
              -4.477 0-8.268-2.943-9.542-7z"/>`;

export const EYE_CLOSED_SVG = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
           d="M13.875 18.825A10.05 10.05 0 0112 19c-4.477 0-8.268-2.943-9.542-7
              a10.05 10.05 0 012.107-3.444m2.401-2.401
              A9.953 9.953 0 0112 5c4.477 0 8.268 2.943
              9.542 7a9.953 9.953 0 01-1.091 2.181
              M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
         <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
           d="M3 3l18 18"/>`;

export function setupPasswordToggle(passwordInput, togglePassBtn, eyeIcon) {
  if (!passwordInput || !togglePassBtn || !eyeIcon) return;
  togglePassBtn.onclick = (e) => {
    e.preventDefault();
    const show = passwordInput.type === "password";
    passwordInput.type = show ? "text" : "password";
    eyeIcon.innerHTML = show ? EYE_OPEN_SVG : EYE_CLOSED_SVG;
  };
}

// --- Base45 encoding (QR alphanumeric-compatible, no Node dependency) ---

// Base45 alphabet matches the QR Code alphanumeric charset, so the QR library
// renders the encoded output in alphanumeric mode.
const BASE45_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*./+-:";
const BASE45_RADIX = 45;
const BASE45_SQUARE = BASE45_RADIX * BASE45_RADIX;

export function base45Encode(buf) {
  const out = [];
  for (let i = 0; i < buf.length; i += 2) {
    const x = (buf[i] << 8) | buf[i + 1];
    out.push(BASE45_ALPHABET[Math.floor(x / BASE45_SQUARE)]);
    out.push(BASE45_ALPHABET[Math.floor((x % BASE45_SQUARE) / BASE45_RADIX)]);
    out.push(BASE45_ALPHABET[x % BASE45_RADIX]);
  }
  return out.join("");
}

export function base45Decode(text) {
  const out = [];
  for (let i = 0; i < text.length; i += 3) {
    const a = BASE45_ALPHABET.indexOf(text[i]);
    const b = BASE45_ALPHABET.indexOf(text[i + 1]);
    const c = BASE45_ALPHABET.indexOf(text[i + 2]);
    if (a < 0 || b < 0 || c < 0) throw new Error("base45: invalid character");
    const v = a * BASE45_SQUARE + b * BASE45_RADIX + c;
    out.push((v >> 8) & 0xff, v & 0xff);
  }
  return new Uint8Array(out);
}

// Sanitize note to QR alphanumeric-safe characters only:
// A-Z, a-z, 0-9 and space. Everything else is removed.
export function sanitizeNote(note) {
  return note.replace(/[^A-Za-z0-9 ]/g, "");
}

// --- Utility & Feedback ---

export function setLoading(btn, loading, originalText) {
  if (!btn) return;
  if (loading) {
    btn.disabled = true;
    btn.dataset.originalContent = btn.innerHTML;
    btn.textContent = originalText || "Processing...";
    btn.classList.add("opacity-50", "cursor-not-allowed");
  } else {
    btn.disabled = false;
    btn.innerHTML = btn.dataset.originalContent || originalText || "Submit";
    btn.classList.remove("opacity-50", "cursor-not-allowed");
  }
}

export function showToast(message, type = "info") {
  let toastContainer = document.getElementById("toast-container");
  if (!toastContainer) {
    toastContainer = document.createElement("div");
    toastContainer.id = "toast-container";
    toastContainer.className = "fixed bottom-5 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2 pointer-events-none px-4 w-full max-w-sm";
    document.body.appendChild(toastContainer);
  }

  const toast = document.createElement("div");
  toast.className = "flex items-center gap-2 px-3 py-2 rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-200 text-xs shadow-lg transition-all duration-200 transform translate-y-1 opacity-0 pointer-events-auto font-medium";
  
  toast.textContent = message;
  toastContainer.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.remove("translate-y-1", "opacity-0");
  });

  setTimeout(() => {
    toast.classList.add("opacity-0", "translate-y-1");
    setTimeout(() => toast.remove(), 200);
  }, 2500);
}

export async function copyToClipboard(text, feedbackElement) {
  try {
    await navigator.clipboard.writeText(text);
    if (feedbackElement) {
      const orig = feedbackElement.textContent;
      feedbackElement.textContent = "Copied!";
      setTimeout(() => {
        feedbackElement.textContent = orig;
      }, 1500);
    }
    showToast("Copied to clipboard.", "success");
  } catch (err) {
    showToast("Failed to copy text.", "error");
  }
}

export function playFeedbackTone() {
  try {
    if (navigator.vibrate) {
      navigator.vibrate(50);
    }
  } catch (e) {
    // ignore
  }
}
