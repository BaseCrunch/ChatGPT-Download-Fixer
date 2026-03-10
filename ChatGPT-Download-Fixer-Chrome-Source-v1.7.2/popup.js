const STORAGE_KEY = "chatgptDownloadHelper.entries";
const DEBUG_KEY = "chatgptDownloadHelper.debugEnabled";
const DEBUG_LOG_KEY = "chatgptDownloadHelper.debugLog";
const AUTO_DOWNLOAD_KEY = "chatgptDownloadHelper.autoDownloadEnabled";
const urlBox = document.getElementById("url");
const meta = document.getElementById("meta");
const status = document.getElementById("status");
const historyRoot = document.getElementById("history");
const debugRoot = document.getElementById("debugLog");
const historyCount = document.getElementById("historyCount");
const debugCount = document.getElementById("debugCount");
const debugToggle = document.getElementById("debugToggle");
const autoDownloadToggle = document.getElementById("autoDownloadToggle");
const historySearch = document.getElementById("historySearch");
let currentEntries = [];

function getRuntime() {
  return typeof browser !== 'undefined' ? browser : chrome;
}
const runtimeApi = getRuntime();

async function getEntries() {
  const data = await runtimeApi.storage.local.get(STORAGE_KEY);
  const entries = Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
  return entries.map((entry) => ({ pinned: false, ...entry }));
}

async function saveEntries(entries) {
  await runtimeApi.storage.local.set({ [STORAGE_KEY]: entries });
}

async function getDebugLog() {
  const data = await runtimeApi.storage.local.get(DEBUG_LOG_KEY);
  return Array.isArray(data[DEBUG_LOG_KEY]) ? data[DEBUG_LOG_KEY] : [];
}

async function getDebugEnabled() {
  const data = await runtimeApi.storage.local.get(DEBUG_KEY);
  return !!data[DEBUG_KEY];
}

async function getAutoDownloadEnabled() {
  const data = await runtimeApi.storage.local.get(AUTO_DOWNLOAD_KEY);
  return AUTO_DOWNLOAD_KEY in data ? !!data[AUTO_DOWNLOAD_KEY] : true;
}

function setStatus(text) {
  status.textContent = text;
  setTimeout(() => {
    if (status.textContent === text) status.textContent = "";
  }, 2500);
}

function parseDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatTimestamp(value) {
  const date = parseDate(value);
  return date ? date.toLocaleString() : (value || "Unknown time");
}

function formatRelativeTime(value) {
  const date = parseDate(value);
  if (!date) return "Unknown time";
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.max(0, Math.floor(diffMs / 1000));
  if (diffSec < 10) return "just now";
  if (diffSec < 60) return `${diffSec} sec ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hr ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay} day${diffDay === 1 ? '' : 's'} ago`;
}


function normalizeBadge(value) {
  return String(value || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function badgeHtml(value, kind = '') {
  if (!value) return '';
  const label = String(value).replace(/-/g, ' ');
  const cls = [kind ? `${kind}-${normalizeBadge(value)}` : '', 'badge'].filter(Boolean).join(' ');
  return `<span class="${cls}">${label}</span>`;
}

function entrySortValue(entry) {
  const date = parseDate(entry.capturedAt);
  return date ? date.getTime() : 0;
}

function sortEntries(entries) {
  return [...entries].sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    return entrySortValue(b) - entrySortValue(a);
  });
}

function findLatestCaptured(entries) {
  return [...entries].sort((a, b) => entrySortValue(b) - entrySortValue(a))[0] || null;
}

function fillLatest(entry) {
  if (!entry) {
    urlBox.value = "";
    meta.textContent = "No download URL captured yet.";
    return;
  }
  urlBox.value = entry.url;
  meta.innerHTML = [
    formatTimestamp(entry.capturedAt),
    badgeHtml(entry.confidence, 'confidence'),
    badgeHtml(entry.transport, 'transport'),
    badgeHtml(entry.matchedBy, 'type'),
    badgeHtml(entry.finalUrlType, 'type')
  ].filter(Boolean).join(' · ');
}

function matchesSearch(entry, term) {
  if (!term) return true;
  const haystack = [
    entry.url,
    entry.sourceRequestUrl,
    entry.matchedBy,
    entry.transport,
    entry.capturedAt,
    entry.sourceCategory,
    entry.confidence,
    entry.finalUrlType,
    entry.acceptedReason,
    entry.pinned ? 'pinned' : ''
  ].filter(Boolean).join(' ').toLowerCase();
  return haystack.includes(term);
}

async function copyText(value, message) {
  await navigator.clipboard.writeText(value);
  setStatus(message);
}

async function removeEntry(target) {
  const entries = await getEntries();
  const next = entries.filter((entry) => !(entry.url === target.url && entry.capturedAt === target.capturedAt));
  await saveEntries(next);
  await load();
  setStatus('Removed history item.');
}

