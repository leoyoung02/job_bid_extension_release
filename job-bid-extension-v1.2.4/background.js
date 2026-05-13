const API_BASE = 'https://job-bid-server.onrender.com/api';
// const API_BASE = 'http://localhost:5000/api';
const EXTENSION_VERSION = chrome.runtime.getManifest().version;

function extractUpdateInfo(res) {
  const updateAvailable = res.headers.get('X-Extension-Update-Available') === 'true';
  if (!updateAvailable) return null;

  return {
    available: true,
    currentVersion: EXTENSION_VERSION,
    latestPublishedVersion: res.headers.get('X-Extension-Latest-Version') || '',
    minimumSupportedVersion: res.headers.get('X-Extension-Min-Version') || '',
    downloadUrl: res.headers.get('X-Extension-Download-Url') || '',
    updateNotice: res.headers.get('X-Extension-Update-Message') || 'A newer version of the extension is available.',
  };
}

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(console.error);

async function getTokens() {
  const data = await chrome.storage.local.get(['accessToken', 'refreshToken', 'sessionId', 'extensionInstallId']);
  return data;
}

async function saveTokens(accessToken, refreshToken, sessionId) {
  const next = { accessToken, refreshToken };
  if (sessionId) next.sessionId = sessionId;
  await chrome.storage.local.set(next);
}

async function clearTokens() {
  await chrome.storage.local.remove(['accessToken', 'refreshToken', 'sessionId']);
}

function createRuntimeId(prefix) {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}_${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

async function getOrCreateExtensionInstallId() {
  const { extensionInstallId } = await getTokens();
  if (extensionInstallId) return extensionInstallId;
  const next = createRuntimeId('ext');
  await chrome.storage.local.set({ extensionInstallId: next });
  return next;
}

async function getOrCreateSessionId() {
  const { sessionId } = await getTokens();
  if (sessionId) return sessionId;
  const next = createRuntimeId('session');
  await chrome.storage.local.set({ sessionId: next });
  return next;
}

async function buildCommonHeaders(extraHeaders = {}) {
  return {
    ...extraHeaders,
    'X-Client-Channel': 'extension',
    'X-Extension-Version': String(EXTENSION_VERSION),
    'X-Session-Id': await getOrCreateSessionId(),
    'X-Extension-Install-Id': await getOrCreateExtensionInstallId(),
  };
}

function buildFilenameRegex(relativePath) {
  const escaped = relativePath
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\//g, '[/\\\\]');
  return `.*${escaped}$`;
}

const BID_SUCCESS_URL_RE = /(?:thank[-_ ]?you|success|submitted|complete|confirmation|application[-_ ]?(?:submitted|complete)|proposal[-_ ]?(?:submitted|sent))/i;
const BID_SUCCESS_TEXT_RE = /\b(?:thank you|application submitted|application received|proposal submitted|proposal sent|bid submitted|successfully applied|your application has been sent|your application was sent|we received your application|submitted successfully|application complete)\b/i;

function normalizeExternalHost(value) {
  try {
    return new URL(value).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

function hostFamily(host) {
  const clean = String(host || '').replace(/^www\./i, '').toLowerCase();
  if (!clean) return '';
  if (clean === 'greenhouse.io' || clean.endsWith('.greenhouse.io')) return 'greenhouse.io';
  if (clean === 'lever.co' || clean.endsWith('.lever.co')) return 'lever.co';
  if (clean === 'workdayjobs.com' || clean.endsWith('.workdayjobs.com')) return 'workdayjobs.com';
  if (clean === 'ashbyhq.com' || clean.endsWith('.ashbyhq.com')) return 'ashbyhq.com';
  if (clean === 'smartrecruiters.com' || clean.endsWith('.smartrecruiters.com')) return 'smartrecruiters.com';
  if (clean === 'jobvite.com' || clean.endsWith('.jobvite.com')) return 'jobvite.com';
  return clean;
}

function isKnownAtsHost(host) {
  const family = hostFamily(host);
  return [
    'greenhouse.io',
    'lever.co',
    'workdayjobs.com',
    'ashbyhq.com',
    'smartrecruiters.com',
    'jobvite.com',
  ].includes(family);
}

function hostsMatchForBidProof(originalHost, currentHost) {
  if (!originalHost) return true;
  if (!currentHost) return false;
  if (originalHost === currentHost) return true;
  return hostFamily(originalHost) === hostFamily(currentHost);
}

function normalizePageText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 8000);
}

function serializableError(error) {
  return error?.message || String(error || 'Unknown error');
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function inspectActiveTabForBidSuccess(jobUrl) {
  const tab = await getActiveTab();
  if (!tab?.id || !tab.url || !/^https?:\/\//i.test(tab.url)) {
    return { verified: false, reason: 'No active job/result tab found' };
  }

  const originalHost = normalizeExternalHost(jobUrl);
  const currentHost = normalizeExternalHost(tab.url);
  const sameHost = hostsMatchForBidProof(originalHost, currentHost);
  const urlMatched = BID_SUCCESS_URL_RE.test(tab.url);

  let pageText = '';
  let textMatched = '';
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const title = document.title || '';
        const headings = Array.from(document.querySelectorAll('h1,h2,h3,[role="alert"],.success,.confirmation,.message'))
          .map((el) => el.textContent || '')
          .join(' ');
        const body = document.body?.innerText || '';
        return `${title}\n${headings}\n${body}`.slice(0, 12000);
      },
    });
    pageText = normalizePageText(result?.result || '');
    textMatched = pageText.match(BID_SUCCESS_TEXT_RE)?.[0] || '';
  } catch {
    // Some sites/Chrome pages cannot be scripted. URL-only detection is not enough to auto-verify.
  }

  const trustedAtsSuccess = isKnownAtsHost(currentHost) && !!textMatched;
  const verified = !!textMatched && (sameHost || trustedAtsSuccess);
  return {
    verified,
    method: textMatched ? 'success_text' : '',
    matchedText: textMatched,
    urlMatched,
    url: tab.url,
    urlHost: currentHost,
    urlPath: (() => {
      try { return new URL(tab.url).pathname; } catch { return ''; }
    })(),
    tabId: tab.id,
    sameHost,
    reason: verified
      ? ''
      : urlMatched && (sameHost || isKnownAtsHost(currentHost))
        ? 'Success URL found, but page text could not be verified'
        : sameHost || isKnownAtsHost(currentHost)
        ? 'No success message detected on the active tab'
        : 'Active tab does not match this job domain',
  };
}

