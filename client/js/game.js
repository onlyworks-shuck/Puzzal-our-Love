const BOARD_SIZE = 4;
const BEST_SCORE_KEY = 'wc_2048_best';
const MOVE_KEYS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
const ANIMATION_MS = 140;

const gameView = document.getElementById('game-view');
const chatRoot = document.getElementById('chat-root');
const boardEl = document.getElementById('game-board');
const scoreEl = document.getElementById('game-score');
const bestEl = document.getElementById('game-best');
const overlayEl = document.getElementById('game-overlay');
const overlayMessageEl = document.getElementById('game-overlay-message');
const overlayBtnEl = document.getElementById('game-overlay-btn');

// Each tile is a live object with a stable id, so its DOM element can persist
// across moves and be animated (FLIP technique) instead of being torn down
// and rebuilt every render, which is what makes the sliding feel real.
let tiles = [];
let nextTileId = 1;
let score = 0;
let best = Number(localStorage.getItem(BEST_SCORE_KEY)) || 0;
let isGameOver = false;
let hasAnnouncedWin = false;
let isAnimating = false;

const tileEls = new Map();

function tileAt(r, c) {
  return tiles.find((t) => t.r === r && t.c === c);
}

function emptyCells() {
  const cells = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (!tileAt(r, c)) cells.push([r, c]);
    }
  }
  return cells;
}

function spawnRandomTile() {
  const cells = emptyCells();
  if (!cells.length) return null;
  const [r, c] = cells[Math.floor(Math.random() * cells.length)];
  const tile = { id: nextTileId++, r, c, value: Math.random() < 0.9 ? 2 : 4 };
  tiles.push(tile);
  return tile;
}

// Coordinates for row/column `index`, ordered from the side tiles collapse
// toward, to the far side.
function getLine(direction, index) {
  const range = [0, 1, 2, 3];
  if (direction === 'left') return range.map((c) => [index, c]);
  if (direction === 'right') return range.slice().reverse().map((c) => [index, c]);
  if (direction === 'up') return range.map((r) => [r, index]);
  return range.slice().reverse().map((r) => [r, index]);
}

// A vibrant, rainbow-style palette matching the app icon's branding, rather
// than a single hue that just gets darker — every tile value gets its own
// bold color.
const TILE_PALETTE = [
  { bg: '#FF9F43', color: '#ffffff' }, // 2
  { bg: '#EC4899', color: '#ffffff' }, // 4
  { bg: '#2ECC71', color: '#ffffff' }, // 8
  { bg: '#29B6F6', color: '#ffffff' }, // 16
  { bg: '#22D3D3', color: '#ffffff' }, // 32
  { bg: '#9B6BFF', color: '#ffffff' }, // 64
  { bg: '#FF6B6B', color: '#ffffff' }, // 128
  { bg: '#C0392B', color: '#ffffff' }, // 256
  { bg: '#FFC93C', color: '#3d2c00' }, // 512
  { bg: '#6C3FC5', color: '#ffffff' }, // 1024
  { bg: '#FFD700', color: '#3d2c00' } // 2048
];

function tileStyle(value) {
  const exponent = Math.log2(value);
  const entry = TILE_PALETTE[(exponent - 1) % TILE_PALETTE.length];
  return { bg: entry.bg, color: entry.color };
}

function createTileEl(tile) {
  const el = document.createElement('div');
  el.className = 'game-tile';
  boardEl.appendChild(el);
  tileEls.set(tile.id, el);
  return el;
}

function placeTileEl(el, r, c, value) {
  el.style.gridRow = String(r + 1);
  el.style.gridColumn = String(c + 1);
  el.textContent = String(value);
  const { bg, color } = tileStyle(value);
  el.style.background = bg;
  el.style.color = color;
}

function updateScoreDisplay(scoreIncreased) {
  scoreEl.textContent = String(score);
  bestEl.textContent = String(best);
  if (scoreIncreased) bump(scoreEl.parentElement, 'score-bump');
}

function bump(el, className) {
  el.classList.remove(className);
  void el.offsetWidth;
  el.classList.add(className);
}