async function togglePin(target) {
  const entries = await getEntries();
  const next = entries.map((entry) => {
    if (entry.url === target.url && entry.capturedAt === target.capturedAt) {
      return { ...entry, pinned: !entry.pinned };
    }
    return entry;
  });
  await saveEntries(next);
  await load();
  setStatus(target.pinned ? 'Unpinned history item.' : 'Pinned history item.');
}

function createHistoryItem(entry, isLatest) {
  const item = document.createElement("div");
  item.className = `history-item${isLatest ? " latest" : ""}${entry.pinned ? " pinned" : ""}`;

  const header = document.createElement('div');
  header.className = 'history-header';

  const headerMain = document.createElement('div');
  headerMain.className = 'history-header-main';

  const title = document.createElement('div');
  title.className = 'history-header-title';
  title.textContent = `${entry.pinned ? 'Pinned · ' : ''}${formatRelativeTime(entry.capturedAt)}`;
  title.title = formatTimestamp(entry.capturedAt);

  const preview = document.createElement('div');
  preview.className = 'history-preview';
  preview.textContent = entry.url;
  preview.title = entry.url;

  headerMain.append(title, preview);

  const badges = document.createElement('div');
  badges.className = 'history-meta';
  badges.innerHTML = [
    isLatest ? badgeHtml('latest', 'type') : '',
    entry.pinned ? badgeHtml('pinned', 'type') : '',
    badgeHtml(entry.transport || 'unknown', 'transport'),
    badgeHtml(entry.matchedBy || 'unmatched', 'type'),
    badgeHtml(entry.confidence || 'unknown', 'conf'),
    badgeHtml(entry.finalUrlType || 'unknown', 'type')
  ].filter(Boolean).join('');

  header.append(headerMain, badges);

  const actions = document.createElement("div");
  actions.className = "history-actions";

  const copyButton = document.createElement("button");
  copyButton.className = 'ghost';
  copyButton.textContent = "Copy";
  copyButton.addEventListener("click", async (event) => {
    event.stopPropagation();
    await copyText(entry.url, "Copied history item.");
  });

  const openButton = document.createElement("button");
  openButton.className = 'success';
  openButton.textContent = "Open";
  openButton.addEventListener("click", async (event) => {
    event.stopPropagation();
    await runtimeApi.tabs.create({ url: entry.url });
  });

  const pinButton = document.createElement("button");
  pinButton.className = 'ghost';
  pinButton.textContent = entry.pinned ? "Unpin" : "Pin";
  pinButton.addEventListener("click", async (event) => {
    event.stopPropagation();
    await togglePin(entry);
  });

  const detailsButton = document.createElement("button");
  detailsButton.className = 'primary';
  detailsButton.textContent = "Details";
  detailsButton.addEventListener("click", (event) => {
    event.stopPropagation();
    item.classList.toggle('expanded');
    detailsButton.textContent = item.classList.contains('expanded') ? 'Hide details' : 'Details';
  });

  const removeButton = document.createElement("button");
  removeButton.className = 'danger';
  removeButton.textContent = "Remove";
  removeButton.addEventListener("click", async (event) => {
    event.stopPropagation();
    await removeEntry(entry);
  });

  actions.append(copyButton, openButton, pinButton, detailsButton, removeButton);

  const details = document.createElement('div');
  details.className = 'history-details';
  for (const [label, value] of [
    ['Captured', `${formatTimestamp(entry.capturedAt)} (${formatRelativeTime(entry.capturedAt)})`],
    ['Download URL', entry.url],
    ['Source request URL', entry.sourceRequestUrl || 'Unknown source'],
    ['Transport', entry.transport || 'unknown'],
    ['Match type', entry.matchedBy || 'unknown'],
    ['Source category', entry.sourceCategory || 'unknown'],
    ['Confidence', entry.confidence || 'unknown'],
    ['Final URL type', entry.finalUrlType || 'unknown'],
    ['Accepted reason', entry.acceptedReason || 'accepted'],
    ['Parse mode', entry.parseMode || 'unknown']
  ]) {
    const row = document.createElement('div');
    row.className = 'history-detail-row';
    const l = document.createElement('span');
    l.className = 'history-detail-label';
    l.textContent = label;
    const t = document.createElement('div');
    t.className = 'history-detail-text';
    t.textContent = value;
    row.append(l, t);
    details.appendChild(row);
  }

  item.append(header, actions, details);
  return item;
}

