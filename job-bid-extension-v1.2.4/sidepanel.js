const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

let sessionCount = 0;
let selectedProfileId = '';
let expiringResumes = [];
let activeAnswerContext = null;
let toastTimer = null;
let allQueueJobs = [];
let filteredQueueJobs = [];
let currentQueueIndex = -1;
const appliedProofRetryJobs = new Set();
let optionalUpdateShown = false;
let activeGenerationMode = 'lightweight';

const upgradeView = $('#upgrade-view');
const upgradeLink = $('#upgrade-link');
const versionBadge = $('.version-badge');
const optionalUpdateNotice = $('#optional-update-notice');
const optionalUpdateCopy = $('#optional-update-copy');
const optionalUpdateLink = $('#optional-update-link');
const optionalUpdateClose = $('#optional-update-close');
const loginView = $('#login-view');
const mainView = $('#main-view');
const loginForm = $('#login-form');
const loginError = $('#login-error');
const loginSubmit = $('#login-submit');
const statusDot = $('#status-dot');
const logoutBtn = $('#logout-btn');
const sessionCounter = $('#session-counter');

const manualForm = $('#manual-form');
const manualSubmit = $('#manual-submit');
const manualStatus = $('#manual-status');

const bidProfileSelect = $('#bid-profile');
const expiringFilesPanel = $('#expiring-files-panel');
const expiringFilesSubtitle = $('#expiring-files-subtitle');
const expiringFilesList = $('#expiring-files-list');
const expiringFilesDownloadAllBtn = $('#expiring-files-download-all');

const bidDateRange = $('#bid-date-range');
const bidPickedDateWrap = $('#bid-picked-date-wrap');
const bidPickedDate = $('#bid-picked-date');
const bidStatusFilter = $('#bid-status-filter');
const bidJobScope = $('#bid-job-scope');
const bidBidStatusFilter = $('#bid-bid-status');
const bidSearch = $('#bid-search');
const bidLoadBtn = $('#bid-load-btn');
const bidResetBtn = $('#bid-reset-btn');
const bidQueueStatus = $('#bid-queue-status');
const bidLoadingState = $('#bid-loading-state');
const bidEmptyState = $('#bid-empty-state');
const bulkBidShell = $('#bulk-bid-shell');
const queueCount = $('#queue-count');
const queuePrev = $('#queue-prev');
const queueNext = $('#queue-next');

const currentJobTitle = $('#current-job-title');
const currentJobMeta = $('#current-job-meta');
const currentJobBadges = $('#current-job-badges');
const currentJobBrief = $('#current-job-brief');
const currentResumeSummary = $('#current-resume-summary');
const currentGenerateResume = $('#current-generate-resume');
const currentOpenJobUrl = $('#current-open-job-url');
const currentDownloadDocx = $('#current-download-docx');
const currentDownloadPdf = $('#current-download-pdf');
const currentOpenFolder = $('#current-open-folder');
const currentMarkApplied = $('#current-mark-applied');
const currentMarkFailed = $('#current-mark-failed');
const currentFailedReason = $('#current-failed-reason');
const quickQuestionPanel = $('.quick-question-panel');

const bidAnswerPanel = $('#bid-answer-panel');
const bidAnswerContext = $('#bid-answer-context');
const bidAnswerMeta = $('#bid-answer-meta');
const bidAnswerQuestion = $('#bid-answer-question');
const bidAnswerNote = $('#bid-answer-note');
const bidAnswerSubmit = $('#bid-answer-submit');
const bidAnswerStatus = $('#bid-answer-status');
const bidAnswerOutputWrap = $('#bid-answer-output-wrap');
const bidAnswerOutput = $('#bid-answer-output');
const bidAnswerCopy = $('#bid-answer-copy');
const bidAnswerRegenerate = $('#bid-answer-regenerate');
const bidAnswerShorter = $('#bid-answer-shorter');
const bidAnswerSpecific = $('#bid-answer-specific');

document.addEventListener('DOMContentLoaded', checkAuth);

if (versionBadge) {
  versionBadge.textContent = `v${chrome.runtime.getManifest().version}`;
}

async function checkAuth() {
  try {
    const res = await sendMessage({ type: 'CHECK_AUTH' });
    if (res.reason === 'UPGRADE_REQUIRED') {
      showUpgrade(res.downloadUrl);
    } else if (res.loggedIn) {
      activeGenerationMode = res.user?.generationMode === 'premium' ? 'premium' : 'lightweight';
      await showMain();
      maybeShowOptionalUpdate(res.extensionUpdate);
    } else {
      showLogin();
      if (res.reason === 'ACCOUNT_PENDING') {
        loginError.textContent = 'Your account is pending admin approval.';
      } else if (res.reason === 'ACCOUNT_RESTRICTED') {
        loginError.textContent = 'Your account has been restricted. Contact support.';
      }
    }
  } catch {
    showLogin();
  }
}

