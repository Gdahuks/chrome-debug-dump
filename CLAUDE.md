# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Debug Dump** — a Chrome Extension (Manifest v3) for one-click page state capture. Dumps HTML, console logs, network HAR (DevTools panel only), metadata, and full-page screenshots into organized folders via `chrome.downloads`.

## Development

No build system, package manager, or dependencies. Pure vanilla JavaScript loaded directly by the manifest. To develop:

1. Open `chrome://extensions/` with Developer Mode enabled
2. "Load unpacked" pointing to the `src/` directory
3. After code changes, click the refresh icon on the extension card (or reload the extension)

No tests, linting, or formatting tools are configured.

## Architecture

### Popup (`src/popup/popup.html` / `popup.js`)
- Settings-only UI triggered via the extension icon
- Configures `basePath` and `idleTime` in `chrome.storage.local` (shared with DevTools panel)

### DevTools Panel (`src/devtools/panel.html` / `panel.js`)
- Accessed via F12 → "Debug Dump" tab — the only place dumps happen
- Uses `chrome.devtools.inspectedWindow.eval()` for script injection
- Captures HAR via `chrome.devtools.network.getHAR()`
- Monitors network idle via `chrome.devtools.network.onRequestFinished` before collecting data
- Listens to `chrome.storage.onChanged` to pick up settings changed via popup

### Supporting Files
- **`src/devtools/devtools.js`** — Creates the DevTools panel, injects the console hook (inline via `eval`) on panel show and page navigation
- **`src/service-worker.js`** — Background worker handling `captureViewport` (tab screenshot) and `dumpAll` (file downloads) messages

### Key Technical Details
- **Screenshot stitching**: Scrolls page in viewport-sized chunks, hides fixed elements (visibility:hidden) and un-sticks sticky elements (position:relative) for chunks after the first, then composites via canvas accounting for device pixel ratio
- **Max screenshot height**: 16384px
- **Downloads**: Uses direct `chrome.downloads.download()` to bypass the 64MB `sendMessage` limit; monitors completion via `chrome.downloads.onChanged`
- **Settings** stored in `chrome.storage.local`: `basePath` (download folder), `popupDelay`/`idleTime` (wait seconds)

## File Map

| File | Role |
|------|------|
| `src/manifest.json` | Extension manifest (permissions, entry points) |
| `src/service-worker.js` | Background: screenshots & file downloads |
| `src/panel.css` | Shared dark-theme styling |
| `src/popup/popup.html/js` | Settings UI (shared with panel) |
| `src/devtools/panel.html/js` | DevTools panel UI & dump logic |
| `src/devtools/devtools.html/js` | DevTools page & panel creation |
