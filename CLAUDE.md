# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Debug Dump** — a Chrome Extension (Manifest v3) for one-click page state capture. Dumps HTML, console logs, network HAR (DevTools panel only), metadata, and full-page screenshots into organized folders via `chrome.downloads`.

## Development

No build system — pure vanilla JavaScript loaded directly by the manifest. To develop:

1. Open `chrome://extensions/` with Developer Mode enabled
2. "Load unpacked" pointing to the `src/` directory
3. After code changes, click the refresh icon on the extension card (or reload the extension)

### Testing

- **Framework**: Jest (`npm test`)
- **Tests**: `tests/console-hook.test.js` — unit tests for the console hook injection
- **CI/CD**: GitHub Actions — PR checks run tests on every PR to `develop`; release pipeline builds zip + GitHub Release on tag push

## Architecture

### Popup (`src/popup/popup.html` / `popup.js`)
- Settings + capture toggles UI triggered via the extension icon
- Configures `basePath`, `idleTime`, and `dumpToggles` in `chrome.storage.local` (shared with DevTools panel)

### DevTools Panel (`src/devtools/panel.html` / `panel.js`)
- Accessed via F12 → "Debug Dump" tab — the only place dumps happen
- Uses `chrome.devtools.inspectedWindow.eval()` for script injection
- Captures HAR via `chrome.devtools.network.getHAR()`
- Monitors network idle via `chrome.devtools.network.onRequestFinished` before collecting data
- Listens to `chrome.storage.onChanged` to pick up settings/toggles changed via popup and keyboard shortcut triggers
- Downloads files directly via `chrome.downloads.download()` (bypasses 64MB `sendMessage` limit)

### Supporting Files
- **`src/devtools/devtools.js`** — Creates the DevTools panel, injects the console hook (inline via `eval`) on panel show and page navigation
- **`src/service-worker.js`** — Background worker handling `captureViewport` (tab screenshot) messages; relays keyboard shortcut via `chrome.storage.local.set`

### Key Technical Details
- **Screenshot stitching**: Scrolls page in viewport-sized chunks, hides fixed elements (visibility:hidden) and un-sticks sticky elements (position:relative) for chunks after the first, then composites via canvas accounting for device pixel ratio
- **Max screenshot height**: 16384px
- **Downloads**: Panel calls `chrome.downloads.download()` directly; monitors completion via `chrome.downloads.onChanged` (listener registered before download starts to avoid race conditions with instant data: URL completions)
- **Capture toggles**: 5 toggleable types (har, html, console, meta, screenshot) stored in `chrome.storage.local` as `dumpToggles`; disabled types are skipped in `performCapture()` and shown as yellow "skipped" in progress chips
- **Clipboard**: DevTools panels block `navigator.clipboard`; workaround uses `chrome.devtools.inspectedWindow.eval()` to write clipboard via the inspected page
- **Keyboard shortcut**: `chrome.storage.local.set({ triggerDump })` from service worker; `devtools.js` listens via `storage.onChanged` and relays to panel; works only with DevTools open
- **Settings** stored in `chrome.storage.local`: `basePath` (download folder), `idleTime` (wait seconds), `dumpToggles` (capture type toggles)

## File Map

| File | Role |
|------|------|
| `src/manifest.json` | Extension manifest (permissions, entry points) |
| `src/service-worker.js` | Background: tab screenshots & keyboard shortcut relay |
| `src/panel.css` | Shared dark-theme styling |
| `src/popup/popup.html/js` | Settings UI (shared with panel) |
| `src/devtools/panel.html/js` | DevTools panel UI, dump logic & file downloads |
| `src/devtools/devtools.html/js` | DevTools page, panel creation & console hook injection |
| `tests/console-hook.test.js` | Unit tests for the console hook |
| `package.json` | Dev dependencies (Jest) and test script |
| `.github/workflows/pr.yml` | CI: runs tests on PRs to develop |
| `.github/workflows/release.yml` | CD: builds zip & creates GitHub Release on tag push |
| `.github/release.yml` | Auto-generated release notes configuration |
