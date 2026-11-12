# Getting VESPR onto Windows computers

## What the desktop app is
A real app, not a window onto the website. The site and the app ship inside it (`web/`, copied by `npm run web`), served from the private `vespr-app://` address, so it opens instantly, even offline.
- **Sign-in and account calls** (`/auth`, `/api`) are passed to the VESPR server by the app's own process. The page never talks cross-site.
- **The live connection** goes straight to the server: `wss://` for the site in `defaults.json` (or the person's setting).
- **Links to anything else** (Stripe checkout, docs, GitHub) open in the person's browser.
- **The runner** (agents building and testing on this computer) works as before.

`defaults.json` holds the server a fresh install uses: `https://vespr.online` normally; the private test stack for test builds.

## 1. The recommended way: the Microsoft Store (MSIX), free signing
- `npm run dist:store` builds the MSIX.
- Microsoft signs it after its review, so there's no certificate to buy and no "Windows protected your PC" warning. Individual developer registration is free (since Sept 2025).
- **Before the first submission:** reserve the name in Partner Center, then copy its Package/Identity/Name and Publisher (`CN=...`) into `build.appx` in `package.json`. They're placeholders now.
- **Known build issue (2026-11-04):** on the laptop, electron-builder's bundled `makeappx.exe` won't start. First a "side-by-side configuration" error; then, with Microsoft's toolkit copy in the same cache folder, `spawn UNKNOWN`, although the same file runs from a clean folder. Fix to try next: build on the desktop with the Windows SDK installed, or point the build at the SDK's `makeappx.exe`.

## 2. The backup: the .exe installer (NSIS)
- `npm run dist:exe` builds `dist/VESPR Setup <version>.exe`. It's per-user, with no admin prompt.
- **Unsigned for now,** so Windows shows "Windows protected your PC" until people click **More info → Run anyway**, and the warning resets with every new version.
- **To sign it:** Microsoft Artifact Signing (about $9.99/month), or an OV certificate (about $220/year plus a hardware key). Signing builds publisher reputation across versions.
- **Use it for:** quick test builds, people who can't use the Store, and company trials (their IT can trust our own certificate).

## Test build
The private test stack (`vespr-teststack` on the Pi) serves the current test installer at `http://100.64.0.10:9700/downloads/VESPR-Setup.exe`. A test build has `{ "site": "http://100.64.0.10:9700" }` in `defaults.json`.
