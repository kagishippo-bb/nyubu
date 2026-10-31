/* カギしっぽバスケ部・12か月の間違い探し。静的 file:// で動く。 */
(() => {
  'use strict';

  const main = document.getElementById('main');
  const overall = document.getElementById('overall-progress');
  const toast = document.getElementById('toast');
  const data = window.GAME_DATA;
  // ごほうびの絵（仕事646・gohoubi.js）を月に足す。なければ今までどおり
  const gohoubi = window.GOHOUBI || {};
  (data.months || []).forEach(m => { if (gohoubi[m.id]) Object.assign(m, gohoubi[m.id]); });
  // かくれトウモロコシ（ごほうびの3段目・仕事661・corn.js）：むずかしいの絵に毎月1本。違いの数には入れない。
  // むずかしいで遊ぶときだけ、もとの絵にも同じ1本を足した絵を出す（6つ目の違いに見えないように・10/31 間違い探し部門）
  const CORN = window.CORN || {};
  const cornOf = month => CORN.months?.[month?.id] || null;
  const STORE = 'kagishippo-difference-unselected-633-v1';
  const LEVELS = ['normal', 'hard'];
  const levelName = {normal: 'ふつう', hard: 'むずかしい'};
  const view = {screen: 'home', month: null, level: 'normal', hint: 0, revealed: false, hintIndex: null, endingAt: null};
  let pointerDown = null;
  let toastTimer = null;

  // Coordinates are fractions of one untransformed picture viewport. The
  // same transform belongs to both images and their answer/hint markers.
  function limitPictureZoom(value) {
    const scale = Math.max(1, Math.min(4, Number(value.scale) || 1));
    const bound = 1 - scale;
    return {scale, x: Math.max(bound, Math.min(0, Number(value.x) || 0)),
                   y: Math.max(bound, Math.min(0, Number(value.y) || 0))};
  }
  function sourcePicturePoint(point, zoom) {
    if (point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) return null;
    const x = (point.x - zoom.x) / zoom.scale, y = (point.y - zoom.y) / zoom.scale;
    return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? {x, y} : null;
  }
  function pictureTransform(zoom) {
    return `translate(${zoom.x * 100}%, ${zoom.y * 100}%) scale(${zoom.scale})`;
  }
  function pinchSnapshot(points, rect, zoom) {
    if (points.length !== 2 || !rect.width || !rect.height) return null;
    const distance = Math.hypot(points[1].x-points[0].x, points[1].y-points[0].y);
    if (distance < 8) return null;
    const center = {x: ((points[0].x+points[1].x)/2-rect.left)/rect.width,
                    y: ((points[0].y+points[1].y)/2-rect.top)/rect.height};
    return {distance, scale: zoom.scale,
            anchor: {x: (center.x-zoom.x)/zoom.scale, y: (center.y-zoom.y)/zoom.scale}};
  }
  function zoomFromPinch(snapshot, points, rect) {
    if (!snapshot || points.length !== 2 || !rect.width || !rect.height) return null;
    const distance = Math.hypot(points[1].x-points[0].x, points[1].y-points[0].y);
    const scale = Math.max(1, Math.min(4, snapshot.scale * distance/snapshot.distance));
    const center = {x: ((points[0].x+points[1].x)/2-rect.left)/rect.width,
                    y: ((points[0].y+points[1].y)/2-rect.top)/rect.height};
    return limitPictureZoom({scale, x: center.x-snapshot.anchor.x*scale,
                                   y: center.y-snapshot.anchor.y*scale});
  }
  class PictureTouchGesture {
    constructor() { this.reset(); }
    reset() { this.active = false; this.multi = false; this.cancelled = false; this.moved = false; this.startPoint = null; this.pinch = null; }
    start(points, rect, zoom) {
      if (!points.length) return;
      if (!this.active) { this.reset(); this.active = true; this.startPoint = {...points[0]}; }
      if (points.length > 1) this.multi = true;
      this.pinch = !this.cancelled && points.length === 2 ? pinchSnapshot(points, rect, zoom) : null;
    }
    move(points, rect, zoom) {
      if (!this.active) return null;
      const first = points.find(p => p.id === this.startPoint?.id);
      if (first && Math.hypot(first.x-this.startPoint.x, first.y-this.startPoint.y) > 14) this.moved = true;
      if (points.length > 1) this.multi = true;
      if (this.cancelled || !this.multi || points.length !== 2) { this.pinch = null; return null; }
      if (!this.pinch) { this.pinch = pinchSnapshot(points, rect, zoom); return null; }
      return zoomFromPinch(this.pinch, points, rect);
    }
    finish(points, ended, rect, zoom) {
      const wasMulti = this.multi;
      if (!this.active) return {tap: false, wasMulti};
      if (points.length) {
        // After any finger lifts, do not reinterpret a surviving finger as
        // a new one-finger tap. A new two-finger pair may continue moving.
        this.multi = true;
        this.pinch = !this.cancelled && points.length === 2 ? pinchSnapshot(points, rect, zoom) : null;
        return {tap: false, wasMulti: true};
      }
      const point = ended.find(p => p.id === this.startPoint?.id);
      const tap = !!point && !this.multi && !this.cancelled && !this.moved &&
                  Math.hypot(point.x-this.startPoint.x, point.y-this.startPoint.y) <= 14;
      this.reset();
      return {tap, point, wasMulti};
    }
    cancel(remainingCount = 0) {
      if (!remainingCount) return this.reset();
      this.active = true; this.multi = true; this.cancelled = true; this.pinch = null;
    }
  }
  const pictureZoom = {scale: 1, x: 0, y: 0};
  const touchGesture = new PictureTouchGesture();
  let touchStage = null;
  let touchBlockedUntilLift = false;
  let safariGestureOwned = false;
  let fitFrame = 0;
  // Keep both complete 4:3 pictures within the current portrait viewport.
  // Measure the actual controls instead of assuming an iPad-sized header.
  function fitPicturePair() {
    if (view.screen !== 'play') return;
    const grid = main.querySelector('.picture-grid');
    if (!grid) return;
    if (matchMedia('(min-width: 700px) and (orientation: landscape)').matches) {
      grid.style.removeProperty('width');
      return;
    }
    const top = grid.getBoundingClientRect().top + window.scrollY;
    const height = window.visualViewport?.height || window.innerHeight;
    const headingsAndGap = 38;
    const padding = getComputedStyle(main);
    const availableWidth = main.clientWidth - parseFloat(padding.paddingLeft) - parseFloat(padding.paddingRight);
    const width = Math.floor(Math.max(80, Math.min(availableWidth, (height - top - headingsAndGap - 8) / 1.5)));
    grid.style.width = `${width}px`;
  }
  function schedulePictureFit() {
    cancelAnimationFrame(fitFrame);
    fitFrame = requestAnimationFrame(fitPicturePair);
  }
  window.addEventListener('resize', schedulePictureFit, {passive: true});
  window.visualViewport?.addEventListener('resize', schedulePictureFit, {passive: true});

  let soundEnabled = true;
  try { soundEnabled = localStorage.getItem('kagishippo-sound') !== 'off'; } catch (_) {}
  let soundContext = null;
  function foundSound(complete = false) {
    if (!soundEnabled) return;
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return;
    try {
      soundContext ||= new Audio();
      if (soundContext.state === 'suspended') soundContext.resume().catch(() => {});
      const at = soundContext.currentTime;
      (complete ? [880, 1108.73, 1318.51, 1760] : [880, 1174.66]).forEach((frequency, i) => {
        const oscillator = soundContext.createOscillator(), gain = soundContext.createGain();
        oscillator.type = 'sine'; oscillator.frequency.value = frequency;
        const start = at + i * (complete ? 0.09 : 0.065);
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.055, start + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.12);
        oscillator.connect(gain); gain.connect(soundContext.destination);
        oscillator.start(start); oscillator.stop(start + 0.13);
      });
    } catch (_) { /* Sound failure never blocks a found mark or saving. */ }
  }
  // ごほうびの音（10/29）：キャラがあとの姿に変わる「ぽよん」と、手帳にスタンプが押される「ポン」
  function glideSound(from, to, length, type, volume) {
    if (!soundEnabled) return;
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return;
    try {
      soundContext ||= new Audio();
      if (soundContext.state === 'suspended') soundContext.resume().catch(() => {});
      const at = soundContext.currentTime, oscillator = soundContext.createOscillator(), gain = soundContext.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(from, at);
      oscillator.frequency.exponentialRampToValueAtTime(to, at + length);
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(volume, at + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + length + 0.05);
      oscillator.connect(gain); gain.connect(soundContext.destination);
      oscillator.start(at); oscillator.stop(at + length + 0.06);
    } catch (_) {}
  }
  const poyonSound = () => glideSound(330, 990, 0.16, 'sine', 0.07);
  const tickSound = last => glideSound(last ? 1175 : 880, last ? 1175 : 880, 0.05, 'sine', last ? 0.05 : 0.035);
  // ゆるい制限時間（10/29 BJ さん「2分ぐらいのゆるい感じ」）。切れても終わらない・2分以内のふつうは金のスタンプ・残り30秒で少しあせらせる
  const TIME_LIMIT = 120;
  let playTimer = null, lastClearGold = false;
  // 10/30 はじめての目：答えを見た絵は金なし・出入りしても時間は続きから（「ふつう」を押しなおすと 2:00 にもどり、答えを見ても金が出た）
  const helpUsed = new Set(), timerUsed = {};
  function stopTimer() { if (playTimer) clearInterval(playTimer.id); playTimer = null; }
  function timerLeft() { return playTimer ? Math.max(0, TIME_LIMIT - playTimer.used / 1000) : 0; }
  function startTimer(key) {
    stopTimer();
    const box = document.getElementById('play-timer'); if (!box) return;
    playTimer = {key, used: timerUsed[key] || 0, at: performance.now(), said: new Set(), over: false, id: 0};
    const tick = () => {
      const now = performance.now();
      if (!document.hidden) playTimer.used += now - playTimer.at;   // 見ていない間は進めない
      timerUsed[playTimer.key] = playTimer.used;
      playTimer.at = now;
      const left = timerLeft(), sec = Math.ceil(left);
      box.querySelector('span').textContent = left > 0 ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : 'のんびり';
      box.style.setProperty('--p', (left / TIME_LIMIT).toFixed(4));
      box.classList.toggle('hurry', left > 0 && left <= 30);
      if ([30, 10, 5, 4, 3, 2, 1].includes(sec) && left > 0 && !playTimer.said.has(sec)) { playTimer.said.add(sec); tickSound(sec <= 5); }
      if (left <= 0 && !playTimer.over) {
        playTimer.over = true; box.classList.add('over'); clearInterval(playTimer.id);
        const line = document.getElementById('hint-line');
        if (line) line.textContent = '2分たったよ。でも終わりじゃないよ。のんびり最後まで見つけてね。';
      }
    };
    playTimer.id = setInterval(tick, 200); tick();
  }
  const stampSound = () => { glideSound(190, 60, 0.12, 'triangle', 0.22); setTimeout(() => glideSound(1568, 2093, 0.06, 'sine', 0.035), 90); };
  function applyPictureZoom() {
    const transform = pictureTransform(pictureZoom);
    main.querySelectorAll('.picture-content').forEach(content => { content.style.transform = transform; });
    main.querySelectorAll('.picture-stage').forEach(stage => stage.classList.toggle('zoomed', pictureZoom.scale > 1));
    const reset = document.getElementById('zoom-reset');
    if (reset) reset.disabled = pictureZoom.scale === 1;
  }
  function resetPictureInteraction() {
    if (touchGesture.active) touchBlockedUntilLift = true;
    touchGesture.reset(); touchStage = null; pointerDown = null;
    Object.assign(pictureZoom, {scale: 1, x: 0, y: 0});
    applyPictureZoom();
  }
  function picturesReady() {
    const stages = [...main.querySelectorAll('.picture-stage')];
    return view.screen === 'play' && stages.length === 2 && stages.every(stage => stage.classList.contains('ready'));
  }
  function touchPoints(list) { return Array.from(list, p => ({id: p.identifier, x: p.clientX, y: p.clientY})); }
  function preventOwnedGesture(event) { if (event.cancelable) event.preventDefault(); }
  function touchStart(event) {
    if (touchBlockedUntilLift) return preventOwnedGesture(event);
    const stage = event.target.closest?.('.picture-stage');
    if (!touchGesture.active && (!stage || !picturesReady())) return;
    if (!touchGesture.active) touchStage = stage;
    if (!touchStage?.isConnected || !picturesReady()) return;
    const points = touchPoints(event.touches), rect = touchStage.getBoundingClientRect();
    touchGesture.start(points, rect, pictureZoom);
    if (points.length > 1) {
      // A second finger outside the originating picture cancels the answer
      // candidate, but does not move the pictures from an unrelated control.
      if (points.some(p => p.x < rect.left || p.x > rect.right || p.y < rect.top || p.y > rect.bottom)) touchGesture.cancel(points.length);
      preventOwnedGesture(event);
    }
  }
  let panFrom = null, lastTap = null;
  // 同じ所を2回たたくと、その所を中心に拡大／もう一度で元の大きさ（10/29 間違い探し部門）。
  // 1回目はふつうの1回押しとして扱う（押していない所は反応しない）。
  function isDoubleTap(stage, x, y) {
    const now = performance.now(), prev = lastTap;
    lastTap = {stage, x, y, t: now};
    if (!prev || prev.stage !== stage || now - prev.t > 320 || Math.hypot(x - prev.x, y - prev.y) > 30) return false;
    lastTap = null;
    return true;
  }
  function doubleTapZoom(stage, clientX, clientY) {
    if (pictureZoom.scale > 1) { Object.assign(pictureZoom, {scale: 1, x: 0, y: 0}); return applyPictureZoom(); }
    const rect = stage.getBoundingClientRect();
    const px = (clientX - rect.left) / rect.width, py = (clientY - rect.top) / rect.height, scale = 2.5;
    Object.assign(pictureZoom, limitPictureZoom({scale, x: px - px * scale, y: py - py * scale}));
    applyPictureZoom();
  }
  function touchMove(event) {
    if (touchBlockedUntilLift) return preventOwnedGesture(event);
    if (!touchGesture.active) return;
    if (!touchStage?.isConnected || !picturesReady()) { touchGesture.cancel(event.touches.length); return; }
    // 拡大しているときは、1本指で2枚の絵をいっしょに動かす（10/29 間違い探し部門）。
    if (pictureZoom.scale > 1 && !touchGesture.multi && event.touches.length === 1) {
      preventOwnedGesture(event);
      const t = event.touches[0], rect = touchStage.getBoundingClientRect();
      if (panFrom) {
        Object.assign(pictureZoom, limitPictureZoom({scale: pictureZoom.scale,
          x: pictureZoom.x + (t.clientX - panFrom.x) / rect.width, y: pictureZoom.y + (t.clientY - panFrom.y) / rect.height}));
        applyPictureZoom();
      }
      panFrom = {x: t.clientX, y: t.clientY};
      touchGesture.move(touchPoints(event.touches), rect, pictureZoom);
      return;
    }
    panFrom = null;
    const next = touchGesture.move(touchPoints(event.touches), touchStage.getBoundingClientRect(), pictureZoom);
    if (touchGesture.multi) preventOwnedGesture(event);
    if (next) { Object.assign(pictureZoom, next); applyPictureZoom(); }
    // One-finger drags deliberately retain native vertical page scrolling.
  }
  function touchEnd(event) {
    panFrom = null;
    if (touchBlockedUntilLift) {
      preventOwnedGesture(event);
      if (!event.touches.length) { touchBlockedUntilLift = false; touchGesture.reset(); touchStage = null; }
      return;
    }
    if (!touchGesture.active) return;
    const stage = touchStage;
    const result = touchGesture.finish(touchPoints(event.touches), touchPoints(event.changedTouches),
      stage?.getBoundingClientRect() || {}, pictureZoom);
    if (result.wasMulti) preventOwnedGesture(event);
    if (!touchGesture.active) touchStage = null;
    if (result.tap && stage?.isConnected && picturesReady()) {
      if (isDoubleTap(stage, result.point.x, result.point.y)) return doubleTapZoom(stage, result.point.x, result.point.y);
      tapStage(stage, result.point.x, result.point.y, 'touch');
    }
  }
  function touchCancel(event) {
    if (!touchGesture.active && !touchBlockedUntilLift) return;
    touchGesture.cancel(event.touches.length);
    if (!event.touches.length) { touchBlockedUntilLift = false; touchStage = null; }
  }
  // Only pictures own a custom pinch. Browser zoom outside them and the
  // viewport's normal scaling remain available; no global zoom lock is used.
  document.addEventListener('touchstart', touchStart, {passive: false});
  document.addEventListener('touchmove', touchMove, {passive: false});
  document.addEventListener('touchend', touchEnd, {passive: false});
  document.addEventListener('touchcancel', touchCancel, {passive: false});
  document.addEventListener('gesturestart', event => {
    safariGestureOwned = !!event.target.closest?.('.picture-stage') || touchGesture.active;
    if (safariGestureOwned) preventOwnedGesture(event);
  }, {passive: false});
  document.addEventListener('gesturechange', event => { if (safariGestureOwned) preventOwnedGesture(event); }, {passive: false});
  document.addEventListener('gestureend', event => { if (safariGestureOwned) preventOwnedGesture(event); safariGestureOwned = false; }, {passive: false});

  function safeText(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
  }
  function clamped(n) { return Math.max(0, Math.min(1, Number(n) || 0)); }
  function months() { return Array.isArray(data?.months) ? data.months : []; }
  function gameKey(month, level) { return `${month.id}:${level}`; }
  function spots(month, level) { return Array.isArray(month?.spots?.[level]) ? month.spots[level] : []; }
  function readState() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE) || '{}');
      if (raw && typeof raw === 'object' && raw.version === 1 && raw.found && typeof raw.found === 'object') {
        return {version: 1, found: raw.found, gold: raw.gold && typeof raw.gold === 'object' ? raw.gold : {}, cleared: raw.cleared && typeof raw.cleared === 'object' ? raw.cleared : {}, corn: raw.corn && typeof raw.corn === 'object' ? raw.corn : {}};
      }
    } catch (_) { /* file:// with blocked storage still permits this session. */ }
    return {version: 1, found: {}, gold: {}, cleared: {}, corn: {}};
  }
  let state = readState();
  function saveState() {
    try { localStorage.setItem(STORE, JSON.stringify(state)); }
    catch (_) { announce('この環境では進み具合を端末に保存できません。'); }
  }
  function foundSet(month, level) {
    const list = state.found[gameKey(month, level)];
    const max = spots(month, level).length;
    return new Set(Array.isArray(list) ? list.filter(i => Number.isInteger(i) && i >= 0 && i < max) : []);
  }
  function isComplete(month, level) {
    const n = spots(month, level).length;
    return n > 0 && (Boolean(state.cleared?.[gameKey(month, level)]) || foundSet(month, level).size >= n);   // cleared＝もう一度遊ぶ間もクリアのまま
  }
  function allHardDone() { return months().length === 12 && months().every(m => isComplete(m, 'hard')); }
  // エンディングは、ふつうを12か月でひらく。むずかしいを12か月で、おまけの一場面（10/29 BJ さん）。
  function allNormalDone() { return months().length === 12 && months().every(m => isComplete(m, 'normal')); }
  function overallCount() {
    let count = 0;
    months().forEach(m => LEVELS.forEach(l => { if (isComplete(m, l)) count++; }));
    return count;
  }
  function updateOverall() { overall.textContent = `${overallCount()} / ${months().length * 2} クリア`; }
  function announce(message) {
    // 遊ぶ画面では下の札を出さず、上の案内の1行に出す（札が下の絵にかかるため・10/29）。
    const line = view.screen === 'play' && document.getElementById('hint-line');
    if (line) { toast.classList.remove('show'); line.textContent = message; return; }
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2300);
  }
  function showConfirm(title, message, confirmLabel, onConfirm, danger = false) {
    const previousFocus = document.activeElement;
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `<div class="confirm-card" role="dialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-message">
      <h2 id="confirm-title">${safeText(title)}</h2><p id="confirm-message">${safeText(message)}</p>
      <div class="confirm-actions"><button type="button" data-confirm="cancel">戻る</button><button type="button" class="${danger ? 'danger' : 'primary'}" data-confirm="accept">${safeText(confirmLabel)}</button></div>
    </div>`;
    function close() {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      if (previousFocus?.isConnected) previousFocus.focus();
    }
    function onKey(event) {
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (event.key === 'Tab') {
        const buttons = overlay.querySelectorAll('button');
        if ((event.shiftKey && document.activeElement === buttons[0]) || (!event.shiftKey && document.activeElement === buttons[buttons.length - 1])) {
          event.preventDefault(); (event.shiftKey ? buttons[buttons.length - 1] : buttons[0]).focus();
        }
      }
    }
    overlay.addEventListener('click', event => {
      if (event.target === overlay || event.target.closest('[data-confirm="cancel"]')) return close();
      if (event.target.closest('[data-confirm="accept"]')) { close(); onConfirm(); }
    });
    document.body.appendChild(overlay);
    document.addEventListener('keydown', onKey);
    overlay.querySelector('[data-confirm="cancel"]').focus();
  }
  function titleOf(month) { return `${Number(month.id)}月　${month.title || ''}`; }
  function nextMonth(month) {
    const list = months(), i = list.findIndex(m => m.id === month.id);
    return i >= 0 && i + 1 < list.length ? list[i + 1] : null;
  }
  function monthById(id) { return months().find(m => m.id === id); }
  function setScreen(name, html) {
    stopTimer();
    resetPictureInteraction();
    view.screen = name;
    main.classList.toggle('play-view', name === 'play');
    document.body.classList.toggle('playing', name === 'play');
    main.innerHTML = html;
    updateOverall();
    window.scrollTo(0, 0);
    schedulePictureFit();
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) main.animate?.([{opacity: .65}, {opacity: 1}], {duration: 120, easing: 'ease-out'});
  }

  function cornHomeHTML() {
    const n = cornCount(), all = cornTotal();
    if (!all || !n) return '';
    return `<p class="corn-line">かくれトウモロコシ <b>${n} / ${all}</b>${n >= all ? '　<button data-action="corn-reward">とっておきの1枚を見る</button>' : '　（むずかしいの絵に1本ずつ）'}</p>`;
  }
  function renderHome() {
    const cards = months().map(m => {
      const n = isComplete(m, 'normal'), h = isComplete(m, 'hard');
      const status = `${n ? 'ふつう ✓' : 'ふつう これから'}　・　${h ? 'むずかしい ✓' : 'むずかしい これから'}`;
      return `<article class="month-card">
        <img src="${safeText(m.thumbnail || m.original)}" alt="${safeText(titleOf(m))}の絵" loading="lazy" draggable="false">
        <div class="month-card-body"><h3>${safeText(titleOf(m))}</h3><div class="status">${status}</div>
          <div class="actions"><button class="${n ? 'done' : ''}" data-action="play" data-id="${safeText(m.id)}" data-level="normal">ふつう</button>
          <button class="${h ? 'done' : ''}" data-action="play" data-id="${safeText(m.id)}" data-level="hard">むずかしい</button></div>
        </div></article>`;
    }).join('');
    setScreen('home', `<div class="intro"><div><h2>月をえらんでね</h2><p>2枚の絵を見くらべて、ちがうところを押してみよう。1枚2分がめやす。時間が切れても続けられるよ。2分以内にふつうをクリアすると、金のスタンプ。</p></div></div>
      ${passportHTML()}${cornHomeHTML()}<div class="month-grid">${cards}</div>
      <div class="home-bottom"><button data-action="sound" aria-pressed="${soundEnabled}">${soundEnabled ? '音あり' : '音なし'}</button>${allNormalDone() ? '<button class="primary" data-action="ending">エンディングを見る</button>' : '<span class="explain">手帳のスタンプが12個そろうと、エンディングがひらきます。</span>'}
        <button class="danger" data-action="reset">進み具合をリセット</button></div>${characterGuideHTML()}`);
  }

  // ふしぎな世界めぐり 1年ツアー手帳：ふつうでクリアした月にスタンプ。12個でエンディング（10/29 BJ さん OK）。
  // スタンプの絵は、とどくまで月の絵を丸く切って使う（data の month.stamp があればそちら）。
  // 12個そろった1回だけの大きなお祝い（10/29 総合窓口「1年ツアーを回りきった気持ちよさが、いちばん大きいごほうび」）。
  // 表紙が開く → 12のスタンプが順に光る（音も1つずつ上がる）→「1年ツアー 完走！」の帯とドラとタマ・紙ふぶき
  const TOUR_DONE = 'kagishippo-tour-done-633';
  function tourCelebrated() { try { return localStorage.getItem(TOUR_DONE) === '1'; } catch (_) { return true; } }
  function markTourCelebrated() { try { localStorage.setItem(TOUR_DONE, '1'); } catch (_) {} }
  function tourFanfare() {
    [523.25, 587.33, 659.25, 698.46, 783.99, 880, 987.77, 1046.5, 1174.66, 1318.51, 1396.91, 1567.98]
      .forEach((f, i) => setTimeout(() => glideSound(f, f * 1.01, 0.11, 'sine', 0.05), 1300 + i * 100));
    [1046.5, 1318.51, 1567.98, 2093].forEach((f, i) => setTimeout(() => glideSound(f, f, 0.5, 'triangle', 0.06), 2550 + i * 70));
  }
  function grandHTML() {
    const pop = [data.clearDora, data.clearTama].filter(Boolean).map((src, i) => `<img class="tour-pop tour-pop-${i}" src="${safeText(src)}" alt="${i === 0 ? 'ドラ' : 'タマ'}">`);
    const colors = ['#e94954', '#ffc93c', '#5bb1d9', '#79c17a', '#f29ca3', '#b07ad9'];
    const bits = Array.from({length: 36}, (_, k) => `<i style="left:${(k * 37) % 100}%;background:${colors[k % 6]};--d:${(k % 9) * 70}ms;--r:${(k * 53) % 360}deg;--x:${(k % 5 - 2) * 14}px"></i>`).join('');
    return `<div class="passport-cover" aria-hidden="true"><b>1年ツアー手帳</b><small>ふしぎな世界めぐり</small></div>
      <div class="tour-banner">${pop[0] || ''}<strong>1年ツアー 完走！</strong>${pop[1] || ''}</div><div class="tour-confetti" aria-hidden="true">${bits}</div>`;
  }
  function passportHTML(freshId = null, grand = false) {
    const n = months().filter(m => isComplete(m, 'normal')).length;
    const slots = months().map((m, index) => {
      const label = `${Number(m.id)}月`;
      if (!isComplete(m, 'normal')) return `<div class="passport-slot"><div class="stamp empty"><span>${label}</span></div><small>？</small></div>`;
      const tilt = (Number(m.id) * 37) % 25 - 12;
      // 専用のスタンプ絵（仕事646）は自分の輪があるので、枠と月の字をのせない。月は下の題名の前に出す
      if (m.stamp) return `<div class="passport-slot" style="--i:${index}"><div class="stamp art${m.id === freshId ? ' fresh' : ''}${state.gold?.[`${m.id}:normal`] ? ' gold' : ''}" style="--tilt:${tilt}deg"><img src="${safeText(m.stamp)}" alt="${label}のスタンプ" draggable="false"></div><small>${label}　${safeText(m.title || '')}</small></div>`;
      return `<div class="passport-slot"><div class="stamp${m.id === freshId ? ' fresh' : ''}" style="--tilt:${tilt}deg"><img src="${safeText(m.thumbnail || m.original)}" alt="" draggable="false"><span>${label}</span></div><small>${safeText(m.title || '')}</small></div>`;
    }).join('');
    const note = n === 12 ? '12個そろった！　エンディング「ドラジーの日」がひらいたよ。' : `ふつうでクリアするとスタンプ。12個そろうとエンディング「ドラジーの日」がひらきます。`;
    return `<section class="passport${grand ? ' grand' : ''}"><h2>ふしぎな世界めぐり　1年ツアー手帳 <b>${n} / 12</b></h2><p>${note}</p><div class="passport-grid">${slots}</div>${grand ? grandHTML() : ''}</section>`;
  }
  function selectedMonth() { return monthById(view.month); }
  function spotCenter(s) {
    if (Number.isFinite(Number(s.x)) && Number.isFinite(Number(s.y))) return {x: clamped(s.x), y: clamped(s.y)};
    const polygons = polygonsOf(s), p = polygons[0];
    if (!p?.length) return {x: .5, y: .5};
    return {x: clamped(p.reduce((a, v) => a + Number(v[0]), 0) / p.length),
            y: clamped(p.reduce((a, v) => a + Number(v[1]), 0) / p.length)};
  }
  let justFound = null, justCorn = false; // いま見つけた違いだけ、丸をはねさせる（10/29 間違い探し部門）
  function markerAt(s, cls = '') {
    // The editorial answer circle is independent of the irregular changed
    // pixels. Use it for visible marks, but never for hit detection.
    const circle = Array.isArray(s.circle) && s.circle.length === 4 ? s.circle : null;
    const c = circle ? {x: clamped(circle[0]), y: clamped(circle[1])} : spotCenter(s);
    const size = circle ? `width:max(36px,${clamped(circle[2])*200}%);height:max(36px,${clamped(circle[3])*200}%);` : '';
    return `<span class="marker ${cls}" style="left:${c.x*100}%;top:${c.y*100}%;${size}"></span>`;
  }
  function markerHTML(month, level, side) {
    const items = spots(month, level), found = foundSet(month, level);
    let result = items.map((s, i) => found.has(i) ? markerAt(s, i === justFound ? 'new' : '') : '').join('');
    if (view.revealed) result += items.map((s, i) => !found.has(i) ? markerAt(s, 'answer') : '').join('');
    const c = level === 'hard' ? cornOf(month) : null;
    if (c && state.corn?.[month.id]) result += `<span class="marker corn${justCorn ? ' new' : ''}" style="left:${c.x*100}%;top:${c.y*100}%"></span>`;
    if (view.hint >= 2 && view.hintIndex != null && !found.has(view.hintIndex) && !view.revealed && side === 'changed') {
      result += markerAt(items[view.hintIndex], 'hint');
    }
    return result;
  }
  function pictureSrc(month, level, side) {
    if (!month) return null;
    const c = level === 'hard' ? cornOf(month) : null;
    if (side === 'original') return c?.original || month.original;
    return c?.hard || month[level];
  }
  function cornCount() { return months().filter(m => cornOf(m) && state.corn?.[m.id]).length; }
  function cornTotal() { return months().filter(m => cornOf(m)).length; }
  function picturePanel(month, level, side) {
    const original = side === 'original';
    const src = pictureSrc(month, level, side);
    const heading = `<h3>${original ? 'もとの絵' : 'ちがうところを探す絵'}</h3>`;
    return `<section class="picture-panel">${heading}
      <div class="picture-stage loading" data-side="${side}" data-panel="${original ? 'reference' : 'comparison'}" aria-label="${original ? 'もとの絵' : 'ちがいのある絵'}。指やマウスで場所を押せます。">
        <div class="picture-content"><img src="${safeText(src)}" width="${Number(month.width) || 1440}" height="${Number(month.height) || 1080}" alt="${safeText(titleOf(month))}・${original ? 'もとの絵' : levelName[level]}" draggable="false">
        <div class="marker-layer" data-markers="${side}">${markerHTML(month, level, side)}</div></div>
        <div class="picture-loading" role="status">絵を読み込んでいます…</div>
        <div class="picture-error" role="alert">絵を読み込めませんでした。<button data-action="reload">再読み込み</button></div>
      </div></section>`;
  }
  function preparePictureLoads(stages = main.querySelectorAll('.picture-stage')) {
    stages.forEach(stage => {
      const img = stage.querySelector('img');
      const ready = () => { stage.classList.remove('loading', 'failed'); stage.classList.add('ready'); };
      const failed = () => { stage.classList.remove('loading', 'ready'); stage.classList.add('failed'); resetPictureInteraction(); };
      img.onload = ready;
      img.onerror = failed;
      if (img.complete) (img.naturalWidth > 0 ? ready : failed)();
    });
  }
  function renderPlay(month, level) {
    if (!month || !LEVELS.includes(level)) return renderHome();
    view.month = month.id; view.level = level; view.hint = 0; view.revealed = false; view.hintIndex = null;
    const count = foundSet(month, level).size, total = spots(month, level).length;
    setScreen('play', `<div class="play-top">
        <div class="play-heading"><h2>${safeText(titleOf(month))}</h2><div class="sub">${levelName[level]}｜どちらの絵も押せます</div></div>
        <button class="zoom-reset" id="zoom-reset" data-action="reset-zoom" aria-label="2枚の絵を元の大きさに戻す" disabled>元の大きさ</button>
        <div class="count" id="found-count" aria-live="polite">${count} / ${total} 発見</div>
        ${total && count < total ? '<div class="play-timer" id="play-timer" aria-label="のこり時間（切れても続けられます）" style="--p:1"><i></i><span>2:00</span></div>' : ''}
      </div>
      <div class="play-dock">
        <div class="play-toolbar" aria-label="ゲームの操作">
          <button data-action="home" aria-label="月選びへ戻る">終了</button>
          <button data-action="switch" data-level="normal" class="${level === 'normal' ? 'active' : ''}">ふつう</button>
          <button data-action="switch" data-level="hard" class="${level === 'hard' ? 'active' : ''}">むずかしい</button>
          <button data-action="hint">ヒント</button>
          <button data-action="answer">答えを見る</button>
          <button data-action="skip" aria-label="次へ進む。発見記録は増えません">次へ</button>
        </div>
        <div class="hint-line" id="hint-line" role="status" aria-live="polite">${!total ? 'この月の違いは準備中です。' : level === 'hard' && cornOf(month) && !state.corn?.[month.id] ? '違うところを押してね。トウモロコシも1本かくれているよ。' : '違うところを押してね。2回たたくか、2本指で広げると拡大します。'}</div>
      </div>
      <div class="picture-grid">${picturePanel(month, level, 'original')}${picturePanel(month, level, 'changed')}</div>
      <p class="play-note">間違えて押しても減点はありません。ヒントや答えでは発見数は増えません。拡大中は1本指で絵を動かせます。</p>${characterGuideHTML()}`);
    preparePictureLoads();
    schedulePictureFit();
    preloadNext(month, level);
    lastClearGold = false;
    if (total && count < total) startTimer(gameKey(month, level));
    if (total && count === total) setTimeout(() => { if (view.screen === 'play' && view.month === month.id && view.level === level) renderClear(month, level); }, 200);
  }
  const preloaded = new Set();
  function preloadNext(month, level) {
    // 絵がそろってから、次に押しそうな絵を先に読みこむ（待ち時間をへらす・10/29 間違い探し部門）。
    const next = nextMonth(month), other = level === 'normal' ? 'hard' : 'normal';
    const cel = (month.celebrate || []).flatMap(c => [c.bg, c.src, c.src2]);
    const list = [...cel, month.stamp, pictureSrc(month, other, 'original'), pictureSrc(month, other, 'changed'), pictureSrc(next, level, 'original'), pictureSrc(next, level, 'changed')].filter(src => src && !preloaded.has(src));
    setTimeout(() => list.forEach(src => { preloaded.add(src); const img = new Image(); img.decoding = 'async'; img.src = src; }), 1200);
  }
  function regionName(c) {
    const y = c.y < 1/3 ? '上' : c.y < 2/3 ? 'まんなか' : '下';
    const x = c.x < 1/3 ? '左' : c.x < 2/3 ? 'まんなか' : '右';
    return y === 'まんなか' && x === 'まんなか' ? '絵のまんなか' : `絵の${y}${x}あたり`;
  }
  function showHint() {
    const month = selectedMonth(), level = view.level;
    if (!month || view.revealed) return announce('答えを表示中です。次の絵へ進めます。');
    const found = foundSet(month, level);
    const index = spots(month, level).findIndex((_, i) => !found.has(i));
    if (index < 0) return announce('この絵の違いは全部見つかっています。');
    view.hintIndex = index;
    if (view.hint < 2) view.hint++;
    const hint = document.getElementById('hint-line');
    hint.textContent = view.hint === 1 ? `${regionName(spotCenter(spots(month, level)[index]))}を探してみてね。` : '青い輪の近くを見てみてね。輪を見ても発見数は増えません。';
    refreshMarkers();
  }
  function refreshMarkers() {
    const m = selectedMonth(); if (!m || view.screen !== 'play') return;
    main.querySelectorAll('[data-markers]').forEach(layer => { layer.innerHTML = markerHTML(m, view.level, layer.dataset.markers); });
  }
  function revealAnswers() {
    if (view.revealed) return;
    showConfirm('答えを表示しますか？', '表示だけでは発見数やクリア記録は増えません。', '答えを表示する', () => {
      view.revealed = true; helpUsed.add(gameKey(selectedMonth(), view.level));
      document.getElementById('hint-line').textContent = '答えを表示中です。輪を押すとクリアできます（金のスタンプはつきません）。';
      refreshMarkers();
    });
  }
  function renderClear(month, level) {
    const next = nextMonth(month), endingOpen = allNormalDone();
    const grand = level === 'normal' && endingOpen && !tourCelebrated();
    if (grand) markTourCelebrated();
    const art = [data.clearDora, data.clearTama].filter(Boolean).map((src, i) => `<img src="${safeText(src)}" alt="${i === 0 ? 'ドラ' : 'タマ'}のクリア絵">`).join('');
    const actions = [];
    if (level === 'normal') actions.push(`<button class="primary" data-action="play" data-id="${safeText(month.id)}" data-level="hard">この月のむずかしいへ</button>`);
    if (next) actions.push(`<button data-action="play" data-id="${safeText(next.id)}" data-level="${level}">次の月へ</button>`);
    if (endingOpen) actions[grand ? 'unshift' : 'push'](`<button class="primary${grand ? ' tour-go' : ''}" data-action="ending">エンディング「ドラジーの日」へ</button>`);
    actions.push(`<button data-action="replay" data-id="${safeText(month.id)}" data-level="${level}">もう一度遊ぶ</button>`);
    actions.push('<button data-action="home">月選びへ</button>');
    setScreen('clear', `<section class="clear-screen"><p>カギしっぽバスケ部</p><h2>${safeText(titleOf(month))}　クリア！</h2>
      <p>${levelName[level]}の違いを全部見つけたよ。</p>
      ${lastClearGold ? `<p class="gold-line">2分以内！${level === 'normal' ? '　金のスタンプ' : '　すばやい！'}</p>` : ''}
      ${level === 'normal' ? passportHTML(month.id, grand) : ''}
      ${level === 'hard' && cornOf(month) ? `<p class="corn-line">${state.corn?.[month.id] ? 'この月のトウモロコシも見つけた！' : 'この絵には、トウモロコシも1本かくれているよ。'}　${cornCount()} / ${cornTotal()}</p>` : ''}
      ${art ? `<div class="clear-art">${art}</div>` : ''}
      <div class="next-actions">${actions.join('')}</div></section>`);
    if (level === 'normal') setTimeout(stampSound, grand ? 1180 : 680);
    if (grand) tourFanfare();
  }
  // カレンダーを買う場所（10/31 総合窓口：URL は動画に書かず、動画の下にボタン1つ）。BOOTH のページができたら BOOTH_URL に入れる
  const BOOTH_URL = '';
  function buyHTML() {
    return BOOTH_URL
      ? `<p class="buy-line"><a class="buy-link" href="${safeText(BOOTH_URL)}" target="_blank" rel="noopener">カレンダーを BOOTH で見る</a></p>`
      : '<p class="buy-line"><span class="buy-link soon">カレンダーは BOOTH で（準備中）</span></p>';
  }
  function renderEnding() {
    if (!allNormalDone()) { announce('ふつうを12か月クリアするとひらきます。'); return renderHome(); }
    // The date belongs to this ending viewing session. A later visit starts
    // a fresh session so newly debuted guests can appear on their own date.
    if (!view.endingAt || !['ending', 'stations', 'bonus'].includes(view.screen)) view.endingAt = new Date().toISOString();
    // スマホ・細い画面は軽い版（1280×720・約9MB）。iPad 以上は 1920×1080（10/29 改9）
    const small = Math.min(screen.width, screen.height) < 600 || navigator.connection?.saveData;
    const src = (small && data.ending?.videoLight) || data.ending?.video;
    setScreen('ending', `<section class="ending-screen"><h2>12か月クリア！</h2><p>カギしっぽバスケ部のエンディング</p>
      ${src ? `<video id="ending-video" src="${safeText(src)}" controls playsinline preload="metadata"></video>` : '<p class="missing">動画は準備中です。駅の絵へ進めます。</p>'}
      <p id="video-error" class="video-error" role="alert" aria-live="polite"></p>
      ${buyHTML()}
      <div class="next-actions">${src ? '<button class="primary" data-action="play-video">動画を再生</button>' : ''}<button data-action="stations">日付別の駅へ</button><button data-action="home">月選びへ</button></div></section>`);
    const video = document.getElementById('ending-video');
    if (video) {
      video.addEventListener('ended', renderStations, {once: true});
      video.addEventListener('error', () => {
        document.getElementById('video-error').textContent = '動画を読み込めませんでした。駅の絵へ進むか、ページを再読み込みしてください。';
      });
      // This runs from the ending button's user gesture when possible. Native
      // controls and the separate replay button remain available if blocked.
      const attempt = video.play();
      if (attempt?.catch) attempt.catch(() => {});
    }
  }
  function validDate(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : null;
  }
  function canShowByDate(item, cutoff) {
    if (item?.confirmed !== true) return false;
    if (item.alwaysVisible === true) return true;
    const when = validDate(item.date);
    return cutoff !== null && when !== null && when <= cutoff;
  }
  function visibleGuests(ending, playedAt) {
    const cutoff = validDate(playedAt);
    return (Array.isArray(ending?.guests) ? ending.guests : []).filter(g => g?.src && canShowByDate(g, cutoff));
  }
  function visibleCharacters() {
    const now = Date.now();
    return (Array.isArray(data?.characters) ? data.characters : []).filter(c => c?.thumb && canShowByDate(c, now));
  }
  function characterGuideHTML() {
    const characters = visibleCharacters();
    if (!characters.length) return '';
    return `<section class="character-guide" aria-label="猫の名前">
      <h2>猫の名前</h2><p>顔を押すと名前が見られるよ。</p>
      <div class="character-list">${characters.map(c => `<button data-action="cat-name" data-id="${safeText(c.id)}" aria-label="猫の名前を見る">
        <img src="${safeText(c.thumb)}" alt="" loading="lazy" draggable="false"><span>名前を見る</span></button>`).join('')}</div>
      <p class="character-result" id="character-result" role="status" aria-live="polite">猫の顔を選んでね。</p>
    </section>`;
  }
  function showCharacterName(id) {
    const person = visibleCharacters().find(c => String(c.id) === id);
    const result = document.getElementById('character-result');
    if (person && result) result.textContent = `${person.name}だよ。`;
  }
  function stationArtwork(ending, guests) {
    const image = (src, alt) => src ? `<img src="${safeText(src)}" alt="${safeText(alt)}" draggable="false">` : '';
    const layers = {background: image(ending.background, '駅の背景'),
                    guests: guests.map(g => image(g.src, g.name || '登場する猫')).join(''),
                    foreground: image(ending.foreground, '駅の手前の景色')};
    const order = Array.isArray(ending.layerOrder) && ending.layerOrder.length ? ending.layerOrder : ['background','guests','foreground'];
    return `<div class="station-art" aria-label="日付別の駅の絵">${order.map(key => layers[key] || '').join('')}</div>`;
  }
  function renderStations() {
    if (!allNormalDone()) return renderHome();
    const ending = data.ending || {};
    const playedAt = view.endingAt || new Date().toISOString();
    const shown = visibleGuests(ending, playedAt);
    const date = new Intl.DateTimeFormat('ja-JP', {timeZone: ending.timezone || 'Asia/Tokyo', year:'numeric', month:'long', day:'numeric'}).format(new Date(playedAt));
    const art = ending.background || ending.foreground ? stationArtwork(ending, shown) : '<p class="missing">駅の絵は準備中です。</p>';
    setScreen('stations', `<section class="station-screen"><h2>${safeText(ending.stationName || '流れ星駅')}</h2>
      <p>${safeText(date)}に遊んだときの駅です。</p>${art}
      ${bonusLine()}<div class="next-actions">${allHardDone() && bonusSrc() ? '<button class="primary" data-action="bonus">おまけの一場面</button>' : ''}<button data-action="ending">動画をもう一度</button><button data-action="home">月選びへ</button></div></section>`);
  }
  function bonusSrc() { return data.ending?.bonus || 'assets/ending/bonus_akegata.png'; }
  function bonusLine() {
    if (!bonusSrc()) return '';
    return allHardDone() ? '<p class="bonus-note">むずかしいも12か月クリア。おまけの一場面がひらきました。</p>' : '<p class="bonus-note">むずかしいも12か月クリアすると、おまけの一場面がひらきます。</p>';
  }
  function renderBonus() {
    if (!allHardDone() || !bonusSrc()) return renderStations();
    setScreen('bonus', `<section class="station-screen bonus-screen"><h2>おまけ　その明け方</h2>
      <img class="bonus-art" src="${safeText(bonusSrc())}" alt="明け方、子猫をだいたまま座りこむドラ">
      <div class="next-actions"><button data-action="stations">駅へもどる</button><button data-action="home">月選びへ</button></div></section>`);
  }

  function polygonsOf(spot) {
    const raw = spot?.polygons || (spot?.polygon ? [spot.polygon] : []);
    return Array.isArray(raw) ? raw.filter(p => Array.isArray(p) && p.length >= 3 && p.every(v => Array.isArray(v) && v.length >= 2)) : [];
  }
  function insidePolygon(x, y, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = Number(polygon[i][0]), yi = Number(polygon[i][1]);
      const xj = Number(polygon[j][0]), yj = Number(polygon[j][1]);
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function edgeDistance(px, py, polygon, width, height) {
    let best = Infinity;
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length];
      const ax = Number(a[0])*width, ay = Number(a[1])*height;
      const bx = Number(b[0])*width, by = Number(b[1])*height;
      const vx = bx-ax, vy = by-ay, d = vx*vx+vy*vy;
      const t = d ? Math.max(0, Math.min(1, ((px-ax)*vx+(py-ay)*vy)/d)) : 0;
      best = Math.min(best, Math.hypot(px-(ax+t*vx), py-(ay+t*vy)));
    }
    return best;
  }
  function hitScore(spot, x, y, width, height, sourceWidth, sourceHeight, pointerType) {
    // Actual difference cells come first. In particular, never use a broad
    // bounding ellipse for a long, sparse change such as footprints.
    if (Array.isArray(spot.cells) && spot.cells.length && Number.isFinite(sourceWidth) && Number.isFinite(sourceHeight)) {
      const grid = Number(spot.grid) > 0 ? Number(spot.grid) : 8;
      const pad = pointerType === 'mouse' ? 11 : 22; // screen pixels, not source pixels
      const px = x * width, py = y * height;
      let nearest = Infinity;
      for (const cell of spot.cells) {
        if (!Array.isArray(cell) || cell.length < 2) continue;
        const cx = Number(cell[0]), cy = Number(cell[1]);
        if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
        const left = cx * grid / sourceWidth * width;
        const top = cy * grid / sourceHeight * height;
        const right = (cx + 1) * grid / sourceWidth * width;
        const bottom = (cy + 1) * grid / sourceHeight * height;
        const distance = Math.hypot(Math.max(left - px, 0, px - right), Math.max(top - py, 0, py - bottom));
        if (distance < nearest) nearest = distance;
        if (nearest === 0) break;
      }
      return nearest <= pad ? nearest / pad : Infinity;
    }
    const polys = polygonsOf(spot);
    if (polys.length) {
      if (polys.some(p => insidePolygon(x, y, p))) return 0;
      const dist = Math.min(...polys.map(p => edgeDistance(x*width, y*height, p, width, height)));
      const pad = pointerType === 'mouse' ? 11 : 22;
      return dist <= pad ? dist / pad : Infinity;
    }
    const pad = pointerType === 'mouse' ? 11 : 22;
    const c = spotCenter(spot), rx = Math.max(pad, clamped(spot.rx || .02)*width), ry = Math.max(pad, clamped(spot.ry || .02)*height);
    const value = Math.hypot((x-c.x)*width/rx, (y-c.y)*height/ry);
    return value <= 1 ? value : Infinity;
  }
  function pickSpot(month, level, x, y, width, height, pointerType) {
    const found = foundSet(month, level), candidates = [];
    spots(month, level).forEach((s, i) => {
      const score = hitScore(s, x, y, width, height, month.width, month.height, pointerType);
      if (Number.isFinite(score)) candidates.push({i, score});
    });
    // Include completed spots before choosing. Otherwise a second tap on A
    // could be miscredited to B's nearby 22px finger allowance.
    if (candidates.some(c => c.score === 0 && found.has(c.i))) return {kind: 'duplicate'};
    candidates.sort((a, b) => a.score-b.score);
    if (!candidates.length) return {kind: 'none'};
    // 近くに2つ重なるときは、まだ見つけていない方をあげる（10/29 間違い探し部門）。
    const open = candidates.find(c => !found.has(c.i));
    if (open && (!found.has(candidates[0].i) || open.score - candidates[0].score < .08)) return {kind: 'new', i: open.i};
    return {kind: 'duplicate'};
  }
  function cornTap(month, level, x, y, width, pointerType) {
    const c = level === 'hard' ? cornOf(month) : null;
    if (!c) return false;
    const pad = pointerType === 'mouse' ? 11 : 22;
    if (Math.hypot(x - c.x, (y - c.y) * (month.height || 1080) / (month.width || 1440)) * width > c.r * width + pad) return false;
    if (state.corn?.[month.id]) { announce('そのトウモロコシは、もう見つけたよ。'); return true; }
    state.corn ||= {}; state.corn[month.id] = true; saveState();
    justCorn = true; refreshMarkers(); justCorn = false;
    const n = cornCount(), all = cornTotal();
    document.getElementById('hint-line').textContent = n >= all ? `かくれトウモロコシ ${n} / ${all}　全部見つけた！` : `かくれトウモロコシを見つけた！　${n} / ${all}`;
    glideSound(660, 1320, 0.12, 'sine', 0.06); setTimeout(() => glideSound(990, 1980, 0.1, 'sine', 0.05), 110);
    if (n >= all) setTimeout(showCornReward, 900);
    return true;
  }
  // 12本そろったら、ドラのとっておきの1枚（LINE 第1弾 20「ごはん中」を大きく・10/29 総合窓口）
  function showCornReward() {
    if (!CORN.reward) return;
    const box = document.createElement('div');
    box.className = 'corn-reward'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'かくれトウモロコシ 12本のごほうび');
    box.innerHTML = `<div class="corn-reward-card"><p>かくれトウモロコシ 12本 そろった！</p><h2>ドラの とっておきの1枚</h2>
      <img src="${safeText(CORN.reward)}" alt="トウモロコシにかぶりつくドラ"><button class="primary" data-corn-close>とじる</button></div>`;
    box.addEventListener('click', e => { if (e.target === box || e.target.closest('[data-corn-close]')) box.remove(); });
    document.body.appendChild(box);
    tourFanfare();
  }
  function wrongTap(stage, x, y) {
    const ring = document.createElement('span');
    ring.className = 'wrong-tap'; ring.style.left = `${x*100}%`; ring.style.top = `${y*100}%`;
    stage.querySelector('.picture-content').appendChild(ring); setTimeout(() => ring.remove(), 550);
    document.getElementById('hint-line').textContent = 'そこは違いではないみたい。ゆっくり探してね。';
  }
  // 1問クリアのごほうび：その月の絵のキャラが2〜3秒だけ動く（10/29 BJ さん OK）。
  // month.celebrate = [{src, src2?, box: [左, 上, 幅, 高さ]（絵の中の割合）, motion: 'yawn'|'proud'|'hop'}]
  // src は絵のキャラを切りぬいた透明 PNG、src2 は動いたあとの顔（あくびなど）。ないときは丸を見せるだけ。
  function celebrate(month) {
    const list = Array.isArray(month.celebrate) ? month.celebrate.filter(c => c?.src && Array.isArray(c.box)) : [];
    if (!list.length || matchMedia('(prefers-reduced-motion: reduce)').matches) return 1100;
    const ratio = (month.width || 4) / (month.height || 3);
    main.querySelectorAll('.picture-content').forEach(content => list.forEach(c => {
      const [x, y, w, h] = c.box.map(clamped);
      const box = `left:${x*100}%;top:${y*100}%;width:${w*100}%;height:${h*100}%;`;
      // キャラのまわりをふわっと光らせ、星を飛ばす（スマホで小さいキャラにも気づくように・10/29 総合窓口）。
      // 光の輪は絵の幅の24%より小さくしない
      const size = Math.max(w * 2.4, h * 2.4 / ratio, .24);
      const glow = document.createElement('div');
      glow.className = 'celebrate-glow';
      glow.style.cssText = `left:${(x + w/2)*100}%;top:${(y + h/2)*100}%;width:${size*100}%;`;
      content.appendChild(glow);
      // まわりを少し暗くして、キャラにスポットライト（明るい絵でも光に気づくように）
      const spot = document.createElement('div');
      spot.className = 'celebrate-spot';
      spot.style.background = `radial-gradient(circle at ${(x + w/2)*100}% ${(y + h/2)*100}%, rgba(20,16,30,0) ${size*38}cqw, rgba(20,16,30,.42) ${size*62}cqw)`;
      content.appendChild(spot);
      for (let k = 0; k < 7; k++) {
        const spark = document.createElement('span'), angle = k / 7 * Math.PI * 2 - Math.PI / 2;
        spark.className = 'celebrate-spark'; spark.textContent = k % 2 ? '✦' : '★';
        spark.style.cssText = `left:${(x + w/2)*100}%;top:${(y + h*.35)*100}%;--dx:${Math.cos(angle)*size*72}cqw;--dy:${Math.sin(angle)*size*72*ratio}cqw;animation-delay:${80 + k*25}ms;`;
        content.appendChild(spark);
      }
      // キャラなし背景を下にしく（動いてできたすきまに、元のキャラが見えないように）
      if (c.bg) {
        const under = document.createElement('img');
        under.className = 'celebrate-bg'; under.alt = ''; under.src = c.bg; under.style.cssText = box;
        content.appendChild(under);
      }
      const img = document.createElement('img');
      img.className = `celebrate motion-${safeText(c.motion || 'hop')}`; img.alt = ''; img.src = c.src;
      img.style.cssText = box;
      if (c.src2) setTimeout(() => { img.src = c.src2; }, 700);
      content.appendChild(img);
    }));
    // 見つけた丸がキャラにかかる月（2月など）があるので、動く間だけ丸をうすくする
    main.querySelectorAll('.picture-stage').forEach(stage => stage.classList.add('celebrating'));
    setTimeout(poyonSound, 700);
    return 2800;
  }
  function tapStage(stage, clientX, clientY, pointerType) {
    if (view.screen !== 'play' || !stage.classList.contains('ready')) return;
    const month = selectedMonth(), level = view.level;
    if (!month) return;
    const rect = stage.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const point = sourcePicturePoint({x: (clientX-rect.left)/rect.width, y: (clientY-rect.top)/rect.height}, pictureZoom);
    if (!point) return;
    const {x, y} = point;
    const choice = pickSpot(month, level, x, y, rect.width*pictureZoom.scale, rect.height*pictureZoom.scale, pointerType);
    if (choice.kind === 'duplicate') return announce('そこはもう見つけたよ。');
    if (choice.kind === 'ambiguous') return announce('近くに違いが重なっています。少し場所を変えて押してね。');
    if (choice.kind === 'none') return cornTap(month, level, x, y, rect.width*pictureZoom.scale, pointerType) || wrongTap(stage, x, y);
    const i = choice.i;
    const found = foundSet(month, level); found.add(i);
    state.found[gameKey(month, level)] = [...found].sort((a,b) => a-b);
    saveState();
    view.hint = 0; view.hintIndex = null;
    justFound = i; refreshMarkers(); justFound = null;
    const counter = document.getElementById('found-count');
    counter.textContent = `${found.size} / ${spots(month, level).length} 発見`;
    counter.classList.remove('bump'); void counter.offsetWidth; counter.classList.add('bump');
    document.getElementById('hint-line').textContent = found.size === spots(month, level).length ? '全部見つけた！' : '見つけた！　次の違いを探そう。';
    const complete = found.size >= spots(month, level).length;
    if (complete) { state.cleared ||= {}; state.cleared[gameKey(month, level)] = true; saveState(); }
    updateOverall(); foundSound(complete);
    if (complete) {
      lastClearGold = Boolean(playTimer && !playTimer.over && !helpUsed.has(gameKey(month, level)) && timerLeft() > 0);
      stopTimer();
      if (lastClearGold && level === 'normal') { state.gold ||= {}; state.gold[gameKey(month, level)] = true; saveState(); }
    }
    const wait = complete ? celebrate(month) : 0;
    if (complete) setTimeout(() => {
      if (view.screen === 'play' && view.month === month.id && view.level === level) renderClear(month, level);
    }, wait);
  }

  main.addEventListener('pointerdown', event => {
    if (event.pointerType === 'touch') return;
    const stage = event.target.closest('.picture-stage');
    pointerDown = stage?.classList.contains('ready') ? {stage, x: event.clientX, y: event.clientY, id: event.pointerId} : null;
  });
  main.addEventListener('pointerup', event => {
    if (event.pointerType === 'touch' || !pointerDown || pointerDown.id !== event.pointerId) return;
    const down = pointerDown; pointerDown = null;
    if (down.stage !== event.target.closest('.picture-stage')) return;
    if (Math.hypot(event.clientX-down.x, event.clientY-down.y) > 14) return;
    if (isDoubleTap(down.stage, event.clientX, event.clientY)) return doubleTapZoom(down.stage, event.clientX, event.clientY);
    tapStage(down.stage, event.clientX, event.clientY, event.pointerType);
  });
  main.addEventListener('pointercancel', event => {
    pointerDown = null;
    if (event.pointerType === 'touch' && touchGesture.active) touchGesture.cancel(1);
  });
  main.addEventListener('lostpointercapture', () => { pointerDown = null; });
  main.addEventListener('click', event => {
    const button = event.target.closest('button[data-action]'); if (!button) return;
    const action = button.dataset.action;
    if (action === 'sound') {
      soundEnabled = !soundEnabled;
      try { localStorage.setItem('kagishippo-sound', soundEnabled ? 'on' : 'off'); } catch (_) {}
      button.textContent = soundEnabled ? '音あり' : '音なし';
      button.setAttribute('aria-pressed', String(soundEnabled));
      if (soundEnabled) foundSound();
      return;
    }
    if (action === 'reset-zoom') return resetPictureInteraction();
    if (action === 'home') return renderHome();
    if (action === 'reload') return window.location.reload();
    if (action === 'cat-name') return showCharacterName(button.dataset.id);
    if (action === 'play') return renderPlay(monthById(button.dataset.id), button.dataset.level);
    if (action === 'switch') return renderPlay(selectedMonth(), button.dataset.level);
    if (action === 'hint') return showHint();
    if (action === 'answer') return revealAnswers();
    if (action === 'replay') {   // クリアした絵を もう一度（スタンプ・金はそのまま。見つけた数だけ 0 に）
      const m = months().find(x => x.id === button.dataset.id), lv = button.dataset.level;
      if (!m || !LEVELS.includes(lv)) return;
      delete state.found[gameKey(m, lv)]; delete timerUsed[gameKey(m, lv)]; helpUsed.delete(gameKey(m, lv)); saveState();
      return renderPlay(m, lv);
    }
    if (action === 'skip') {
      const next = nextMonth(selectedMonth());
      if (next) renderPlay(next, view.level); else renderHome();
      return announce('次へ進みました。発見数は増えていません。');
    }
    if (action === 'reset') {
      return showConfirm('進み具合をリセットしますか？', 'この端末の発見数とクリア記録をすべて消します。', 'リセットする', () => {
        state = {version: 1, found: {}, gold: {}, cleared: {}, corn: {}}; view.endingAt = null; saveState(); renderHome(); announce('進み具合をリセットしました。');
      }, true);
    }
    if (action === 'ending') return renderEnding();
    if (action === 'corn-reward') return showCornReward();
    if (action === 'play-video') {
      const video = document.getElementById('ending-video');
      if (!video) return;
      const attempt = video.play();
      if (attempt?.catch) attempt.catch(() => announce('再生できませんでした。動画の操作ボタンか駅へ進むボタンを使ってね。'));
      return;
    }
    if (action === 'stations') return renderStations();
    if (action === 'bonus') return renderBonus();
  });

  if (!data || months().length !== 12) {
    main.innerHTML = '<div class="missing"><h2>絵の準備中です</h2><p>12か月分のデータがそろうと遊べます。</p></div>';
    overall.textContent = '準備中';
  } else renderHome();
})();