function showUpgrade(downloadUrl) {
  upgradeView.style.display = '';
  optionalUpdateNotice.style.display = 'none';
  loginView.style.display = 'none';
  mainView.style.display = 'none';
  logoutBtn.style.display = 'none';
  statusDot.className = 'status-dot offline';
  statusDot.title = 'Update required';
  if (downloadUrl) upgradeLink.href = downloadUrl;
}

function showLogin() {
  upgradeView.style.display = 'none';
  loginView.style.display = '';
  mainView.style.display = 'none';
  logoutBtn.style.display = 'none';
  statusDot.className = 'status-dot offline';
  statusDot.title = 'Not connected';
}

async function showMain() {
  upgradeView.style.display = 'none';
  loginView.style.display = 'none';
  mainView.style.display = '';
  logoutBtn.style.display = '';
  statusDot.className = 'status-dot online';
  statusDot.title = 'Connected';
  await loadProfiles();
  await loadExpiringFiles();
  resetQueueView('Select a profile, set your filters, and load the queue.');
}

async function loadProfiles() {
  try {
    const res = await sendMessage({ type: 'GET_PROFILES' });
    if (!res.success || !res.profiles) return;

    bidProfileSelect.innerHTML = '';
    if (res.profiles.length === 0) {
      bidProfileSelect.innerHTML = '<option value="">No profiles — create one on the platform</option>';
      selectedProfileId = '';
      return;
    }

    const defaultProfile = res.profiles.find((profile) => profile.isDefault) || res.profiles[0];
    for (const profile of res.profiles) {
      const opt = document.createElement('option');
      opt.value = profile._id;
      opt.textContent = profile.name + (profile.isDefault ? ' (default)' : '');
      if (profile._id === defaultProfile._id) opt.selected = true;
      bidProfileSelect.appendChild(opt);
    }

    selectedProfileId = defaultProfile._id;
  } catch {
    bidProfileSelect.innerHTML = '<option value="">Failed to load profiles</option>';
    selectedProfileId = '';
  }
}

async function loadExpiringFiles() {
  try {
    const res = await sendMessage({ type: 'GET_EXPIRING_FILES' });
    expiringResumes = Array.isArray(res.resumes) ? res.resumes : [];
    renderExpiringFiles(res.warningDays || 7);
  } catch {
    expiringResumes = [];
    renderExpiringFiles(7);
  }
}

function renderExpiringFiles(warningDays) {
  if (!expiringResumes.length) {
    expiringFilesPanel.style.display = 'none';
    expiringFilesList.innerHTML = '';
    return;
  }

  expiringFilesPanel.style.display = '';
  expiringFilesSubtitle.textContent = `Download these from the extension during the ${warningDays}-day warning window before hot storage ends.`;
  expiringFilesList.innerHTML = expiringResumes.map((resume) => {
    const job = resume.jobId || {};
    const profileName = typeof resume.profileId === 'object' ? resume.profileId?.name : '';
    const formats = ['DOCX'].concat(resume.hasPdfArtifact ? ['PDF'] : []).join(' + ');
    return `
      <div class="expiring-item">
        <div>
          <div class="expiring-item-title">${escapeHTML(job.title || 'Resume')} &middot; ${escapeHTML(job.company || '')}</div>
          <div class="expiring-item-meta">${escapeHTML(profileName || 'Default profile')} &middot; ${formats}</div>
        </div>
        <div class="expiring-item-status">${resume.expiringArtifactsDownloaded ? 'Downloaded' : 'Pending'}</div>
      </div>
    `;
  }).join('');
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.textContent = '';
  loginSubmit.disabled = true;
  loginSubmit.textContent = 'Signing in...';

  try {
    const res = await sendMessage({
      type: 'LOGIN',
      email: $('#login-email').value.trim(),
      password: $('#login-password').value,
    });
    if (res.success) {
      activeGenerationMode = res.user?.generationMode === 'premium' ? 'premium' : 'lightweight';
      await showMain();
      maybeShowOptionalUpdate(res.extensionUpdate);
      loginForm.reset();
      return;
    }

    if (res.error?.startsWith('UPGRADE_REQUIRED:')) {
      showUpgrade(res.error.split('UPGRADE_REQUIRED:')[1] || '');
    } else if (res.error === 'ACCOUNT_PENDING') {
      loginError.textContent = 'Your account is pending admin approval. Please wait.';
    } else if (res.error === 'ACCOUNT_RESTRICTED') {
      loginError.textContent = 'Your account has been restricted. Contact support.';
    } else {
      loginError.textContent = res.error || 'Login failed';
    }
  } catch (err) {
    if (err.message === 'ACCOUNT_PENDING') {
      loginError.textContent = 'Your account is pending admin approval. Please wait.';
    } else if (err.message === 'ACCOUNT_RESTRICTED') {
      loginError.textContent = 'Your account has been restricted. Contact support.';
    } else {
      loginError.textContent = err.message || 'Login failed';
    }
  } finally {
    loginSubmit.disabled = false;
    loginSubmit.textContent = 'Sign In';
  }
});

logoutBtn.addEventListener('click', async () => {
  await sendMessage({ type: 'LOGOUT' });
  showLogin();
});

