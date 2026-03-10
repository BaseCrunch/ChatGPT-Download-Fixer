(() => {
  const CAPTURE_TYPE = "CHATGPT_DOWNLOAD_HELPER_CAPTURE";
  const DEBUG_TYPE = "CHATGPT_DOWNLOAD_HELPER_DEBUG";
  let debugEnabled = false;

  const REQUEST_PATTERNS = [
    {
      matchedBy: 'interpreter-download',
      sourceCategory: 'conversation-api',
      confidence: 'high',
      re: /\/backend-api\/conversation\/[^/]+\/interpreter\/download(?:\?|$)/
    },
    {
      matchedBy: 'conversation-download',
      sourceCategory: 'conversation-api',
      confidence: 'high',
      re: /\/backend-api\/conversation\/[^/]+\/(?:download|files\/download|attachment\/download)(?:\?|$)/
    },
    {
      matchedBy: 'files-download',
      sourceCategory: 'file-api',
      confidence: 'medium',
      re: /\/backend-api\/(?:files|uploads|assets)\/(?:[^?#]+\/)?download(?:\?|$)/
    },
    {
      matchedBy: 'unknown-download-like',
      sourceCategory: 'backend-api',
      confidence: 'medium',
      re: /\/backend-api\/.*download(?:\?|$)/
    }
  ];

  function normalizeUrl(value) {
    try {
      return typeof value === 'string' ? new URL(value, location.origin).toString() : String(value || '');
    } catch (_) {
      return typeof value === 'string' ? value : '';
    }
  }

  function emitCapture(payload) {
    window.postMessage({ type: CAPTURE_TYPE, ...payload }, '*');
  }

  function emitDebug(payload) {
    if (!debugEnabled) return;
    window.postMessage({ type: DEBUG_TYPE, timestamp: new Date().toISOString(), ...payload }, '*');
  }

  function classifyRequestUrl(requestUrl) {
    if (!requestUrl) {
      return {
        matchedBy: 'unmatched',
        sourceCategory: 'unknown',
        confidence: 'low',
        accepted: false,
        reason: 'request-url-empty'
      };
    }

    for (const pattern of REQUEST_PATTERNS) {
      if (pattern.re.test(requestUrl)) {
        return {
          matchedBy: pattern.matchedBy,
          sourceCategory: pattern.sourceCategory,
          confidence: pattern.confidence,
          accepted: pattern.confidence === 'high' || pattern.confidence === 'medium',
          reason: `request-url-matched:${pattern.matchedBy}`
        };
      }
    }

    return {
      matchedBy: 'unmatched',
      sourceCategory: 'unknown',
      confidence: 'low',
      accepted: false,
      reason: 'request-url-not-matched'
    };
  }

  function classifyFinalUrl(downloadUrl) {
    if (!downloadUrl || typeof downloadUrl !== 'string') {
      return { finalUrlType: 'missing', accepted: false, reason: 'missing-download-url' };
    }

    if (/^https:\/\/chatgpt\.com\/backend-api\/estuary\/content(?:\?|$)/.test(downloadUrl)) {
      return { finalUrlType: 'estuary-content', accepted: true, reason: 'chatgpt-estuary-content' };
    }

    if (/^https:\/\/chatgpt\.com\/backend-api\/(?:files|assets)\//.test(downloadUrl)) {
      return { finalUrlType: 'chatgpt-backend-content', accepted: true, reason: 'chatgpt-backend-content' };
    }

    if (/^https:\/\/chatgpt\.com\/backend-api\//.test(downloadUrl)) {
      return { finalUrlType: 'chatgpt-backend-other', accepted: true, reason: 'chatgpt-backend-other' };
    }

    if (/^https?:\/\//.test(downloadUrl)) {
      return { finalUrlType: 'external', accepted: false, reason: 'external-download-url' };
    }

    return { finalUrlType: 'unknown', accepted: false, reason: 'download-url-not-chatgpt-file' };
  }

  function deepFindDownloadUrl(value, depth = 0) {
    if (depth > 4 || value == null) return null;
    if (typeof value === 'string') return null;

    if (Array.isArray(value)) {
      for (const item of value) {
        const result = deepFindDownloadUrl(item, depth + 1);
        if (result) return result;
      }
      return null;
    }

    if (typeof value === 'object') {
      if (typeof value.download_url === 'string') return value.download_url;
      for (const key of Object.keys(value)) {
        const result = deepFindDownloadUrl(value[key], depth + 1);
        if (result) return result;
      }
    }

    return null;
  }

  function parseCandidate(text) {
    if (!text || typeof text !== 'string') return { candidate: null, parseMode: 'empty' };

    try {
      const obj = JSON.parse(text);
      const nested = deepFindDownloadUrl(obj);
      if (nested) return { candidate: nested, parseMode: 'json' };
      return { candidate: null, parseMode: 'json-no-download-url' };
    } catch (_) {}

    const match = text.match(/"download_url"\s*:\s*"([^"]+)"/);
    if (!match) return { candidate: null, parseMode: 'regex-no-match' };

    try {
      return { candidate: JSON.parse('"' + match[1] + '"'), parseMode: 'regex' };
    } catch (_) {
      return { candidate: match[1], parseMode: 'regex-raw' };
    }
  }

  async function inspectResponse(responseText, requestUrl, transport) {
    const normalizedRequestUrl = normalizeUrl(requestUrl);
    const requestInfo = classifyRequestUrl(normalizedRequestUrl);

    if (!requestInfo.accepted) {
      emitDebug({
        level: 'skip',
        reason: requestInfo.reason,
        transport,
        sourceRequestUrl: normalizedRequestUrl,
        matchedBy: requestInfo.matchedBy,
        sourceCategory: requestInfo.sourceCategory,
        confidence: requestInfo.confidence
      });
      return;
    }

    const parsed = parseCandidate(responseText);
    if (!parsed.candidate) {
      emitDebug({
        level: 'skip',
        reason: parsed.parseMode === 'json-no-download-url' ? 'missing-download-url' : 'parse-failed',
        transport,
        sourceRequestUrl: normalizedRequestUrl,
        matchedBy: requestInfo.matchedBy,
        sourceCategory: requestInfo.sourceCategory,
        confidence: requestInfo.confidence,
        note: parsed.parseMode
      });
      return;
    }

    const normalizedDownloadUrl = normalizeUrl(parsed.candidate);
    const finalInfo = classifyFinalUrl(normalizedDownloadUrl);
    if (!finalInfo.accepted) {
      emitDebug({
        level: 'skip',
        reason: finalInfo.reason,
        transport,
        sourceRequestUrl: normalizedRequestUrl,
        matchedBy: requestInfo.matchedBy,
        sourceCategory: requestInfo.sourceCategory,
        confidence: requestInfo.confidence,
        candidateUrl: normalizedDownloadUrl,
        finalUrlType: finalInfo.finalUrlType,
        note: parsed.parseMode
      });
      return;
    }

    const acceptedReason = `accepted:${requestInfo.matchedBy}+${finalInfo.finalUrlType}`;
    emitCapture({
      url: normalizedDownloadUrl,
      transport,
      sourceRequestUrl: normalizedRequestUrl,
      matchedBy: requestInfo.matchedBy,
      sourceCategory: requestInfo.sourceCategory,
      confidence: requestInfo.confidence,
      finalUrlType: finalInfo.finalUrlType,
      acceptedReason,
      parseMode: parsed.parseMode,
      capturedAt: new Date().toISOString()
    });
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.type !== 'CHATGPT_DOWNLOAD_HELPER_DEBUG_SETTING') return;
    debugEnabled = !!data.enabled;
  });

  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    try {
      const requestUrl = args[0] && typeof args[0] === 'object' && 'url' in args[0] ? args[0].url : args[0];
      const clone = response.clone();
      const text = await clone.text();
      await inspectResponse(text, requestUrl, 'fetch');
    } catch (error) {
      emitDebug({ level: 'error', reason: 'fetch-inspection-failed', transport: 'fetch', note: String(error && error.message || error) });
    }
    return response;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__cdhUrl = url;
    return originalOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener('load', function () {
      try {
        inspectResponse(this.responseText, this.__cdhUrl, 'xhr');
      } catch (error) {
        emitDebug({ level: 'error', reason: 'xhr-inspection-failed', transport: 'xhr', sourceRequestUrl: this.__cdhUrl || '', note: String(error && error.message || error) });
      }
    });
    return originalSend.apply(this, args);
  };
})();
