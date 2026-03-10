# ChatGPT Download Helper for Firefox

A lightweight Firefox extension that captures ChatGPT-generated file `download_url` values from network responses so you can open or copy the real file URL when normal downloads fail.

## Why this exists

Sometimes ChatGPT file downloads fail in the browser even though the file was generated successfully.  
This extension helps by watching the page’s network activity, detecting the JSON response that contains `download_url`, and surfacing that URL in the extension popup.

## Features

- Captures ChatGPT file `download_url` values
- Works on `chatgpt.com`
- Popup UI to:
  - View the latest captured URL
  - Copy the URL
  - Open the URL in a new tab
- Uses page-script injection so it can observe the page’s real `fetch` and `XMLHttpRequest` traffic

## How it works

ChatGPT file downloads often happen in two steps:

1. The page makes a request to an internal endpoint such as:
   `/backend-api/conversation/.../interpreter/download`

2. That endpoint returns JSON containing a field like:
   `download_url`

3. The actual file is downloaded from that returned URL

This extension captures that `download_url` and stores the latest one so you can access it from the popup.

## Project structure

```text
chatgpt_download_helper_firefox/
├── manifest.json
├── content.js
├── injected.js
├── popup.html
├── popup.js
└── README.md
```

### File overview

- `manifest.json`  
  Defines the extension, permissions, popup, content script, and Firefox compatibility settings.

- `content.js`  
  Runs on the ChatGPT page. Injects the page-level script and listens for captured URLs sent back from the page.

- `injected.js`  
  Runs in the actual page context. Hooks into `fetch` and `XMLHttpRequest`, scans responses, and detects `download_url`.

- `popup.html`  
  The popup interface shown when you click the extension icon.

- `popup.js`  
  Loads the saved URL into the popup and handles Copy / Open / Refresh actions.

## Installation

### Temporary install in Firefox

This is the easiest method for local testing.

1. Download or extract the extension folder
2. Open Firefox
3. Go to `about:debugging#/runtime/this-firefox`
4. Click **Load Temporary Add-on**
5. Select the `manifest.json` file inside the extension folder

### Install from XPI

If you packaged the extension as an `.xpi` file:

1. Open Firefox
2. Go to `about:addons`
3. Click the gear icon
4. Choose **Install Add-on From File...**
5. Select the `.xpi` file

## Usage

1. Open `https://chatgpt.com`
2. Generate or locate a downloadable file in ChatGPT
3. Click the normal download link
4. Click the extension icon
5. The popup should display the most recent captured `download_url`
6. Choose one of the following:
   - **Copy URL** to copy it to your clipboard
   - **Open URL** to open the real file link in a new tab
   - **Refresh** to reload the latest saved value in the popup

## Permissions

### `storage`
Used to save the latest captured `download_url` so the popup can read it.

### `tabs`
Used so the popup can open the captured URL in a new browser tab.

### Host permission: `https://chatgpt.com/*`
Required so the extension can run on ChatGPT pages and observe download-related network responses there.

## Technical details

### Why `content.js` alone is not enough

Browser extensions run content scripts in an isolated world.  
That means overriding `window.fetch` or `XMLHttpRequest` directly inside a content script often does **not** affect the page’s real JavaScript environment.

To solve that, this extension:

1. Injects `injected.js` into the page
2. Hooks the page’s real `fetch` and `XMLHttpRequest`
3. Detects JSON containing `download_url`
4. Sends the detected URL back using `window.postMessage`
5. Saves it with extension storage

### Response detection strategy

The script tries two approaches:

1. Parse the response as JSON and check for:
   - `download_url`

2. If JSON parsing fails, use a regex fallback to search raw text for:
   - `"download_url": "..."`

This makes detection more resilient if the response formatting changes slightly.

## Limitations

- The captured URL may expire quickly
- If ChatGPT changes its internal response format, the extension may need updates
- The extension only stores the most recent captured URL
- It depends on ChatGPT returning a response that contains `download_url`

## Troubleshooting

### Popup says “No download URL captured yet”
Possible causes:

- You did not click a ChatGPT file download yet
- The request did not return a `download_url`
- The page was already open before installing the extension and needs a refresh
- ChatGPT changed its internal download flow

Try:
1. Refresh the ChatGPT page
2. Click the file download again
3. Reopen the popup
4. Check the browser console for logs

### The captured link does not work
Possible causes:

- The `download_url` expired
- The file backing the download expired on the server side
- You waited too long before opening it

Try again with a newly generated file.

### The extension loads but still captures nothing
Try:
1. Remove the old extension version
2. Reinstall the new version
3. Refresh ChatGPT completely
4. Retry the download immediately

## Security notes

- Do not share session tokens, cookies, or authorization headers
- This extension is intended for your own local browser use
- It only captures download URLs on ChatGPT pages
- Review the source code before installing if you plan to distribute it

## Development

### Edit the extension
Modify:
- `injected.js` for network capture logic
- `content.js` for storage and page-to-extension messaging
- `popup.html` and `popup.js` for popup UI behavior

### Reload after changes
In Firefox temporary add-on mode:
1. Go back to `about:debugging#/runtime/this-firefox`
2. Click **Reload** on the extension

## Roadmap

- Add on-page “Copy latest download URL” button
- Add history of recently captured URLs
- Add better filtering so only ChatGPT file-download responses are captured
- Add export/debug mode for troubleshooting

## Disclaimer

This project is an unofficial utility for personal troubleshooting and is not affiliated with or endorsed by OpenAI.

## License

MIT
