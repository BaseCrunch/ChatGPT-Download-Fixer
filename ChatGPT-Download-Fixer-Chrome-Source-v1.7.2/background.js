(() => {
  const AUTO_DOWNLOAD_KEY = "chatgptDownloadHelper.autoDownloadEnabled";
  const DEDUPE_MS = 2500;
  const recent = new Map();

  function getRuntime() {
    return typeof browser !== "undefined" ? browser : chrome;
  }
  const runtimeApi = getRuntime();

  async function getStoredValue(key, fallback) {
    const data = await runtimeApi.storage.local.get(key);
    return key in data ? data[key] : fallback;
  }

  async function ensureDefaults() {
    const data = await runtimeApi.storage.local.get(AUTO_DOWNLOAD_KEY);
    if (!(AUTO_DOWNLOAD_KEY in data)) {
      await runtimeApi.storage.local.set({ [AUTO_DOWNLOAD_KEY]: true });
    }
  }

  if (runtimeApi.runtime && runtimeApi.runtime.onInstalled) {
    runtimeApi.runtime.onInstalled.addListener(() => { ensureDefaults(); });
  }
  ensureDefaults();

  async function isAutoDownloadEnabled() {
    return !!(await getStoredValue(AUTO_DOWNLOAD_KEY, true));
  }

  function shouldSkipDuplicate(url) {
    const now = Date.now();
    const last = recent.get(url) || 0;
    recent.set(url, now);

    for (const [key, ts] of recent.entries()) {
      if (now - ts > DEDUPE_MS) recent.delete(key);
    }
    return now - last < DEDUPE_MS;
  }

  function extractFilename(entry) {
    try {
      const source = entry && entry.sourceRequestUrl ? new URL(entry.sourceRequestUrl) : null;
      const sandboxPath = source ? source.searchParams.get("sandbox_path") : "";
      const name = sandboxPath ? sandboxPath.split("/").pop() : "";
      return name || undefined;
    } catch (_) {
      return undefined;
    }
  }

  function downloadViaApi(options) {
    return new Promise((resolve, reject) => {
      try {
        if (typeof browser !== "undefined" && browser.downloads && browser.downloads.download) {
          browser.downloads.download(options).then(resolve, reject);
          return;
        }
        chrome.downloads.download(options, (downloadId) => {
          const err = chrome.runtime && chrome.runtime.lastError;
          if (err) reject(new Error(err.message));
          else resolve(downloadId);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  runtimeApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.type !== "CHATGPT_DOWNLOAD_HELPER_AUTO_DOWNLOAD") {
      return false;
    }

    (async () => {
      const entry = message.entry || {};
      const enabled = await isAutoDownloadEnabled();

      if (!enabled) {
        sendResponse({ ok: true, downloaded: false, reason: "auto-download-disabled" });
        return;
      }

      if (!entry.url || typeof entry.url !== "string") {
        sendResponse({ ok: false, downloaded: false, reason: "missing-url" });
        return;
      }

      if (shouldSkipDuplicate(entry.url)) {
        sendResponse({ ok: true, downloaded: false, reason: "duplicate-suppressed" });
        return;
      }

      const filename = extractFilename(entry);

      try {
        const downloadId = await downloadViaApi({
          url: entry.url,
          saveAs: false,
          conflictAction: "uniquify",
          filename
        });

        sendResponse({
          ok: true,
          downloaded: true,
          reason: "auto-downloaded",
          downloadId,
          filename: filename || null
        });
      } catch (error) {
        sendResponse({
          ok: false,
          downloaded: false,
          reason: "download-api-failed",
          error: String((error && error.message) || error)
        });
      }
    })();

    return true;
  });
})();