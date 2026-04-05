# QR Cipher

Encrypt text into password-protected QR codes and decrypt them back (all locally in your browser).

## Features

- Password-based encryption with AES-256-GCM
- Key derivation via Argon2id (memory-hard, brute-force resistant)
- HMAC-SHA256 integrity tag (verifies password correctness before decryption)
- QR code generation with high error correction (Level H)
- Optional note/title field for labeling your encrypted QR codes
- Camera support for scanning QR images
- Download generated QR codes as PNG

## Quick Start

```bash
npm install
npm run dev
```

Open the dev server URL and you're good to go.

## How It Works

1. **Encrypt** — enter your text and password, a QR code is generated
2. **Decrypt** — upload or scan the QR image, enter the password, see the text

The password goes through Argon2id (128 MB, 4 threads) to derive two keys: one for AES-256-GCM encryption and one for HMAC-SHA256 integrity verification. The HMAC is checked before decryption, so a wrong password fails fast without attempting to decrypt.


## Building for Production

```bash
npm run build
npm run preview
```

The output goes to `dist/` — ready to deploy anywhere as static files.