$$('.tab').forEach((tab) => {
  tab.addEventListener('click', () => setActiveTab(tab.dataset.tab));
});

manualForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  setLoading(manualSubmit, true);
  clearStatus(manualStatus);

  try {
    const job = {
      title: $('#job-title').value.trim(),
      company: $('#job-company').value.trim(),
      location: $('#job-location').value,
      url: $('#job-link').value.trim() || undefined,
      description: $('#job-description').value.trim(),
      source: 'chrome-extension',
    };

    if (!job.location) {
      setStatus(manualStatus, 'Select a region before adding the job.', 'error');
      return;
    }

    const res = await sendMessage({ type: 'ADD_JOB_MANUAL', job });
    if (!res.success) throw new Error(res.error || 'Failed to add job');

    setStatus(manualStatus, `Added: ${job.title} at ${job.company}`, 'success');
    manualForm.reset();
    bumpCounter();
  } catch (err) {
    setStatus(manualStatus, err.message || 'Failed to add job', 'error');
  } finally {
    setLoading(manualSubmit, false);
  }
});

bidProfileSelect.addEventListener('change', () => {
  selectedProfileId = bidProfileSelect.value;
  resetQueueView('Profile changed. Update filters and load the queue.');
});

bidDateRange.addEventListener('change', syncDatePickerVisibility);
bidLoadBtn.addEventListener('click', () => loadQueue());
bidResetBtn.addEventListener('click', resetQueueFilters);
bidSearch.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    loadQueue();
  }
});
queuePrev.addEventListener('click', () => moveQueue(-1));
queueNext.addEventListener('click', () => moveQueue(1));
currentGenerateResume.addEventListener('click', generateCurrentResume);
currentOpenJobUrl.addEventListener('click', openCurrentJobUrl);
currentDownloadDocx.addEventListener('click', () => downloadCurrentResume(false));
currentDownloadPdf.addEventListener('click', () => downloadCurrentResume(true));
currentOpenFolder.addEventListener('click', revealCurrentResumeFolder);
currentMarkApplied.addEventListener('click', () => toggleCurrentJobStatus('applied'));
currentMarkFailed.addEventListener('click', () => toggleCurrentJobStatus('failed'));
expiringFilesDownloadAllBtn.addEventListener('click', () => downloadAllExpiringFiles());

$$('.quick-question-btn').forEach((button) => {
  button.addEventListener('click', () => {
    bidAnswerQuestion.value = button.dataset.question || '';
    bidAnswerQuestion.focus();
  });
});

bidAnswerSubmit.addEventListener('click', () => submitBidAnswer('default'));
bidAnswerRegenerate.addEventListener('click', () => submitBidAnswer('alternative'));
bidAnswerShorter.addEventListener('click', () => submitBidAnswer('shorter'));
bidAnswerSpecific.addEventListener('click', () => submitBidAnswer('more_specific'));
bidAnswerCopy.addEventListener('click', async () => {
  if (!bidAnswerOutput.textContent.trim()) return;
  try {
    await navigator.clipboard.writeText(bidAnswerOutput.textContent);
    setStatus(bidAnswerStatus, 'Answer copied.', 'success');
    showToast('Copied to clipboard');
  } catch (err) {
    setStatus(bidAnswerStatus, err.message || 'Failed to copy answer.', 'error');
    showToast('Copy failed', 'error');
  }
});
bidAnswerOutput.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
    e.preventDefault();
    selectBidAnswerOutput();
  }
});
bidAnswerOutput.addEventListener('click', () => bidAnswerOutput.focus());

async function loadQueue() {
  if (!selectedProfileId) {
    setStatus(bidQueueStatus, 'Select a profile first.', 'error');
    return;
  }

  if (bidDateRange.value === 'pick' && !bidPickedDate.value) {
    setStatus(bidQueueStatus, 'Pick a date first.', 'error');
    bidPickedDate.focus();
    return;
  }

  clearStatus(bidQueueStatus);
  bidLoadingState.style.display = '';
  bulkBidShell.style.display = 'none';
  bidEmptyState.style.display = 'none';
  bidLoadBtn.disabled = true;

  try {
    const res = await sendMessage({
      type: 'SEARCH_JOBS',
      query: bidSearch.value.trim(),
      profileId: selectedProfileId,
      dateFrom: getDateFromFilter(),
      dateTo: getDateToFilter(),
      showShared: bidJobScope.value === 'shared',
      limit: 200,
    });
    if (!res.success) throw new Error(res.error || 'Failed to load jobs');

    allQueueJobs = (res.jobs || []).map(enrichQueueJob);
    filteredQueueJobs = applyQueueFilters(allQueueJobs);

    if (!filteredQueueJobs.length) {
      resetQueueView('No jobs matched these filters.');
      setStatus(bidQueueStatus, 'No jobs matched these filters.', 'error');
      return;
    }

    currentQueueIndex = 0;
    renderQueue();
    setStatus(bidQueueStatus, `Loaded ${filteredQueueJobs.length} job${filteredQueueJobs.length === 1 ? '' : 's'} for this queue.`, 'success');
  } catch (err) {
    resetQueueView('Could not load the queue.');
    setStatus(bidQueueStatus, err.message || 'Failed to load the queue.', 'error');
  } finally {
    bidLoadingState.style.display = 'none';
    bidLoadBtn.disabled = false;
  }
}