async function captureActiveTabBidScreenshot(jobUrl) {
  const tab = await getActiveTab();
  if (!tab?.id || !tab.url || !/^https?:\/\//i.test(tab.url)) {
    return { captured: false, reason: 'No active result tab to capture' };
  }
  const originalHost = normalizeExternalHost(jobUrl);
  const currentHost = normalizeExternalHost(tab.url);
  const sameHost = hostsMatchForBidProof(originalHost, currentHost);
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 70 });
  let urlPath = '';
  try { urlPath = new URL(tab.url).pathname; } catch { urlPath = ''; }
  return {
    captured: true,
    dataUrl,
    urlHost: currentHost,
    urlPath,
    capturedAt: new Date().toISOString(),
    tabId: tab.id,
    sameHost,
  };
}

async function readJsonSafe(res) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    if (!res.ok) {
      const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 140);
      throw new Error(`API error (${res.status}): ${snippet || 'non-JSON response'}`);
    }
    throw new Error('Server returned invalid JSON');
  }
}

async function refreshAccessToken() {
  const { refreshToken, sessionId } = await getTokens();
  if (!refreshToken) throw new Error('No refresh token');

  const res = await fetch(`${API_BASE}/auth/refresh`, {
    method: 'POST',
    headers: await buildCommonHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ refreshToken }),
  });

  if (!res.ok) {
    await clearTokens();
    throw new Error('Session expired — please log in again');
  }

  const data = await readJsonSafe(res);
  await saveTokens(data.accessToken, data.refreshToken || refreshToken, data.sessionId || sessionId);
  return data.accessToken;
}