function hasMovesLeft() {
  if (emptyCells().length) return true;
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const v = tileAt(r, c)?.value;
      if (!v) continue;
      if (tileAt(r, c + 1)?.value === v) return true;
      if (tileAt(r + 1, c)?.value === v) return true;
    }
  }
  return false;
}

function move(direction) {
  if (isAnimating || isGameOver) return;

  let moved = false;
  let scoreGained = 0;
  const mergedSurvivorIds = [];
  const removedTiles = []; // { tile, targetR, targetC }

  for (let i = 0; i < BOARD_SIZE; i++) {
    const coords = getLine(direction, i);
    const lineTiles = coords.map(([r, c]) => tileAt(r, c)).filter(Boolean);

    let writeIdx = 0;
    let k = 0;
    while (k < lineTiles.length) {
      const cur = lineTiles[k];
      const next = lineTiles[k + 1];
      const [tr, tc] = coords[writeIdx];

      if (next && next.value === cur.value) {
        if (cur.r !== tr || cur.c !== tc) moved = true;
        cur.r = tr;
        cur.c = tc;
        cur.value *= 2;
        scoreGained += cur.value;
        mergedSurvivorIds.push(cur.id);
        removedTiles.push({ tile: next, targetR: tr, targetC: tc });
        moved = true;
        k += 2;
      } else {
        if (cur.r !== tr || cur.c !== tc) moved = true;
        cur.r = tr;
        cur.c = tc;
        k += 1;
      }
      writeIdx++;
    }
  }

  if (!moved) return;

  isAnimating = true;

  const beforeRects = new Map();
  tileEls.forEach((el, id) => beforeRects.set(id, el.getBoundingClientRect()));

  score += scoreGained;
  const gotNewBest = score > best;
  if (gotNewBest) {
    best = score;
    localStorage.setItem(BEST_SCORE_KEY, String(best));
  }

  const removedIds = new Set(removedTiles.map((r) => r.tile.id));
  tiles = tiles.filter((t) => !removedIds.has(t.id));

  flipAnimate(beforeRects, removedTiles, mergedSurvivorIds, scoreGained > 0);
}

function flipAnimate(beforeRects, removedTiles, mergedSurvivorIds, scoreGained) {
  tiles.forEach((t) => {
    const el = tileEls.get(t.id) || createTileEl(t);
    placeTileEl(el, t.r, t.c, t.value);
  });

  removedTiles.forEach(({ tile, targetR, targetC }) => {
    const el = tileEls.get(tile.id);
    if (el) placeTileEl(el, targetR, targetC, tile.value);
  });

  // Invert: snap every tile that already existed back to where it *visually*
  // was, using a transform delta, with transitions disabled.
  beforeRects.forEach((oldRect, id) => {
    const el = tileEls.get(id);
    if (!el) return;
    const newRect = el.getBoundingClientRect();
    const dx = oldRect.left - newRect.left;
    const dy = oldRect.top - newRect.top;
    el.style.transition = 'none';
    el.style.transform = dx || dy ? `translate(${dx}px, ${dy}px)` : '';
  });

  void boardEl.offsetHeight;

  // Play: clear the inversion on the next frame so the stylesheet's
  // transition animates each tile smoothly to its true position.
  requestAnimationFrame(() => {
    beforeRects.forEach((_, id) => {
      const el = tileEls.get(id);
      if (!el) return;
      el.style.transition = '';
      el.style.transform = '';
    });
  });

  window.setTimeout(() => {
    removedTiles.forEach(({ tile }) => {
      const el = tileEls.get(tile.id);
      if (el) {
        el.remove();
        tileEls.delete(tile.id);
      }
    });

    mergedSurvivorIds.forEach((id) => {
      const el = tileEls.get(id);
      if (el) bump(el, 'tile-merge-pop');
    });

    const spawned = spawnRandomTile();
    if (spawned) {
      const el = createTileEl(spawned);
      placeTileEl(el, spawned.r, spawned.c, spawned.value);
      el.classList.add('tile-spawn');
    }

    updateScoreDisplay(scoreGained);

    if (!hasAnnouncedWin && tiles.some((t) => t.value >= 2048)) {
      hasAnnouncedWin = true;
      launchConfetti();
      showOverlay('You win! 🎉', 'Keep Going');
    } else if (!hasMovesLeft()) {
      isGameOver = true;
      showOverlay('Game Over', 'Try Again');
    }

    isAnimating = false;
  }, ANIMATION_MS);
}