function enrichQueueJob(job) {
  const resumes = Array.isArray(job.resumes) ? job.resumes : [];
  const primaryResume = resumes[0] || null;
  return {
    ...job,
    resumes,
    primaryResume,
  };
}

function applyQueueFilters(jobs) {
  const status = bidStatusFilter.value;
  const bidStatus = bidBidStatusFilter.value;
  const profileId = selectedProfileId;
  return jobs.filter((job) => {
    const hasResume = !!job.primaryResume;
    if (status === 'ready' && !hasResume) return false;
    if (status === 'missing' && hasResume) return false;

    const applied = !!profileId && Array.isArray(job.appliedProfiles) && job.appliedProfiles.includes(profileId);
    const failed = !!profileId && Array.isArray(job.failedProfiles) && job.failedProfiles.includes(profileId);
    if (bidStatus === 'applied') return applied;
    if (bidStatus === 'failed') return failed;
    if (bidStatus === 'open') return !applied && !failed;
    return true;
  });
}

function getDateFromFilter() {
  if (bidDateRange.value === 'all') return '';
  if (bidDateRange.value === 'pick') {
    return bidPickedDate.value ? new Date(`${bidPickedDate.value}T00:00:00`).toISOString() : '';
  }
  const date = new Date();
  if (bidDateRange.value === 'today') {
    date.setHours(0, 0, 0, 0);
    return date.toISOString();
  }
  const days = Number(bidDateRange.value || 7);
  date.setDate(date.getDate() - days);
  date.setHours(0, 0, 0, 0);
  return date.toISOString();
}

function getDateToFilter() {
  if (bidDateRange.value !== 'pick' || !bidPickedDate.value) return '';
  return new Date(`${bidPickedDate.value}T23:59:59.999`).toISOString();
}

function moveQueue(direction) {
  if (!filteredQueueJobs.length) return;
  const nextIndex = currentQueueIndex + direction;
  if (nextIndex < 0 || nextIndex >= filteredQueueJobs.length) return;
  currentQueueIndex = nextIndex;
  renderQueue();
}

function renderQueue() {
  const currentJob = filteredQueueJobs[currentQueueIndex];
  if (!currentJob) {
    resetQueueView('No jobs matched these filters.');
    return;
  }

  bulkBidShell.style.display = '';
  bidEmptyState.style.display = 'none';

  queueCount.textContent = `${currentQueueIndex + 1} of ${filteredQueueJobs.length}`;
  queuePrev.disabled = currentQueueIndex <= 0;
  queueNext.disabled = currentQueueIndex >= filteredQueueJobs.length - 1;

  renderCurrentJob(currentJob);
  syncAnswerContext(currentJob);
}

function renderCurrentJob(job) {
  currentJobTitle.textContent = job.title || 'Untitled job';
  currentJobMeta.textContent = [
    job.company || 'Unknown company',
    job.location || '',
    job.postedAt ? `Posted ${formatDate(job.postedAt)}` : '',
  ].filter(Boolean).join(' · ');
  currentJobBrief.textContent = buildJobBrief(job.description);
  currentJobBadges.innerHTML = buildBadgeHTML(job);

  const resume = job.primaryResume;
  const hasResume = !!resume;

  if (hasResume) {
    currentResumeSummary.className = 'current-resume-summary ready';
    currentResumeSummary.textContent = [
      `Using ${resume.profileName || 'Default profile'} · ${resume.mode || 'standard'}.`,
      resume.hasPdf ? 'DOCX and PDF are ready.' : 'DOCX is ready.',
      resume.needsExtensionBackup ? 'Files are in the expiring window.' : '',
      resume.retentionState === 'bone_only' ? 'Only restore actions are available.' : '',
    ].filter(Boolean).join(' ');
  } else {
    currentResumeSummary.className = 'current-resume-summary missing';
    currentResumeSummary.textContent = 'No resume is ready for this profile on this job yet. You can still review the job and move through the queue.';
  }

  quickQuestionPanel.style.display = hasResume ? '' : 'none';
  bidAnswerPanel.style.display = hasResume ? '' : 'none';
  currentGenerateResume.style.display = hasResume ? 'none' : '';
  currentGenerateResume.disabled = hasResume;
  currentOpenJobUrl.disabled = !job.url;
  currentDownloadDocx.disabled = !hasResume || (!resume.canDownloadDocx && !resume.canRestoreDocx);
  currentDownloadPdf.disabled = !hasResume || !resume.hasPdf || (!resume.canDownloadPdf && !resume.canRestorePdf);
  currentOpenFolder.disabled = !hasResume;
  renderBidStatus(job);
}

