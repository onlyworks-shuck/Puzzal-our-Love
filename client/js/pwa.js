// ---------- Splash screen ----------
function hideSplash() {
  const splash = document.getElementById('splash-screen');
  if (!splash) return;
  splash.classList.add('splash-hide');
  setTimeout(() => splash.remove(), 450);
}

window.addEventListener('load', () => {
  setTimeout(hideSplash, 500);
});

// ---------- Service worker registration ----------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

// ---------- Install Puzzle Game button ----------
// History of this button, because it has now been wrong in two opposite
// directions:
//
//   1. It was visible unconditionally and pressing it did nothing whenever
//      the browser had never offered an install.
//   2. The fix for that hid it in the markup and revealed it *only* on
//      `beforeinstallprompt`. That is what broke sharing: the people a link
//      gets sent to are exactly the people that event never fires for, so
//      they saw no button at all and had no way in.
//
// `beforeinstallprompt` is Chromium-only, and it is additionally suppressed
// in the place a shared link is most likely to be opened — the in-app
// WebView inside WhatsApp/Messenger/Instagram/Telegram, which cannot install
// a PWA at all. It also never fires on any iOS browser, on Firefox, or on
// Safari. In every one of those cases the app is still perfectly
// installable, just by hand, so the button stays visible and explains how.
// The app itself meets the install criteria (valid manifest, real 192/512
// icons, a service worker with a fetch handler) — only the offer was missing.
const INSTALLED_KEY = 'wc_pwa_installed';
let deferredInstallPrompt = null;
const installBtn = document.getElementById('install-btn');
const ua = navigator.userAgent || '';

const isStandalone =
  window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

// iPadOS 13+ reports itself as "Macintosh", so a UA test alone misses iPads
// entirely — a touch-capable Mac UA is an iPad.
const isIos = /iP(hone|ad|od)/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);

// Social/messenger in-app browsers. These never fire `beforeinstallprompt`
// and cannot install a PWA at all; the link has to be reopened in the real
// browser first. `; wv)` is the Android WebView marker used by Telegram,
// Slack, Discord and friends.
const isInAppBrowser =
  /FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|WhatsApp|Snapchat|TikTok|Pinterest|LinkedInApp|GSA\//i.test(
    ua
  ) || /; wv\)/.test(ua);

const isFirefox = /Firefox\/|FxiOS/.test(ua);
const isSamsung = /SamsungBrowser/.test(ua);
const isAndroid = /Android/.test(ua);
const isMacSafari =
  !isIos && /Macintosh/.test(ua) && /Safari/.test(ua) && !/Chrome|Chromium|Edg/.test(ua);

// Browsers that own the native one-tap install flow. Used only to decide
// whether a click is worth waiting on the event for.
const supportsInstallPrompt =
  !isIos && !isInAppBrowser && !isFirefox && (/Chrome\/|Chromium\/|Edg\//.test(ua) || isSamsung);

function markInstalled() {
  try {
    localStorage.setItem(INSTALLED_KEY, '1');
  } catch (err) {
    /* private mode — the standalone check still covers the common case */
  }
  deferredInstallPrompt = null;
  installBtn?.classList.add('hidden');
}

function alreadyInstalled() {
  if (isStandalone) return true;
  try {
    return localStorage.getItem(INSTALLED_KEY) === '1';
  } catch (err) {
    return false;
  }
}

function showInstallButton() {
  if (!installBtn || alreadyInstalled()) return;
  installBtn.classList.remove('hidden');
}

// Chrome/Edge/Android: the event means an install is genuinely on offer. It
// is also proof the app is *not* installed right now, so it clears a stale
// flag — otherwise uninstalling the app left `wc_pwa_installed` behind and
// the button never came back.
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  try {
    localStorage.removeItem(INSTALLED_KEY);
  } catch (err) {
    /* nothing to clear */
  }
  if (installBtn && !isStandalone) installBtn.classList.remove('hidden');
});

// Running inside the installed app is proof it is installed, even on a
// device where the flag was never written (different browser profile, or
// storage cleared). Otherwise the button is offered to everyone.
if (isStandalone) markInstalled();
else showInstallButton();

// Chrome can also confirm an install directly, which covers the case where
// the app was installed before this flag existed. This only ever answers
// anything because manifest.json now declares the app under
// `related_applications` — without that entry there is nothing for Chrome to
// match against and the call always resolved to an empty list, so the check
// had been dead code since it was written.
function checkInstalledRelatedApps() {
  if (!navigator.getInstalledRelatedApps) return Promise.resolve(false);
  return navigator
    .getInstalledRelatedApps()
    .then((apps) => !!(apps && apps.length > 0))
    .catch(() => false);
}