async function authedFetch(url, options = {}) {
  let { accessToken } = await getTokens();
  if (!accessToken) throw new Error('Not logged in');

  options.headers = await buildCommonHeaders({
    ...(options.headers || {}),
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  });

  let res = await fetch(url, options);

  if (res.status === 426) {
    const body = await readJsonSafe(res).catch(() => ({}));
    throw new Error('UPGRADE_REQUIRED:' + (body.downloadUrl || ''));
  }

  if (res.status === 401) {
    accessToken = await refreshAccessToken();
    options.headers.Authorization = `Bearer ${accessToken}`;
    res = await fetch(url, options);
    if (res.status === 426) {
      const body = await readJsonSafe(res).catch(() => ({}));
      throw new Error('UPGRADE_REQUIRED:' + (body.downloadUrl || ''));
    }
  }

  if (res.status === 403) {
    const body = await res.clone().json().catch(() => ({}));
    if (body.restricted) {
      throw new Error('ACCOUNT_RESTRICTED');
    }
    if (body.pending) {
      throw new Error('ACCOUNT_PENDING');
    }
  }

  res.extensionUpdate = extractUpdateInfo(res);
  return res;
}

async function authedFetchBlob(url) {
  let { accessToken } = await getTokens();
  if (!accessToken) throw new Error('Not logged in');

  const headers = await buildCommonHeaders({
    Authorization: `Bearer ${accessToken}`,
  });

  let res = await fetch(url, { headers });

  if (res.status === 426) {
    const body = await readJsonSafe(res).catch(() => ({}));
    throw new Error('UPGRADE_REQUIRED:' + (body.downloadUrl || ''));
  }

  if (res.status === 401) {
    accessToken = await refreshAccessToken();
    headers.Authorization = `Bearer ${accessToken}`;
    res = await fetch(url, { headers });
    if (res.status === 426) {
      const body = await readJsonSafe(res).catch(() => ({}));
      throw new Error('UPGRADE_REQUIRED:' + (body.downloadUrl || ''));
    }
  }

  if (res.status === 403) {
    const body = await res.clone().json().catch(() => ({}));
    if (body.restricted) throw new Error('ACCOUNT_RESTRICTED');
    if (body.pending) throw new Error('ACCOUNT_PENDING');
  }

  if (!res.ok) {
    const body = await readJsonSafe(res.clone()).catch((error) => {
      throw error;
    });
    throw new Error(body.message || `Download failed (${res.status})`);
  }
  return res.blob();
}

function waitForDownloadCompletion(downloadId, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.downloads.onChanged.removeListener(listener);
      reject(new Error('Download timed out before completion'));
    }, timeoutMs);

    function finish(fn, value) {
      clearTimeout(timeout);
      chrome.downloads.onChanged.removeListener(listener);
      fn(value);
    }

    function listener(delta) {
      if (delta.id !== downloadId) return;
      if (delta.state?.current === 'complete') {
        finish(resolve, downloadId);
        chrome.downloads.show(downloadId);
        return;
      }
      if (delta.state?.current === 'interrupted') {
        finish(reject, new Error('Download was interrupted'));
      }
    }

    chrome.downloads.onChanged.addListener(listener);
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message).then(sendResponse).catch((err) => {
    sendResponse({ success: false, error: err.message || String(err) });
  });
  return true;
});