function renderBidStatus(job) {
  const profileId = selectedProfileId;
  const applied = !!profileId && Array.isArray(job.appliedProfiles) && job.appliedProfiles.includes(profileId);
  const failed = !!profileId && Array.isArray(job.failedProfiles) && job.failedProfiles.includes(profileId);

  currentMarkApplied.dataset.state = applied ? 'on' : 'off';
  currentMarkApplied.textContent = applied ? '✓ Applied' : 'Mark Applied';
  currentMarkFailed.dataset.state = failed ? 'on' : 'off';
  currentMarkFailed.textContent = failed ? '✗ Failed' : 'Mark Failed';

  if (failed && job.failedReason) {
    currentFailedReason.textContent = `— ${job.failedReason}`;
  } else {
    currentFailedReason.textContent = '';
  }

  const disabled = !profileId || !job._id;
  currentMarkApplied.disabled = disabled || applied;
  currentMarkFailed.disabled = disabled || applied;
}

async function toggleCurrentJobStatus(kind) {
  const currentJob = filteredQueueJobs[currentQueueIndex];
  if (!currentJob?._id) {
    showToast('No job selected', 'error');
    return;
  }
  if (!selectedProfileId) {
    showToast('Pick a profile first', 'error');
    return;
  }

  const button = kind === 'applied' ? currentMarkApplied : currentMarkFailed;
  const wasOn = button.dataset.state === 'on';
  if (kind === 'applied' && wasOn) {
    showToast('This job is already marked applied', 'success', 4000);
    return;
  }
  const alreadyApplied = Array.isArray(currentJob.appliedProfiles) && currentJob.appliedProfiles.includes(selectedProfileId);
  if (kind === 'failed' && alreadyApplied) {
    showToast('This job is already applied. Cannot mark as failed.', 'error', 5000);
    return;
  }
  let reason = '';
  if (kind === 'failed' && !wasOn) {
    const input = window.prompt('Optional: short reason (e.g. link expired, no contact form)');
    if (input === null) return;
    reason = input.trim();
  }

  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = '...';

  try {
    const res = await sendMessage({
      type: kind === 'applied' ? 'TOGGLE_JOB_APPLIED' : 'TOGGLE_JOB_FAILED',
      jobId: currentJob._id,
      profileId: selectedProfileId,
      jobUrl: currentJob.url || '',
      allowProofCapture: kind === 'applied' && appliedProofRetryJobs.has(currentJob._id),
      reason: reason || undefined,
    });
    if (!res.success) throw new Error(res.error || 'Failed to update bid status');

    currentJob.appliedProfiles = res.appliedProfiles || [];
    currentJob.isApplied = !!res.isApplied;
    currentJob.failedProfiles = res.failedProfiles || [];
    currentJob.isFailed = !!res.isFailed;
    if (typeof res.failedReason === 'string') currentJob.failedReason = res.failedReason;
    if (res.bidAttempt) {
      currentJob.bidProof = {
        _id: res.bidAttempt._id || '',
        status: res.bidAttempt.status,
        verificationMethod: res.bidAttempt.verificationMethod,
      };
    }

    renderBidStatus(currentJob);
    currentJobBadges.innerHTML = buildBadgeHTML(currentJob);

    const nowOn = (kind === 'applied' && currentJob.appliedProfiles.includes(selectedProfileId))
      || (kind === 'failed' && currentJob.failedProfiles.includes(selectedProfileId));
    if (kind === 'applied' && nowOn && res.bidVerification?.verified) {
      appliedProofRetryJobs.delete(currentJob._id);
      showToast('Auto verified: bid submitted', 'success', 5000);
    } else if (kind === 'applied' && nowOn && res.screenshotProof?.captured) {
      appliedProofRetryJobs.delete(currentJob._id);
      showToast('Marked as applied with proof saved', 'success', 5000);
    } else if (kind === 'applied' && nowOn) {
      showToast(res.bidVerification?.reason || 'Marked as applied', 'success', 5000);
    } else {
      showToast(nowOn
        ? (kind === 'failed' ? 'Marked as failed' : 'Marked as applied')
        : (kind === 'applied' ? 'Cleared applied status' : 'Cleared failed status'));
    }
  } catch (err) {
    if (kind === 'applied') {
      const alreadyRetrying = appliedProofRetryJobs.has(currentJob._id);
      appliedProofRetryJobs.add(currentJob._id);
      showToast(
        alreadyRetrying
          ? `Could not capture this tab${err.message ? `: ${err.message}` : ''}`
          : (err.message || 'Could not verify this page yet. Open the submitted/result tab, then click Mark Applied again.'),
        'error',
        7000,
      );
    } else {
      showToast(err.message || 'Could not update bid status', 'error', 6000);
    }
    button.textContent = originalLabel;
  } finally {
    button.disabled = false;
  }
}

