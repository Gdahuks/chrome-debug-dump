# Debug Dump

Chrome extension for one-click page state capture. Dumps HTML, console logs, network HAR, metadata, and a full-page screenshot into organized folders.

## Install

1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the `src/` directory

## Usage

1. Open DevTools (F12) on any page
2. Go to the **Debug Dump** tab
3. Click **Reload & Dump**

The extension will reload the page, wait for network idle, then capture everything into your Downloads folder.

Settings (download subfolder, network idle timeout) can also be configured via the extension popup icon.

## Output

Each dump creates a timestamped folder containing:

- `network.har` — full network traffic
- `page.html` — page source after load
- `console.json` — captured console logs and errors
- `meta.json` — URL, title, viewport, user agent, etc.
- `screenshot.jpg` — full-page stitched screenshot

## License

[Apache License 2.0](LICENSE)