function showOverlay(message, buttonLabel) {
  overlayMessageEl.textContent = message;
  overlayBtnEl.textContent = buttonLabel;
  overlayEl.classList.remove('hidden');
}

function hideOverlay() {
  overlayEl.classList.add('hidden');
}

function launchConfetti() {
  const colors = ['#25D366', '#128C7E', '#075E54', '#53bdeb', '#d9fdd3'];
  for (let i = 0; i < 24; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = colors[i % colors.length];
    piece.style.animationDelay = `${Math.random() * 0.3}s`;
    piece.style.setProperty('--drift', `${(Math.random() - 0.5) * 160}px`);
    boardEl.parentElement.appendChild(piece);
    piece.addEventListener('animationend', () => piece.remove());
  }
}

function startNewGame() {
  tileEls.forEach((el) => el.remove());
  tileEls.clear();
  tiles = [];
  score = 0;
  isGameOver = false;
  hasAnnouncedWin = false;
  isAnimating = false;
  hideOverlay();

  [spawnRandomTile(), spawnRandomTile()].forEach((t) => {
    const el = createTileEl(t);
    placeTileEl(el, t.r, t.c, t.value);
    el.classList.add('tile-spawn');
  });

  updateScoreDisplay(false);
}

document.addEventListener('keydown', (e) => {
  if (gameView.classList.contains('hidden')) return;
  const direction = MOVE_KEYS[e.key];
  if (!direction) return;
  e.preventDefault();
  move(direction);
});

let touchStartX = 0;
let touchStartY = 0;
const SWIPE_THRESHOLD = 24;

boardEl.addEventListener('touchstart', (e) => {
  const t = e.changedTouches[0];
  touchStartX = t.clientX;
  touchStartY = t.clientY;
}, { passive: true });

boardEl.addEventListener('touchend', (e) => {
  const t = e.changedTouches[0];
  const dx = t.clientX - touchStartX;
  const dy = t.clientY - touchStartY;
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  if (Math.max(absX, absY) < SWIPE_THRESHOLD) return;

  if (absX > absY) move(dx > 0 ? 'right' : 'left');
  else move(dy > 0 ? 'down' : 'up');
}, { passive: true });

document.getElementById('reset-btn').addEventListener('click', startNewGame);

overlayBtnEl.addEventListener('click', () => {
  if (isGameOver) startNewGame();
  else hideOverlay();
});

// ---------- Settings panel (Day/Night + hidden chat entry) ----------
const THEME_KEY = 'wc_theme';
const settingsModal = document.getElementById('settings-modal');
const gameThemeToggle = document.getElementById('game-theme-toggle');

(function initGameTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved) document.documentElement.setAttribute('data-theme', saved);
  gameThemeToggle.checked = saved === 'dark';
})();

gameThemeToggle.addEventListener('change', (e) => {
  const theme = e.target.checked ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(THEME_KEY, theme);
});

document.getElementById('settings-btn').addEventListener('click', () => {
  settingsModal.classList.remove('hidden');
});
document.getElementById('settings-close').addEventListener('click', () => {
  settingsModal.classList.add('hidden');
});

// ---------- Password gate for the hidden chat ----------
// The actual check happens server-side (see js/secret.js -> Api.unlockSecret
// -> api/secret/unlock.js) so the password is never trusted
// client-side and the server never returns room data to a session that
// hasn't proven it knows the password.
const passwordModal = document.getElementById('puzzle-password-modal');
const passwordForm = document.getElementById('puzzle-password-form');
const passwordInput = document.getElementById('puzzle-password-input');
const passwordError = document.getElementById('puzzle-password-error');
const passwordSubmitBtn = passwordForm.querySelector('button[type="submit"]');
const PASSWORD_ERROR_DEFAULT_TEXT = passwordError.textContent;