function syncAnswerContext(job) {
  const resume = job.primaryResume;
  activeAnswerContext = resume ? {
    resumeId: resume._id,
    company: job.company || 'Unknown',
    title: job.title || 'Resume',
    profileName: resume.profileName || 'Default',
    mode: resume.mode || '',
    fileName: resume.fileName || 'resume.docx',
    jobId: job._id,
  } : null;

  bidAnswerContext.textContent = `${job.company || 'Unknown'} · ${job.title || 'Resume'}`;
  bidAnswerMeta.textContent = resume
    ? `${resume.profileName || 'Default'}${resume.mode ? ` · ${resume.mode}` : ''}`
    : 'No resume ready for this queue item';

  clearStatus(bidAnswerStatus);
  bidAnswerOutput.textContent = '';
  bidAnswerOutputWrap.style.display = 'none';
  bidAnswerSubmit.disabled = !resume;
  setAnswerActionsDisabled(!resume);
}

async function submitBidAnswer(variant) {
  if (!activeAnswerContext?.resumeId) {
    setStatus(bidAnswerStatus, 'This queue item does not have a resume yet.', 'error');
    return;
  }

  const question = bidAnswerQuestion.value.trim();
  if (!question) {
    setStatus(bidAnswerStatus, 'Paste the employer question first.', 'error');
    bidAnswerQuestion.focus();
    return;
  }

  setLoading(bidAnswerSubmit, true);
  setAnswerActionsDisabled(true);
  clearStatus(bidAnswerStatus);

  try {
    const res = await sendMessage({
      type: 'GENERATE_BID_ANSWER',
      resumeId: activeAnswerContext.resumeId,
      question,
      note: bidAnswerNote.value.trim() || undefined,
      variant,
    });
    if (!res.success) throw new Error(res.error || 'Failed to write answer');

    bidAnswerOutput.textContent = res.answer || '';
    bidAnswerOutputWrap.style.display = bidAnswerOutput.textContent ? '' : 'none';
    setStatus(
      bidAnswerStatus,
      variant === 'default' ? 'Answer ready.' : variant === 'shorter' ? 'Shorter version ready.' : variant === 'more_specific' ? 'More specific version ready.' : 'Alternative answer ready.',
      'success',
    );
  } catch (err) {
    setStatus(bidAnswerStatus, err.message || 'Failed to write answer', 'error');
  } finally {
    setLoading(bidAnswerSubmit, false);
    setAnswerActionsDisabled(!activeAnswerContext?.resumeId);
  }
}

function setAnswerActionsDisabled(disabled) {
  [bidAnswerCopy, bidAnswerRegenerate, bidAnswerShorter, bidAnswerSpecific].forEach((btn) => {
    btn.disabled = disabled;
  });
}

