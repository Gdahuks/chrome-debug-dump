# Debug Dump

Chrome extension (Manifest v3) for one-click page state capture. Dumps HTML, console logs, network HAR, metadata, and a full-page screenshot into organized folders.

## Install

1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the `src/` directory

## Usage

1. Open DevTools (F12) on any page
2. Go to the **Debug Dump** tab
3. Click **Reload & Dump**

The extension reloads the page, waits for network activity to settle, then captures everything. After the dump completes, the output folder path is automatically copied to your clipboard.

You can skip the network idle wait at any time by clicking **Capture Now**.

## Settings

Available both in the DevTools panel and via the extension popup icon (they stay in sync):

- **Download subfolder** — subfolder name inside your Downloads directory (default: `debug-dumps`)
- **Network idle (s)** — how many seconds of no network activity to wait before capturing (default: `2`, set to `0` to skip waiting)

## Output

Files are saved to your Chrome Downloads folder under:

```
Downloads/<subfolder>/<hostname_path>-<timestamp>/
```

For example: `Downloads/debug-dumps/example.com_page-2026-02-11_14-30-00/`

Each folder contains:

| File | Contents |
|------|----------|
| `network.har` | Full network traffic (HAR format) |
| `page.html` | Page source after load |
| `console.json` | Captured `console.log/warn/error/info/debug` calls and uncaught exceptions |
| `meta.json` | URL, title, viewport size, scroll height, user agent, referrer, timestamp |
| `screenshot.jpg` | Full-page stitched screenshot (max 16384px height) |

## License

[Apache License 2.0](LICENSE)