const decoyDashboard = document.getElementById('decoy-dashboard');
const loveRevealScreen = document.getElementById('love-reveal-screen');

function openChat() {
  gameView.classList.add('hidden');
  chatRoot.classList.remove('hidden');
}

// The guest-tier password shows a one-time reveal screen before the chat
// itself opens; every other tier (admin) goes straight to openChat().
function openLoveReveal() {
  loveRevealScreen.classList.remove('hidden');
}

document.getElementById('love-reveal-continue').addEventListener('click', () => {
  loveRevealScreen.classList.add('hidden');
  openChat();
});

function openPasswordPrompt() {
  passwordError.textContent = PASSWORD_ERROR_DEFAULT_TEXT;
  passwordError.classList.add('hidden');
  passwordForm.reset();
  passwordModal.classList.remove('hidden');
  passwordInput.focus();
}

function closePasswordPrompt() {
  passwordModal.classList.add('hidden');
}

// Any password that isn't one of the two real tiers lands here instead of
// an "incorrect password" retry prompt — a wrong guess must never hint that
// a secret chat exists behind this screen.
function showDecoyDashboard() {
  closePasswordPrompt();
  decoyDashboard.classList.remove('hidden');
}

document.getElementById('puzzle-password-cancel').addEventListener('click', closePasswordPrompt);
document.getElementById('decoy-dashboard-close').addEventListener('click', () => {
  decoyDashboard.classList.add('hidden');
});

passwordForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  passwordSubmitBtn.disabled = true;

  const result = await window.SecretChat.tryUnlock(passwordInput.value);

  passwordSubmitBtn.disabled = false;

  if (result.ok) {
    clearSecretFailCount();
    closePasswordPrompt();
    if (result.role === 'guest') openLoveReveal();
    else openChat();
  } else if (result.networkError) {
    passwordError.textContent = 'Could not reach the server. Try again.';
    passwordError.classList.remove('hidden');
    passwordForm.reset();
    passwordInput.focus();
    bump(passwordModal.querySelector('.modal'), 'password-shake');
  } else if (result.serverError) {
    // The server broke; the password may well have been right. Show the
    // error rather than burning a strike on it.
    passwordError.textContent = 'Something went wrong. Try again.';
    passwordError.classList.remove('hidden');
    passwordForm.reset();
    passwordInput.focus();
    bump(passwordModal.querySelector('.modal'), 'password-shake');
  } else {
    passwordForm.reset();
    // A wrong password still shows the decoy dashboard as before, up to the
    // strike limit — the 3rd strike closes the prompt instead, silently,
    // and locks the 10-tap trigger out until the next cooldown window.
    if (registerSecretFailure()) {
      closePasswordPrompt();
    } else {
      showDecoyDashboard();
    }
  }
});

// ---------- Daily lockout after repeated wrong passwords ----------
// After SECRET_MAX_ATTEMPTS wrong guesses in a day, the 10-tap trigger stops
// opening the password prompt at all (rather than just re-showing the decoy
// dashboard) until 4:30 PM the following day, to slow down brute-forcing.
const SECRET_FAIL_COUNT_KEY = 'wc_secret_fail_count';
const SECRET_LOCKOUT_UNTIL_KEY = 'wc_secret_lockout_until';
const SECRET_MAX_ATTEMPTS = 3;
const SECRET_LOCKOUT_HOUR = 16;
const SECRET_LOCKOUT_MINUTE = 30;
// Ceiling on how long a lockout can last. Long enough to make guessing the
// password impractical, short enough that a mistake doesn't cost the real
// owner their evening.
const SECRET_LOCKOUT_MAX_MS = 15 * 60 * 1000;

