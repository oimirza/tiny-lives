// "Add to Home Screen" helper: when the game is opened in a phone browser (not from the home-screen icon),
// show how to install it so it launches full screen like an app.

const ua = navigator.userAgent;
const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = /Android/.test(ua);
// Links opened inside Instagram / Facebook / TikTok etc. can't be added to the home screen
const inApp = /Instagram|FBAN|FBAV|FB_IAB|FBIOS|Line\/|TikTok|musical_ly|Bytedance|Snapchat|Twitter|LinkedInApp/i.test(ua);
const isTouch = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

export const installed = () =>
  window.matchMedia('(display-mode: fullscreen)').matches ||
  window.matchMedia('(display-mode: standalone)').matches ||
  navigator.standalone === true;

const ICON_SHARE = '<svg viewBox="0 0 24 24" class="ico"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 10H6a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1h-2" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
const ICON_ADD = '<svg viewBox="0 0 24 24" class="ico"><rect x="3.5" y="3.5" width="17" height="17" rx="4" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M12 8v8M8 12h8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
const ICON_DOTS = '<svg viewBox="0 0 24 24" class="ico"><circle cx="12" cy="5" r="2.2" fill="currentColor"/><circle cx="12" cy="12" r="2.2" fill="currentColor"/><circle cx="12" cy="19" r="2.2" fill="currentColor"/></svg>';

function steps() {
  if (inApp) {
    return `<p class="instLead">This page is open inside another app. Open it in <b>${isIOS ? 'Safari' : 'Chrome'}</b> first:</p>
      <ol class="instSteps">
        <li>Tap the <b>⋯</b> or ${ICON_DOTS} menu at the top</li>
        <li>Tap <b>Open in browser</b> ${isIOS ? '(or <b>Open in Safari</b>)' : '(or <b>Open in Chrome</b>)'}</li>
        <li>Then add it to your home screen from there</li>
      </ol>`;
  }
  if (isIOS) {
    return `<ol class="instSteps">
        <li>Tap the <b>Share</b> button ${ICON_SHARE} <small>(bottom of Safari, or top-right in Chrome)</small></li>
        <li>Scroll down and tap <b>Add to Home Screen</b> ${ICON_ADD}</li>
        <li>Tap <b>Add</b>, then open <b>Tiny Lives</b> from your home screen</li>
      </ol>`;
  }
  return `<button id="instNow" class="jelly hidden">INSTALL</button>
    <ol class="instSteps">
      <li>Tap the ${ICON_DOTS} menu <small>(top-right of Chrome)</small></li>
      <li>Tap <b>Add to Home screen</b> or <b>Install app</b></li>
      <li>Tap <b>Install</b>, then open <b>Tiny Lives</b> from your home screen</li>
    </ol>`;
}

export function setupInstall() {
  const pill = document.getElementById('installPill');
  const box = document.getElementById('install');
  if (!pill || !box) return;
  if (installed() || !isTouch) return; // already an app, or on a computer: nothing to do

  let deferred = null;
  document.getElementById('instBody').innerHTML = steps();
  const nowBtn = document.getElementById('instNow');

  const open = () => box.classList.remove('hidden');
  const close = () => box.classList.add('hidden');
  pill.classList.remove('hidden');
  pill.addEventListener('click', open);
  document.getElementById('instClose').addEventListener('click', close);
  box.addEventListener('click', (e) => { if (e.target === box) close(); });

  // Android Chrome can install with one tap
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    nowBtn?.classList.remove('hidden');
  });
  nowBtn?.addEventListener('click', async () => {
    if (!deferred) return;
    deferred.prompt();
    const { outcome } = await deferred.userChoice.catch(() => ({}));
    deferred = null;
    nowBtn.classList.add('hidden');
    if (outcome === 'accepted') close();
  });
  window.addEventListener('appinstalled', () => { close(); pill.classList.add('hidden'); });

  open();
}

export { isIOS, isAndroid, inApp };