if (navigator.getInstalledRelatedApps) {
  checkInstalledRelatedApps()
    .then((installed) => {
      if (installed) markInstalled();
    })
    .catch(() => {});
}

// ---------- Manual install instructions ----------
// Every branch here is a real environment a shared link lands in. The steps
// are deliberately specific: "use your browser menu" is what the old toast
// said, and it is useless on a phone where the item is two levels down and
// named differently in every browser.
function installInstructions() {
  if (isInAppBrowser) {
    return {
      intro:
        "This in-app browser can't install apps. Open the link in your normal browser first — it only takes a second.",
      steps: [
        'Tap the &#8942; or &#8943; menu in the corner of this window.',
        'Choose <b>Open in browser</b> (or <b>Open in Chrome</b> / <b>Open in Safari</b>).',
        'Tap <b>Install Puzzle Game</b> again on that page.'
      ],
      offerCopy: true
    };
  }

  if (isIos) {
    return {
      intro: 'On iPhone and iPad, apps are added from the Share menu.',
      steps: [
        'Tap the <b>Share</b> button (the square with an arrow).',
        'Scroll down and tap <b>Add to Home Screen</b>.',
        'Tap <b>Add</b> — the game appears on your home screen.'
      ],
      offerCopy: false
    };
  }

  if (isFirefox) {
    return {
      intro: isAndroid
        ? 'Firefox installs this app from its menu.'
        : 'Firefox on desktop cannot install web apps — Chrome or Edge can.',
      steps: isAndroid
        ? [
            'Tap the <b>&#8942;</b> menu at the top right.',
            'Tap <b>Install</b> (or <b>Add to Home screen</b>).',
            'Confirm — the game appears on your home screen.'
          ]
        : [
            'Open this same link in <b>Chrome</b> or <b>Edge</b>.',
            'Click the install icon (&#8853;) at the right of the address bar.',
            'On a phone, Firefox can install it from its &#8942; menu.'
          ],
      offerCopy: false
    };
  }

  if (isSamsung) {
    return {
      intro: 'Samsung Internet installs this app from its menu.',
      steps: [
        'Tap the <b>&#8801;</b> menu at the bottom right.',
        'Tap <b>Add page to</b>, then <b>Home screen</b>.',
        'Confirm — the game appears on your home screen.'
      ],
      offerCopy: false
    };
  }

  if (isMacSafari) {
    return {
      intro: 'Safari on Mac adds web apps to the Dock.',
      steps: [
        'Open the <b>File</b> menu in the menu bar.',
        'Choose <b>Add to Dock</b>.',
        'Click <b>Add</b> — the game opens like a normal app.'
      ],
      offerCopy: false
    };
  }

  if (isAndroid) {
    return {
      intro: 'Your browser can add this game to your home screen.',
      steps: [
        'Tap the <b>&#8942;</b> menu at the top right.',
        'Tap <b>Install app</b> (or <b>Add to Home screen</b>).',
        'Confirm — the game appears on your home screen.'
      ],
      offerCopy: false
    };
  }

  return {
    intro: 'Your browser can install this game as a desktop app.',
    steps: [
      'Look for the install icon (&#8853;) at the right of the address bar and click it.',
      'If it is not there, open the <b>&#8942;</b> menu and choose <b>Install page as app</b> (under <b>Cast, save and share</b> in newer Chrome).',
      'Click <b>Install</b> — the game opens in its own window.'
    ],
    offerCopy: false
  };
}

const helpModal = document.getElementById('install-help-modal');
const helpIntro = document.getElementById('install-help-intro');
const helpSteps = document.getElementById('install-help-steps');
const helpCopyBtn = document.getElementById('install-help-copy');

function closeInstallHelp() {
  helpModal?.classList.add('hidden');
  document.querySelector('.install-help-fallback-input')?.remove();
}

function openInstallHelp() {
  const info = installInstructions();

  // No modal in the DOM (an older cached index.html) — never leave the press
  // with no feedback at all, which is the failure this button keeps having.
  if (!helpModal || !helpIntro || !helpSteps) {
    if (typeof toast === 'function') toast(info.intro);
    return;
  }

  document.querySelector('.install-help-fallback-input')?.remove();
  helpIntro.innerHTML = info.intro;
  helpSteps.innerHTML = info.steps.map((step) => '<li>' + step + '</li>').join('');
  helpCopyBtn?.classList.toggle('hidden', !info.offerCopy);
  if (helpCopyBtn) helpCopyBtn.textContent = 'Copy link';
  helpModal.classList.remove('hidden');
}