// Lockouts are capped when read, not just when written, so a lockout stored
// by an older build (which locked until the next afternoon) is shortened
// too. That matters because a server outage used to register as failed
// attempts: a browser could be locked out for most of a day over an error
// the user never caused, with no way to clear it short of wiping site data.
// Reading through the cap releases those on the next load.
function getSecretLockoutUntil() {
  const stored = Number(localStorage.getItem(SECRET_LOCKOUT_UNTIL_KEY)) || 0;
  if (!stored) return 0;

  // Anything further out than the current ceiling was written by the older
  // build, which locked until the next afternoon and counted server errors
  // as wrong guesses. Those lockouts record an outage, not a real failed
  // attempt, so they are discarded rather than merely shortened — otherwise
  // a browser stays locked over a fault that was never the user's doing.
  if (stored > Date.now() + SECRET_LOCKOUT_MAX_MS) {
    localStorage.removeItem(SECRET_LOCKOUT_UNTIL_KEY);
    localStorage.setItem(SECRET_FAIL_COUNT_KEY, '0');
    return 0;
  }
  return stored;
}

function isSecretLockedOut() {
  return Date.now() < getSecretLockoutUntil();
}

// Was "the next day at 16:30", which punished a mistyped password with most
// of a day's lockout. A short cooldown still makes guessing impractical
// (3 tries per window) without stranding the actual owner.
function nextDayUnlockTime(from) {
  return from + SECRET_LOCKOUT_MAX_MS;
}

function clearSecretFailCount() {
  localStorage.setItem(SECRET_FAIL_COUNT_KEY, '0');
}

// Returns true once the lockout has just been triggered by this failure.
function registerSecretFailure() {
  const count = (Number(localStorage.getItem(SECRET_FAIL_COUNT_KEY)) || 0) + 1;
  if (count >= SECRET_MAX_ATTEMPTS) {
    localStorage.setItem(SECRET_LOCKOUT_UNTIL_KEY, String(nextDayUnlockTime(Date.now())));
    clearSecretFailCount();
    return true;
  }
  localStorage.setItem(SECRET_FAIL_COUNT_KEY, String(count));
  return false;
}

// ---------- Hidden 10-tap trigger for the secret chat ----------
// Tapping/clicking anywhere 10 times in a row opens the same password
// prompt that used to be reached via Settings -> Enter (that button has
// been removed; this is now the only way in). Suppressed while a modal is
// already open or the chat itself is showing, so it can't fire mid-typing
// or double-prompt over the secret room.
const SECRET_TAP_COUNT = 10;
// Any gap at least this long between two taps breaks the streak — kept
// under 1s so the "pause for a second, then keep tapping" case always resets.
const SECRET_TAP_MAX_GAP_MS = 600;
// Hard ceiling on the whole sequence even if every individual gap is small.
const SECRET_TAP_TOTAL_WINDOW_MS = 10000;
let secretTapCount = 0;
let secretTapFirstTime = 0;
let secretTapLastTime = 0;

document.addEventListener('click', () => {
  const gameVisible = !gameView.classList.contains('hidden');
  const modalOpen =
    !passwordModal.classList.contains('hidden') ||
    !settingsModal.classList.contains('hidden') ||
    !decoyDashboard.classList.contains('hidden');
  if (!gameVisible || modalOpen) return;

  const now = Date.now();
  const staleGap = secretTapCount > 0 && (now - secretTapLastTime) >= SECRET_TAP_MAX_GAP_MS;
  const staleWindow = secretTapCount > 0 && (now - secretTapFirstTime) >= SECRET_TAP_TOTAL_WINDOW_MS;
  if (staleGap || staleWindow) {
    secretTapCount = 0;
  }

  if (secretTapCount === 0) secretTapFirstTime = now;
  secretTapLastTime = now;
  secretTapCount += 1;

  if (secretTapCount >= SECRET_TAP_COUNT) {
    secretTapCount = 0;
    if (isSecretLockedOut()) {
      // Doing nothing at all here is indistinguishable from the app being
      // broken — which is exactly how a stale lockout got reported as "the
      // link doesn't work". The decoy is what a wrong password already
      // shows, so it gives feedback without hinting anything is hidden.
      showDecoyDashboard();
    } else {
      openPasswordPrompt();
    }
  }
});

startNewGame();