async function downloadCurrentResume(isPdf) {
  const currentJob = filteredQueueJobs[currentQueueIndex];
  const resume = currentJob?.primaryResume;
  if (!currentJob || !resume) {
    showToast('No resume ready for this job', 'error');
    return;
  }

  const button = isPdf ? currentDownloadPdf : currentDownloadDocx;
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = '...';

  try {
    const res = await sendMessage({
      type: 'DOWNLOAD_RESUME',
      resumeId: resume._id,
      isPdf,
      restore: isPdf ? resume.canRestorePdf : resume.canRestoreDocx,
      suggestedPath: buildSuggestedPath(currentJob, resume, isPdf),
    });
    if (!res.success) throw new Error(res.error || 'Download failed');
    showToast(`${isPdf ? 'PDF' : 'DOCX'} downloaded`);
  } catch (err) {
    showToast(err.message || 'Download failed', 'error');
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

async function generateCurrentResume() {
  const currentJob = filteredQueueJobs[currentQueueIndex];
  if (!currentJob?._id) {
    showToast('No job selected', 'error');
    return;
  }

  const originalText = currentGenerateResume.textContent;
  currentGenerateResume.disabled = true;
  currentGenerateResume.textContent = 'Generating...';

  try {
    const res = await sendMessage({
      type: 'GENERATE_RESUME',
      jobId: currentJob._id,
      profileId: selectedProfileId,
      mode: activeGenerationMode,
    });
    if (!res.success) throw new Error(res.error || 'Failed to generate resume');
    showToast('Resume generated');
    await loadQueue();
    const nextIndex = filteredQueueJobs.findIndex((job) => job._id === currentJob._id);
    if (nextIndex >= 0) {
      currentQueueIndex = nextIndex;
      renderQueue();
    }
  } catch (err) {
    showToast(err.message || 'Failed to generate resume', 'error');
  } finally {
    currentGenerateResume.textContent = originalText;
    currentGenerateResume.disabled = false;
  }
}

async function revealCurrentResumeFolder() {
  const currentJob = filteredQueueJobs[currentQueueIndex];
  const resume = currentJob?.primaryResume;
  if (!currentJob || !resume) {
    showToast('No resume ready for this job', 'error');
    return;
  }

  try {
    const res = await sendMessage({
      type: 'REVEAL_DOWNLOADED_FILE',
      relativePath: buildSuggestedPath(currentJob, resume, false),
    });
    if (!res.success) throw new Error(res.error || 'Resume file not found locally yet');
    showToast('Opened download folder');
  } catch (err) {
    showToast(err.message || 'Download the resume once before opening the folder', 'error');
  }
}

function openCurrentJobUrl() {
  const currentJob = filteredQueueJobs[currentQueueIndex];
  if (!currentJob?.url) {
    showToast('No job URL saved for this item', 'error');
    return;
  }

  if (!isSafeExternalUrl(currentJob.url)) {
    showToast('Saved job URL is invalid or unsafe', 'error');
    return;
  }

  window.open(currentJob.url, '_blank', 'noopener');
}

async function downloadAllExpiringFiles() {
  if (!expiringResumes.length) return;

  expiringFilesDownloadAllBtn.disabled = true;
  const originalText = expiringFilesDownloadAllBtn.textContent;
  expiringFilesDownloadAllBtn.textContent = 'Downloading...';

  const successfulResumeIds = [];

  try {
    for (const resume of expiringResumes) {
      let resumeSucceeded = true;
      const job = resume.jobId || {};
      const suggestedPathBase = buildSuggestedPathBase(job.company || 'Unknown', job.title || 'Resume', String(job._id || ''));

      const docxResponse = await sendMessage({
        type: 'DOWNLOAD_RESUME',
        resumeId: resume._id,
        isPdf: false,
        restore: false,
        suggestedPath: `${suggestedPathBase}/${resume.fileName || 'resume.docx'}`,
      });
      if (!docxResponse.success) resumeSucceeded = false;

      if (resume.hasPdfArtifact) {
        const pdfResponse = await sendMessage({
          type: 'DOWNLOAD_RESUME',
          resumeId: resume._id,
          isPdf: true,
          restore: false,
          suggestedPath: `${suggestedPathBase}/${(resume.pdfFileName || resume.fileName || 'resume.docx').replace(/\.docx$/i, '.pdf')}`,
        });
        if (!pdfResponse.success) resumeSucceeded = false;
      }

      if (resumeSucceeded) successfulResumeIds.push(resume._id);
    }

    if (successfulResumeIds.length > 0) {
      await sendMessage({ type: 'MARK_EXPIRING_FILES_DOWNLOADED', resumeIds: successfulResumeIds });
    }
    await loadExpiringFiles();
    showToast(`Downloaded ${successfulResumeIds.length} expiring resume set(s).`);
  } catch (err) {
    showToast(err.message || 'Bulk download failed', 'error');
  } finally {
    expiringFilesDownloadAllBtn.disabled = false;
    expiringFilesDownloadAllBtn.textContent = originalText;
  }
}

function resetQueueFilters() {
  bidDateRange.value = 'today';
  bidPickedDate.value = '';
  bidStatusFilter.value = 'ready';
  bidJobScope.value = 'mine';
  bidBidStatusFilter.value = 'open';
  bidSearch.value = '';
  syncDatePickerVisibility();
  clearStatus(bidQueueStatus);
  resetQueueView('Filters reset. Load the queue when you are ready.');
}

function resetQueueView(message) {
  allQueueJobs = [];
  filteredQueueJobs = [];
  currentQueueIndex = -1;
  activeAnswerContext = null;

  bulkBidShell.style.display = 'none';
  bidLoadingState.style.display = 'none';
  bidEmptyState.style.display = '';
  bidEmptyState.textContent = message;
  queueCount.textContent = '0 of 0';
  currentJobTitle.textContent = 'No job selected';
  currentJobMeta.textContent = '';
  currentJobBadges.innerHTML = '';
  currentJobBrief.textContent = 'Load a queue to review one job at a time.';
  currentResumeSummary.className = 'current-resume-summary';
  currentResumeSummary.textContent = '';
  currentGenerateResume.style.display = '';
  currentGenerateResume.disabled = true;
  currentOpenJobUrl.disabled = true;
  currentDownloadDocx.disabled = true;
  currentDownloadPdf.disabled = true;
  currentOpenFolder.disabled = true;
  queuePrev.disabled = true;
  queueNext.disabled = true;
  quickQuestionPanel.style.display = 'none';
  bidAnswerPanel.style.display = 'none';

  bidAnswerContext.textContent = 'The current queue item will be used for answer generation.';
  bidAnswerMeta.textContent = '';
  bidAnswerSubmit.disabled = true;
  setAnswerActionsDisabled(true);
  clearStatus(bidAnswerStatus);
  bidAnswerOutputWrap.style.display = 'none';
  bidAnswerOutput.textContent = '';
}

function buildJobBrief(description) {
  if (!description) return 'No job description saved for this item.';
  const normalized = description.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 260) return normalized;
  const shortened = normalized.slice(0, 260);
  return `${shortened.slice(0, shortened.lastIndexOf(' ')).trim()}...`;
}

function buildBadgeHTML(job) {
  const resume = job.primaryResume;
  const badges = [];

  const profileApplied = !!selectedProfileId && Array.isArray(job.appliedProfiles) && job.appliedProfiles.includes(selectedProfileId);
  const profileFailed = !!selectedProfileId && Array.isArray(job.failedProfiles) && job.failedProfiles.includes(selectedProfileId);
  if (job.isShared && job.isOwn === false) badges.push('<span class="resume-badge ready">Shared</span>');
  if (profileApplied) badges.push('<span class="resume-badge ready">Applied</span>');
  if (profileFailed) badges.push('<span class="resume-badge warning" style="background:#fee2e2;color:#991b1b">Failed</span>');

  if (!resume) {
    badges.push('<span class="resume-badge archived">No resume</span>');
  } else {
    badges.push(`<span class="resume-badge${resume.retentionState === 'bone_only' ? ' archived' : ' ready'}">${resume.retentionState === 'bone_only' ? 'Bone only' : 'Resume ready'}</span>`);
    if (resume.needsExtensionBackup) {
      badges.push('<span class="resume-badge warning">Expiring files</span>');
    }
  }
  return badges.join('');
}

function buildSuggestedPath(job, resume, isPdf) {
  const ext = isPdf ? '.pdf' : '.docx';
  const baseName = (resume.fileName || 'resume.docx').replace(/\.(docx|pdf)$/i, ext);
  return `${buildSuggestedPathBase(job.company || 'Unknown', job.title || 'Resume', job._id || '')}/${baseName}`;
}

function buildSuggestedPathBase(company, title, jobId) {
  return `RoundTable/${sanitizeFilename(company)}_${sanitizeFilename(title)}_${String(jobId).slice(-6)}`;
}

function isSafeExternalUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function formatDate(value) {
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function syncDatePickerVisibility() {
  const showPicker = bidDateRange.value === 'pick';
  bidPickedDateWrap.style.display = showPicker ? '' : 'none';
  if (!showPicker) {
    bidPickedDate.value = '';
  }
}

function setActiveTab(tabId) {
  $$('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === tabId));
  $$('.tab-content').forEach((content) => content.classList.toggle('active', content.id === tabId));
}

function sendMessage(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (!response) {
        reject(new Error('No response from background'));
      } else {
        resolve(response);
      }
    });
  });
}