document.getElementById('install-help-close')?.addEventListener('click', closeInstallHelp);
document.getElementById('install-help-ok')?.addEventListener('click', closeInstallHelp);
helpModal?.addEventListener('click', (e) => {
  if (e.target === helpModal) closeInstallHelp();
});

helpCopyBtn?.addEventListener('click', async () => {
  const link = window.location.href;
  try {
    await navigator.clipboard.writeText(link);
    helpCopyBtn.textContent = 'Link copied!';
  } catch (err) {
    // The clipboard API is blocked in a lot of in-app WebViews, which is
    // exactly where this button is shown. Fall back to a selected input so
    // the link can be copied by hand rather than failing silently.
    document.querySelector('.install-help-fallback-input')?.remove();
    const field = document.createElement('input');
    field.value = link;
    field.setAttribute('readonly', '');
    field.className = 'install-help-fallback-input';
    helpCopyBtn.insertAdjacentElement('beforebegin', field);
    field.select();
    field.setSelectionRange(0, link.length);
    helpCopyBtn.textContent = 'Copy the link above';
  }
});

// Chromium fires `beforeinstallprompt` a moment after load. If the button is
// pressed inside that window, wait briefly for the real prompt instead of
// showing manual steps the browser was about to make unnecessary.
function waitForPrompt(ms) {
  if (deferredInstallPrompt) return Promise.resolve(deferredInstallPrompt);
  if (!supportsInstallPrompt) return Promise.resolve(null);

  return new Promise((resolve) => {
    const onPrompt = () => {
      clearTimeout(timer);
      window.removeEventListener('beforeinstallprompt', onPrompt);
      // The listener registered above has already stored and defaulted it.
      resolve(deferredInstallPrompt);
    };
    const timer = setTimeout(() => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      resolve(deferredInstallPrompt);
    }, ms);

    window.addEventListener('beforeinstallprompt', onPrompt);
  });
}

installBtn?.addEventListener('click', async () => {
  installBtn.disabled = true;
  try {
    const promptEvent = await waitForPrompt(1200);

    if (!promptEvent) {
      // On a browser that *does* have the one-tap flow, the usual reason no
      // event arrived is that the app is already installed — Chrome stops
      // offering an install it has already performed. Handing that person a
      // page of manual steps is the single most confusing thing this button
      // can do, so ask before assuming.
      if (supportsInstallPrompt && (await checkInstalledRelatedApps())) {
        markInstalled();
        if (typeof toast === 'function') {
          toast('Already installed — open 2048 Puzzle from your home screen.');
        }
        return;
      }
      openInstallHelp();
      return;
    }

    // Cleared before awaiting: a prompt event can only be used once, so a
    // second click while the dialog is open must not try to reuse it.
    deferredInstallPrompt = null;

    // prompt() returns a promise, and it *rejects* on the cases that really
    // happen here — an event a previous click already spent, or one whose
    // user activation ran out. Calling it without awaiting left that
    // rejection unhandled, which is a page-level error the browser reports
    // in full, stack and all, while the button itself did nothing. Awaited,
    // it lands in the catch below and falls back to the manual steps.
    const promptResult = await promptEvent.prompt();

    // Newer Chromium resolves prompt() with the choice directly; older
    // builds only carry it on userChoice. Read whichever one answered.
    const { outcome } = promptResult && promptResult.outcome ? promptResult : await promptEvent.userChoice;
    if (outcome === 'accepted') {
      markInstalled();
      // The button vanishing was the only feedback the old flow ever gave —
      // indistinguishable from doing nothing. There is no install progress
      // bar to show (the OS adds the icon almost instantly), so say so
      // directly instead of leaving the user staring at where it used to be.
      if (typeof toast === 'function') toast('Installing… look for it on your home screen.');
    } else {
      // Dismissed — the browser fires beforeinstallprompt again on a later
      // visit, so leave the button up for another try.
      showInstallButton();
    }
  } catch (err) {
    // `prompt()` throws rather than returns on the cases that actually come
    // up in the wild: an event already consumed by an earlier click, or one
    // whose user activation expired while we waited. Without this catch the
    // rejection is unhandled and the press produces nothing at all — the
    // exact "the button does nothing / errors" report this file keeps
    // getting. Fall back to the manual steps, which always work.
    showInstallButton();
    openInstallHelp();
  } finally {
    installBtn.disabled = false;
  }
});

window.addEventListener('appinstalled', () => {
  markInstalled();
  closeInstallHelp();
  if (typeof toast === 'function') toast('2048 Puzzle installed!');
});
