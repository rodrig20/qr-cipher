import { argon2id } from "hash-wasm";

// --- Key derivation ---

export async function deriveKeys(password, salt, mode) {
  const material = await argon2id({
    password,
    salt,
    parallelism: 4,
    iterations: 6,
    memorySize: 262144,
    hashLength: 64,
    outputType: "binary",
  });

  const aesKey = material.slice(0, 32);
  const hmacRawKey = material.slice(32, 64);

  const key = await crypto.subtle.importKey(
    "raw",
    aesKey,
    { name: "AES-GCM", length: 256 },
    false,
    [mode],
  );

  const hmacKeyUsage = mode === "encrypt" ? "sign" : "verify";
  const hmacKey = await crypto.subtle.importKey(
    "raw",
    hmacRawKey,
    { name: "HMAC", hash: "SHA-256" },
    false,
    [hmacKeyUsage],
  );

  return { key, hmacKey };
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
  togglePassBtn.onclick = () => {
    const show = passwordInput.type === "password";
    passwordInput.type = show ? "text" : "password";
    eyeIcon.innerHTML = show ? EYE_OPEN_SVG : EYE_CLOSED_SVG;
  };
}

// --- Utility ---

export function setLoading(btn, loading, originalText) {
  if (loading) {
    btn.disabled = true;
    btn.textContent = "Processing...";
    btn.classList.add("opacity-50", "cursor-not-allowed");
  } else {
    btn.disabled = false;
    btn.textContent = originalText || btn.textContent;
    btn.classList.remove("opacity-50", "cursor-not-allowed");
  }
}