function setLoading(btn, loading) {
  btn.disabled = loading;
  btn.querySelector('.btn-label').style.display = loading ? 'none' : '';
  btn.querySelector('.btn-spinner').style.display = loading ? '' : 'none';
}

function setStatus(el, text, type) {
  el.textContent = text;
  el.className = `status-msg ${type}`;
}

function clearStatus(el) {
  el.textContent = '';
  el.className = 'status-msg';
}

function selectBidAnswerOutput() {
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(bidAnswerOutput);
  selection.removeAllRanges();
  selection.addRange(range);
}

function showToast(message, type = 'success', durationMs = 1800) {
  let toast = document.querySelector('.app-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'app-toast';
    document.body.appendChild(toast);
  }

  toast.textContent = message;
  toast.className = `app-toast ${type}`;
  requestAnimationFrame(() => toast.classList.add('show'));

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, durationMs);
}

const DISMISSED_UPDATE_KEY = 'dismissedExtensionUpdateVersion';

function readDismissedUpdateVersion() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get([DISMISSED_UPDATE_KEY], (data) => {
        resolve((data && data[DISMISSED_UPDATE_KEY]) || '');
      });
    } catch {
      resolve('');
    }
  });
}

function writeDismissedUpdateVersion(version) {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.set({ [DISMISSED_UPDATE_KEY]: version || '' }, () => resolve());
    } catch {
      resolve();
    }
  });
}

let lastShownUpdate = null;

async function maybeShowOptionalUpdate(update) {
  if (!update?.available) {
    optionalUpdateNotice.style.display = 'none';
    lastShownUpdate = null;
    return;
  }

  const dismissedVersion = await readDismissedUpdateVersion();
  const latestVersion = update.latestPublishedVersion || '';
  if (dismissedVersion && latestVersion && dismissedVersion === latestVersion) {
    optionalUpdateNotice.style.display = 'none';
    return;
  }

  const message = update.latestPublishedVersion
    ? `${update.updateNotice} Latest: v${update.latestPublishedVersion}.`
    : update.updateNotice;

  optionalUpdateCopy.textContent = message;
  optionalUpdateLink.href = update.downloadUrl || '#';
  optionalUpdateLink.style.display = update.downloadUrl ? '' : 'none';
  optionalUpdateNotice.style.display = '';
  lastShownUpdate = update;

  if (optionalUpdateShown) return;
  optionalUpdateShown = true;
  showToast(message, 'success');
}

if (optionalUpdateClose) {
  optionalUpdateClose.addEventListener('click', async () => {
    optionalUpdateNotice.style.display = 'none';
    const v = lastShownUpdate?.latestPublishedVersion || '';
    if (v) await writeDismissedUpdateVersion(v);
  });
}

function bumpCounter() {
  sessionCount += 1;
  sessionCounter.textContent = `Added ${sessionCount} job${sessionCount !== 1 ? 's' : ''} this session`;
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function sanitizeFilename(str) {
  return String(str).replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, ' ').trim().substring(0, 60);
}

syncDatePickerVisibility();