async function handleMessage(msg) {
  switch (msg.type) {
    case 'LOGIN': {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: await buildCommonHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ email: msg.email, password: msg.password }),
      });
      if (res.status === 426) {
        const body = await readJsonSafe(res).catch(() => ({}));
        throw new Error('UPGRADE_REQUIRED:' + (body.downloadUrl || ''));
      }
      const extensionUpdate = extractUpdateInfo(res);
      const data = await readJsonSafe(res);
      if (!res.ok) throw new Error(data.message || 'Login failed');

      if (data.user && !data.user.isApproved) {
        throw new Error('ACCOUNT_PENDING');
      }

      await saveTokens(data.accessToken, data.refreshToken, data.sessionId);
      return { success: true, user: data.user, extensionUpdate };
    }

    case 'LOGOUT': {
      await clearTokens();
      return { success: true };
    }

    case 'CHECK_AUTH': {
      const { accessToken } = await getTokens();
      if (!accessToken) return { success: true, loggedIn: false };
      try {
        const res = await authedFetch(`${API_BASE}/auth/me`);
        if (!res.ok) return { success: true, loggedIn: false };
        const data = await res.json();
        const user = data.user || data;
        if (!user.isApproved) {
          await clearTokens();
          return { success: true, loggedIn: false, reason: 'ACCOUNT_PENDING' };
        }
        if (data.sessionId) {
          await chrome.storage.local.set({ sessionId: data.sessionId });
        }
        return { success: true, loggedIn: true, user, extensionUpdate: res.extensionUpdate || null };
      } catch (err) {
        if (err.message && err.message.startsWith('UPGRADE_REQUIRED:')) {
          const downloadUrl = err.message.split('UPGRADE_REQUIRED:')[1] || '';
          return { success: true, loggedIn: false, reason: 'UPGRADE_REQUIRED', downloadUrl };
        }
        if (err.message === 'ACCOUNT_RESTRICTED') {
          await clearTokens();
          return { success: true, loggedIn: false, reason: 'ACCOUNT_RESTRICTED' };
        }
        if (err.message === 'ACCOUNT_PENDING') {
          await clearTokens();
          return { success: true, loggedIn: false, reason: 'ACCOUNT_PENDING' };
        }
        return { success: true, loggedIn: false };
      }
    }

    case 'ADD_JOB_URL': {
      const res = await authedFetch(`${API_BASE}/scrape/url`, {
        method: 'POST',
        body: JSON.stringify({ url: msg.url }),
      });
      const data = await readJsonSafe(res);
      if (!res.ok) throw new Error(data.message || 'Scrape failed');
      return { success: true, job: data };
    }

    case 'ADD_JOB_MANUAL': {
      const res = await authedFetch(`${API_BASE}/jobs`, {
        method: 'POST',
        body: JSON.stringify(msg.job),
      });
      const data = await readJsonSafe(res);
      if (!res.ok) throw new Error(data.message || 'Failed to add job');
      return { success: true, job: data };
    }

    case 'GET_PROFILES': {
      const res = await authedFetch(`${API_BASE}/profiles`);
      const data = await readJsonSafe(res);
      if (!res.ok) throw new Error(data.message || 'Failed to load profiles');
      const profiles = (Array.isArray(data) ? data : data.profiles || []).map((p) => ({
        _id: p._id,
        name: p.name,
        isDefault: !!p.isDefault,
      }));
      return { success: true, profiles };
    }

    case 'SEARCH_JOBS': {
      const profileId = msg.profileId || '';
      const params = new URLSearchParams();
      if (msg.query) params.set('search', msg.query);
      if (msg.dateFrom) params.set('dateFrom', msg.dateFrom);
      if (msg.dateTo) params.set('dateTo', msg.dateTo);
      if (msg.showShared) params.set('showShared', 'true');
      params.set('limit', String(msg.limit || 200));
      const [jobsRes, mapRes] = await Promise.all([
        authedFetch(`${API_BASE}/jobs?${params.toString()}`),
        authedFetch(`${API_BASE}/resumes/map${profileId ? `?profileId=${profileId}` : ''}`),
      ]);
      const jobsData = await readJsonSafe(jobsRes);
      if (!jobsRes.ok) throw new Error(jobsData.message || 'Search failed');

      const mapData = mapRes.ok ? await readJsonSafe(mapRes) : { map: {} };
      const resumeMap = mapData.map || {};

      const jobs = (jobsData.jobs || jobsData || []).map((j) => ({
        _id: j._id,
        title: j.title,
        company: j.company,
        location: j.location,
        postedAt: j.postedAt,
        url: j.url,
        description: j.description,
        source: j.source,
        isShared: !!j.isShared,
        isOwn: j.isOwn !== false,
        isApplied: !!j.isApplied,
        appliedProfiles: Array.isArray(j.appliedProfiles) ? j.appliedProfiles : [],
        isFailed: !!j.isFailed,
        failedProfiles: Array.isArray(j.failedProfiles) ? j.failedProfiles : [],
        failedReason: j.failedReason || '',
        failedAt: j.failedAt || null,
        resumes: (resumeMap[j._id] || []).map((r) => ({
          _id: r._id,
          fileName: r.fileName,
          mode: r.mode,
          profileName: r.profileName,
          hasPdf: r.hasPdf,
          retentionState: r.retentionState,
          canDownloadDocx: r.canDownloadDocx,
          canDownloadPdf: r.canDownloadPdf,
          canRestoreDocx: r.canRestoreDocx,
          canRestorePdf: r.canRestorePdf,
          needsExtensionBackup: r.needsExtensionBackup,
          expiringArtifactsDownloaded: r.expiringArtifactsDownloaded,
          artifactExpiresAt: r.artifactExpiresAt,
          boneExpiresAt: r.boneExpiresAt,
        })),
      }));

      return { success: true, jobs };
    }

    case 'REVEAL_DOWNLOADED_FILE': {
      if (!msg.relativePath) {
        throw new Error('relativePath is required');
      }

      const downloads = await chrome.downloads.search({
        filenameRegex: buildFilenameRegex(msg.relativePath),
        orderBy: ['-startTime'],
        limit: 5,
      });

      const match = downloads.find((item) => item.state === 'complete');
      if (!match?.id) {
        throw new Error('No downloaded file found for this resume yet');
      }

      chrome.downloads.show(match.id);
      return { success: true, downloadId: match.id };
    }

    case 'GET_EXPIRING_FILES': {
      const res = await authedFetch(`${API_BASE}/resumes/expiring-files`);
      const data = await readJsonSafe(res);
      if (!res.ok) throw new Error(data.message || 'Failed to load expiring files');
      return { success: true, resumes: data.resumes || [], warningDays: data.warningDays || 7 };
    }

    case 'MARK_EXPIRING_FILES_DOWNLOADED': {
      const res = await authedFetch(`${API_BASE}/resumes/expiring-files/mark-downloaded`, {
        method: 'POST',
        body: JSON.stringify({ resumeIds: msg.resumeIds || [] }),
      });
      const data = await readJsonSafe(res);
      if (!res.ok) throw new Error(data.message || 'Failed to mark expiring files as downloaded');
      return { success: true, updated: data.updated || 0 };
    }

    case 'DOWNLOAD_RESUME': {
      const { resumeId, isPdf, suggestedPath, restore } = msg;
      const endpoint = restore
        ? (isPdf ? `${API_BASE}/resumes/restore-pdf/${resumeId}` : `${API_BASE}/resumes/restore/${resumeId}`)
        : (isPdf ? `${API_BASE}/resumes/download-pdf/${resumeId}` : `${API_BASE}/resumes/download/${resumeId}`);

      const blob = await authedFetchBlob(endpoint);
      const reader = new FileReader();

      const dataUrl = await new Promise((resolve, reject) => {
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      const downloadId = await new Promise((resolve, reject) => {
        chrome.downloads.download(
          { url: dataUrl, filename: suggestedPath, saveAs: false },
          (id) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve(id);
            }
          }
        );
      });

      await waitForDownloadCompletion(downloadId);

      return { success: true, downloadId };
    }

    case 'GENERATE_RESUME': {
      if (!msg.jobId) {
        throw new Error('jobId is required');
      }
      const res = await authedFetch(`${API_BASE}/resumes/generate/${msg.jobId}`, {
        method: 'POST',
        body: JSON.stringify({
          mode: msg.mode || 'premium',
          profileId: msg.profileId,
        }),
      });
      const data = await readJsonSafe(res);
      if (!res.ok) throw new Error(data.message || 'Failed to generate resume');
      return { success: true, resume: data.resume, insights: data.insights, mode: data.mode, pdfFailed: data.pdfFailed };
    }

    case 'TOGGLE_JOB_APPLIED': {
      if (!msg.jobId || !msg.profileId) throw new Error('jobId and profileId are required');
      const bidVerification = msg.jobUrl
        ? await inspectActiveTabForBidSuccess(msg.jobUrl)
        : { verified: false, reason: 'No saved job URL to verify against' };
      let screenshotProof = null;
      const urlOnlySuccessProof = !!bidVerification.urlMatched
        && (bidVerification.sameHost || isKnownAtsHost(bidVerification.urlHost));
      if (bidVerification.verified || (msg.allowProofCapture || urlOnlySuccessProof)) {
        try {
          screenshotProof = await captureActiveTabBidScreenshot(msg.jobUrl || '');
        } catch (error) {
          screenshotProof = { captured: false, reason: serializableError(error) };
        }
        if (!bidVerification.verified && !screenshotProof?.captured) {
          throw new Error(screenshotProof?.reason || 'Chrome could not capture the active tab');
        }
      }
      const res = await authedFetch(`${API_BASE}/jobs/${msg.jobId}/applied`, {
        method: 'PUT',
        body: JSON.stringify({
          profileId: msg.profileId,
          bidVerification: bidVerification.verified ? {
            method: bidVerification.method,
            matchedText: bidVerification.matchedText,
            urlHost: bidVerification.urlHost,
            urlPath: bidVerification.urlPath,
            sameHost: bidVerification.sameHost,
            tabId: bidVerification.tabId,
            detectedAt: new Date().toISOString(),
          } : undefined,
          screenshotProof: screenshotProof?.captured ? {
            dataUrl: screenshotProof.dataUrl,
            urlHost: screenshotProof.urlHost,
            urlPath: screenshotProof.urlPath,
            capturedAt: screenshotProof.capturedAt,
            tabId: screenshotProof.tabId,
          } : undefined,
        }),
      });
      const data = await readJsonSafe(res);
      if (!res.ok) throw new Error(data.message || 'Failed to toggle applied');
      return {
        success: true,
        bidVerification,
        screenshotProof: screenshotProof?.captured ? { captured: true } : screenshotProof,
        bidAttempt: data.bidAttempt || null,
        isApplied: !!data.isApplied,
        appliedProfiles: data.appliedProfiles || [],
        isFailed: !!data.isFailed,
        failedProfiles: data.failedProfiles || [],
      };
    }

    case 'TOGGLE_JOB_FAILED': {
      if (!msg.jobId || !msg.profileId) throw new Error('jobId and profileId are required');
      const res = await authedFetch(`${API_BASE}/jobs/${msg.jobId}/failed`, {
        method: 'PUT',
        body: JSON.stringify({ profileId: msg.profileId, reason: msg.reason || '' }),
      });
      const data = await readJsonSafe(res);
      if (!res.ok) throw new Error(data.message || 'Failed to toggle failed');
      return {
        success: true,
        isApplied: !!data.isApplied,
        appliedProfiles: data.appliedProfiles || [],
        isFailed: !!data.isFailed,
        failedProfiles: data.failedProfiles || [],
        failedReason: data.failedReason || '',
        failedAt: data.failedAt || null,
      };
    }

    case 'GENERATE_BID_ANSWER': {
      const res = await authedFetch(`${API_BASE}/resumes/${msg.resumeId}/bid-answer`, {
        method: 'POST',
        body: JSON.stringify({
          question: msg.question,
          note: msg.note,
          variant: msg.variant,
        }),
      });
      const data = await readJsonSafe(res);
      if (!res.ok) throw new Error(data.message || 'Failed to write answer');
      return { success: true, answer: data.answer, evidence: data.evidence || [], questionType: data.questionType };
    }

    default:
      throw new Error(`Unknown message type: ${msg.type}`);
  }
}
