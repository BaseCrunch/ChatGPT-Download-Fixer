(() => {
  const STORAGE_KEY = "chatgptDownloadHelper.entries";
  const DEBUG_KEY = "chatgptDownloadHelper.debugEnabled";
  const DEBUG_LOG_KEY = "chatgptDownloadHelper.debugLog";
  const AUTO_DOWNLOAD_KEY = "chatgptDownloadHelper.autoDownloadEnabled";
  const MAX_HISTORY = 15;
  const MAX_DEBUG_LOG = 60;
  const ROOT_ID = "chatgpt-download-helper-overlay";
  const STYLE_ID = "chatgpt-download-helper-overlay-style";
  const TOAST_MS = 1900;

  function getRuntime() {
    return typeof browser !== 'undefined' ? browser : chrome;
  }
  const runtimeApi = getRuntime();

  function injectPageScript() {
    const script = document.createElement("script");
    script.src = runtimeApi.runtime.getURL("injected.js");
    script.dataset.extension = "chatgpt-download-helper-v171";
    (document.documentElement || document.head || document.body).appendChild(script);
    script.onload = () => script.remove();
  }

  async function getStoredValue(key, fallback) {
    const data = await runtimeApi.storage.local.get(key);
    return key in data ? data[key] : fallback;
  }

  async function loadEntries() {
    const entries = await getStoredValue(STORAGE_KEY, []);
    return Array.isArray(entries) ? entries : [];
  }

  async function saveEntries(entries) {
    await runtimeApi.storage.local.set({ [STORAGE_KEY]: entries });
  }

  async function loadDebugLog() {
    const items = await getStoredValue(DEBUG_LOG_KEY, []);
    return Array.isArray(items) ? items : [];
  }

  async function saveDebugLog(items) {
    await runtimeApi.storage.local.set({ [DEBUG_LOG_KEY]: items });
  }

  async function isDebugEnabled() {
    return !!(await getStoredValue(DEBUG_KEY, false));
  }

  async function isAutoDownloadEnabled() {
    return !!(await getStoredValue(AUTO_DOWNLOAD_KEY, true));
  }

  async function appendDebugEvent(event) {
    const log = await loadDebugLog();
    log.unshift(event);
    await saveDebugLog(log.slice(0, MAX_DEBUG_LOG));
  }


  async function triggerAutoDownload(entry) {
    try {
      const response = await runtimeApi.runtime.sendMessage({
        type: 'CHATGPT_DOWNLOAD_HELPER_AUTO_DOWNLOAD',
        entry
      });
      return response || { ok: false, downloaded: false, reason: 'no-response' };
    } catch (error) {
      return { ok: false, downloaded: false, reason: 'message-failed', error: String((error && error.message) || error) };
    }
  }

  async function saveEntry(entry) {
    const entries = await loadEntries();
    const deduped = entries.filter((item) => item.url !== entry.url);
    deduped.unshift(entry);
    const trimmed = deduped.slice(0, MAX_HISTORY);
    await saveEntries(trimmed);
    console.log("[ChatGPT Download Helper] Captured filtered download_url:", entry);
    return trimmed;
  }

  function syncDebugSettingToPage(enabled) {
    window.postMessage({ type: 'CHATGPT_DOWNLOAD_HELPER_DEBUG_SETTING', enabled: !!enabled }, '*');
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${ROOT_ID} {
        position: fixed;
        right: 18px;
        bottom: 18px;
        z-index: 2147483647;
        display: none;
        flex-direction: column;
        gap: 10px;
        align-items: flex-end;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #${ROOT_ID}.visible { display: flex; }
      #${ROOT_ID} .cdh-card {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px;
        border-radius: 18px;
        background: linear-gradient(180deg, rgba(15,23,42,0.94), rgba(17,24,39,0.90));
        border: 1px solid rgba(96,165,250,0.22);
        box-shadow: 0 18px 40px rgba(2,6,23,0.46);
        backdrop-filter: blur(12px);
      }
      #${ROOT_ID} .cdh-button {
        appearance: none;
        border: 1px solid transparent;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.08);
        color: #fff;
        padding: 10px 12px;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
        transition: background 120ms ease, transform 120ms ease, border-color 120ms ease;
        white-space: nowrap;
      }
      #${ROOT_ID} .cdh-button:hover { background: rgba(255,255,255,0.14); border-color: rgba(96,165,250,0.22); }
      #${ROOT_ID} .cdh-button:active { transform: translateY(1px); }
      #${ROOT_ID} .cdh-button.primary {
        background: linear-gradient(180deg, rgba(37,99,235,0.97), rgba(29,78,216,0.94));
      }
      #${ROOT_ID} .cdh-button.primary:hover {
        background: linear-gradient(180deg, rgba(59,130,246,0.98), rgba(37,99,235,0.96));
      }
      #${ROOT_ID} .cdh-meta {
        max-width: 300px;
        color: rgba(224,231,255,0.82);
        font-size: 11px;
        line-height: 1.4;
      }
      #${ROOT_ID} .cdh-toast {
        max-width: 320px;
        padding: 10px 12px;
        border-radius: 14px;
        background: rgba(2, 6, 23, 0.92);
        color: #eff6ff;
        font-size: 12px;
        border: 1px solid rgba(96,165,250,0.22);
        box-shadow: 0 12px 30px rgba(2,6,23,0.38);
        opacity: 0;
        transform: translateY(6px);
        transition: opacity 140ms ease, transform 140ms ease;
        pointer-events: none;
      }
      #${ROOT_ID} .cdh-toast.visible { opacity: 1; transform: translateY(0); }
      @media (max-width: 720px) {
        #${ROOT_ID} { right: 12px; bottom: 12px; left: 12px; align-items: stretch; }
        #${ROOT_ID} .cdh-card { justify-content: space-between; }
        #${ROOT_ID} .cdh-meta { display: none; }
      }
    `;
    document.documentElement.appendChild(style);
  }

  let root, copyBtn, openBtn, metaEl, toastEl, toastTimer;

  function ensureOverlay() {
    if (root && document.contains(root)) return root;
    ensureStyles();

    root = document.createElement('div');
    root.id = ROOT_ID;

    const card = document.createElement('div');
    card.className = 'cdh-card';

    copyBtn = document.createElement('button');
    copyBtn.className = 'cdh-button primary';
    copyBtn.textContent = 'Copy latest URL';
    copyBtn.addEventListener('click', async () => {
      const latest = await getLatestEntry();
      if (!latest) return showToast('No captured download URL yet.');
      try {
        await navigator.clipboard.writeText(latest.url);
        showToast('Copied latest download URL.');
      } catch (_) {
        showToast('Clipboard copy failed. Use the popup instead.');
      }
    });

    openBtn = document.createElement('button');
    openBtn.className = 'cdh-button';
    openBtn.textContent = 'Open latest';
    openBtn.addEventListener('click', async () => {
      const latest = await getLatestEntry();
      if (!latest) return showToast('No captured download URL yet.');
      window.open(latest.url, '_blank', 'noopener,noreferrer');
      showToast('Opened latest download URL.');
    });

    metaEl = document.createElement('div');
    metaEl.className = 'cdh-meta';
    metaEl.textContent = 'Waiting for a ChatGPT file download...';

    card.append(copyBtn, openBtn, metaEl);
    toastEl = document.createElement('div');
    toastEl.className = 'cdh-toast';

    root.append(card, toastEl);
    document.documentElement.appendChild(root);
    return root;
  }

  function showToast(message) {
    ensureOverlay();
    toastEl.textContent = message;
    toastEl.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('visible'), TOAST_MS);
  }

  function formatTimestamp(value) {
    if (!value) return 'Unknown time';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  async function getLatestEntry() {
    const entries = await loadEntries();
    return entries[0] || null;
  }

  function setOverlayVisibility(visible) {
    ensureOverlay();
    root.classList.toggle('visible', !!visible);
  }

  function updateOverlay(entry) {
    ensureOverlay();
    if (!entry) {
      metaEl.textContent = 'Waiting for a ChatGPT file download...';
      setOverlayVisibility(false);
      return;
    }
    metaEl.textContent = `${formatTimestamp(entry.capturedAt)} · ${entry.confidence || 'unknown'} · ${entry.matchedBy || 'unknown'}`;
    setOverlayVisibility(true);
  }

  async function refreshOverlay() {
    updateOverlay(await getLatestEntry());
  }

  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || typeof data.type !== 'string') return;

    if (data.type === 'CHATGPT_DOWNLOAD_HELPER_CAPTURE') {
      if (!data.url || typeof data.url !== 'string') return;
      if (!data.sourceRequestUrl || typeof data.sourceRequestUrl !== 'string') return;

      const entry = {
        url: data.url,
        capturedAt: data.capturedAt || new Date().toISOString(),
        page: location.href,
        transport: data.transport || 'unknown',
        sourceRequestUrl: data.sourceRequestUrl,
        matchedBy: data.matchedBy || 'unknown',
        sourceCategory: data.sourceCategory || 'unknown',
        confidence: data.confidence || 'unknown',
        finalUrlType: data.finalUrlType || 'unknown',
        acceptedReason: data.acceptedReason || 'accepted',
        parseMode: data.parseMode || 'unknown'
      };
      const entries = await saveEntry(entry);
      updateOverlay(entries[0] || null);

      const autoEnabled = await isAutoDownloadEnabled();
      const autoResult = await triggerAutoDownload(entry);

      if (await isDebugEnabled()) {
        await appendDebugEvent({
          timestamp: entry.capturedAt,
          level: 'capture',
          reason: entry.acceptedReason,
          transport: entry.transport,
          matchedBy: entry.matchedBy,
          sourceCategory: entry.sourceCategory,
          confidence: entry.confidence,
          sourceRequestUrl: entry.sourceRequestUrl,
          downloadUrl: entry.url,
          finalUrlType: entry.finalUrlType,
          note: entry.parseMode,
          page: entry.page
        });

        await appendDebugEvent({
          timestamp: new Date().toISOString(),
          level: 'auto-download',
          reason: (autoResult && autoResult.reason) || 'no-result',
          transport: entry.transport,
          matchedBy: entry.matchedBy,
          sourceCategory: entry.sourceCategory,
          confidence: entry.confidence,
          sourceRequestUrl: entry.sourceRequestUrl,
          downloadUrl: entry.url,
          finalUrlType: entry.finalUrlType,
          note: JSON.stringify({
            enabled: !!autoEnabled,
            downloaded: !!(autoResult && autoResult.downloaded),
            error: autoResult && autoResult.error ? autoResult.error : null
          }),
          page: entry.page
        });
      }

      if (autoEnabled && autoResult && autoResult.downloaded) {
        showToast('Auto-downloaded latest file.');
      } else if (autoEnabled && autoResult && autoResult.reason === 'duplicate-suppressed') {
        showToast('Auto-download already triggered.');
      } else if (autoEnabled && autoResult && autoResult.reason === 'download-api-failed') {
        showToast('Auto-download failed. Use Open latest.');
      } else if (autoEnabled && autoResult && autoResult.reason === 'message-failed') {
        showToast('Auto-download background failed. Reload extension.');
      } else {
        showToast(`Captured ${entry.confidence || 'valid'} download URL.`);
      }
      return;
    }

    if (data.type === 'CHATGPT_DOWNLOAD_HELPER_DEBUG') {
      if (!(await isDebugEnabled())) return;
      await appendDebugEvent({
        timestamp: data.timestamp || new Date().toISOString(),
        level: data.level || 'debug',
        reason: data.reason || 'event',
        transport: data.transport || 'unknown',
        sourceRequestUrl: data.sourceRequestUrl || '',
        matchedBy: data.matchedBy || '',
        sourceCategory: data.sourceCategory || '',
        confidence: data.confidence || '',
        candidateUrl: data.candidateUrl || '',
        finalUrlType: data.finalUrlType || '',
        note: data.note || '',
        page: location.href
      });
    }
  });

  runtimeApi.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes[STORAGE_KEY]) {
      const nextEntries = Array.isArray(changes[STORAGE_KEY].newValue) ? changes[STORAGE_KEY].newValue : [];
      updateOverlay(nextEntries[0] || null);
    }
    if (changes[DEBUG_KEY]) {
      syncDebugSettingToPage(!!changes[DEBUG_KEY].newValue);
    }
  });

  async function init() {
    ensureOverlay();
    refreshOverlay();
    injectPageScript();
    syncDebugSettingToPage(await isDebugEnabled());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