function renderHistory(entries) {
  historyRoot.innerHTML = "";
  const term = historySearch.value.trim().toLowerCase();
  const sorted = sortEntries(entries);
  const latestCaptured = findLatestCaptured(entries);
  const filtered = sorted.filter((entry) => matchesSearch(entry, term));
  historyCount.textContent = String(filtered.length);

  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No captured download URLs yet. Trigger a ChatGPT file download to get started.";
    historyRoot.appendChild(empty);
    return;
  }

  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No matching history items found.";
    historyRoot.appendChild(empty);
    return;
  }

  filtered.forEach((entry) => historyRoot.appendChild(createHistoryItem(entry, latestCaptured && entry.url === latestCaptured.url && entry.capturedAt === latestCaptured.capturedAt)));
}

function createDebugItem(entry) {
  const item = document.createElement('div');
  item.className = `debug-item ${entry.level || 'debug'}`;

  const row = document.createElement('div');
  row.className = 'debug-row';

  const metaLine = document.createElement('div');
  metaLine.className = 'debug-meta';
  metaLine.textContent = `${formatTimestamp(entry.timestamp)} · ${entry.reason || 'event'}`;

  const reason = document.createElement('div');
  reason.className = 'debug-reason';
  reason.innerHTML = [
    badgeHtml(entry.level || 'debug', entry.level || 'debug'),
    entry.transport ? badgeHtml(entry.transport, 'transport') : '',
    entry.matchedBy ? badgeHtml(entry.matchedBy, 'type') : '',
    entry.confidence ? badgeHtml(entry.confidence, 'conf') : '',
    entry.finalUrlType ? badgeHtml(entry.finalUrlType, 'type') : ''
  ].filter(Boolean).join('');

  row.append(metaLine, reason);

  const text = document.createElement('div');
  text.className = 'debug-text';
  const parts = [];
  if (entry.sourceCategory) parts.push(`sourceCategory=${entry.sourceCategory}`);
  if (entry.sourceRequestUrl) parts.push(`source=${entry.sourceRequestUrl}`);
  if (entry.downloadUrl) parts.push(`download=${entry.downloadUrl}`);
  if (entry.candidateUrl) parts.push(`candidate=${entry.candidateUrl}`);
  if (entry.note) parts.push(`note=${entry.note}`);
  text.textContent = parts.join(' | ') || 'No extra debug details.';

  item.append(row, text);
  return item;
}

function renderDebugLog(items, enabled) {
  debugRoot.innerHTML = "";
  debugCount.textContent = String(items.length);

  if (!enabled) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'Debug mode is off. Turn it on to record skip reasons and inspection details.';
    debugRoot.appendChild(empty);
    return;
  }

  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'Debug mode is on, but no debug events have been recorded yet.';
    debugRoot.appendChild(empty);
    return;
  }

  items.forEach((entry) => debugRoot.appendChild(createDebugItem(entry)));
}

async function load() {
  const [entries, debugLog, debugEnabled, autoDownloadEnabled] = await Promise.all([
    getEntries(),
    getDebugLog(),
    getDebugEnabled(),
    getAutoDownloadEnabled()
  ]);
  currentEntries = entries;
  fillLatest(findLatestCaptured(entries));
  renderHistory(entries);
  renderDebugLog(debugLog, debugEnabled);
  debugToggle.checked = debugEnabled;
  autoDownloadToggle.checked = autoDownloadEnabled;
}

async function exportJson() {
  const [entries, debugLog, debugEnabled] = await Promise.all([getEntries(), getDebugLog(), getDebugEnabled()]);
  const payload = {
    version: '1.7.2',
    exportedAt: new Date().toISOString(),
    debugEnabled,
    entries,
    debugLog
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `chatgpt-download-helper-export-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  setStatus('Exported JSON.');
}

async function clearHistory() {
  await runtimeApi.storage.local.set({ [STORAGE_KEY]: [], [DEBUG_LOG_KEY]: [] });
  await load();
  setStatus('Cleared history and debug log.');
}

document.getElementById("copy").addEventListener("click", async () => {
  if (!urlBox.value) return setStatus("No URL to copy.");
  await copyText(urlBox.value, "Copied latest URL.");
});

document.getElementById("open").addEventListener("click", async () => {
  if (!urlBox.value) return setStatus("No URL to open.");
  await runtimeApi.tabs.create({ url: urlBox.value });
});

document.getElementById("refresh").addEventListener("click", load);
document.getElementById('export').addEventListener('click', exportJson);
document.getElementById('clear').addEventListener('click', clearHistory);
autoDownloadToggle.addEventListener('change', async () => {
  await runtimeApi.storage.local.set({ [AUTO_DOWNLOAD_KEY]: autoDownloadToggle.checked });
  await load();
  setStatus(autoDownloadToggle.checked ? 'Auto-download enabled.' : 'Auto-download disabled.');
});

debugToggle.addEventListener('change', async () => {
  await runtimeApi.storage.local.set({ [DEBUG_KEY]: debugToggle.checked });
  await load();
  setStatus(debugToggle.checked ? 'Debug mode enabled.' : 'Debug mode disabled.');
});
historySearch.addEventListener('input', () => renderHistory(currentEntries));

load();
