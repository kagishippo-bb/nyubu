/* 公開版だけに足すもの（10/29 間違い探し部門）。マムさんの app.js はさわらない。
   ①クリア・エンディング・駅の画面に「まんがを1話から読む」の出口
   ②GoatCounter の数える印（脱出ゲームと同じ形・https のときだけ・1台1回） */
(() => {
  'use strict';
  const YOMU = 'https://kagishippo-bb.github.io/nyubu/yomu/';
  const GC = 'kagishippo';
  if (GC && location.protocol === 'https:') {
    const s = document.createElement('script');
    s.async = true; s.src = 'https://gc.zgo.at/count.js'; s.dataset.goatcounter = `https://${GC}.goatcounter.com/count`;
    document.head.appendChild(s);
  }
  function gc(name, once = true, n = 0) {
    try {
      if (!GC || location.protocol !== 'https:') return;
      const k = 'kgc-machigai-' + name;
      if (once && !n && localStorage.getItem(k)) return;
      if (!(window.goatcounter && window.goatcounter.count)) { if (n < 6) setTimeout(() => gc(name, once, n + 1), 1500); return; }
      if (once) localStorage.setItem(k, '1');
      window.goatcounter.count({path: 'machigai-' + name, title: name, event: true});
    } catch (_) {}
  }

  const css = document.createElement('style');
  css.textContent = '.yomu-exit{flex-basis:100%;display:block;margin:.4rem auto 0;max-width:22rem;padding:.75rem 1rem;border-radius:999px;background:#2e513b;color:#fff;text-align:center;font-weight:700;text-decoration:none;min-height:44px;box-sizing:border-box}';
  document.head.appendChild(css);

  const main = document.getElementById('main');
  function addExit(where) {
    const actions = main.querySelector('.next-actions');
    if (!actions || actions.querySelector('.yomu-exit')) return;
    const a = document.createElement('a');
    a.className = 'yomu-exit'; a.href = YOMU; a.target = '_blank'; a.rel = 'noopener';
    a.textContent = 'ドラとタマのまんがを1話から読む';
    a.addEventListener('click', () => gc('yomu-' + where, false));
    actions.appendChild(a);
  }
  function onScreen() {
    const clear = main.querySelector('.clear-screen');
    if (clear) {
      // 見出し「8月　氷の水族館　クリア！」と「ふつうの違いを…」から、月と難しさを読む
      const month = (clear.querySelector('h2')?.textContent.match(/^(\d+)月/) || [])[1];
      const level = /むずかしい/.test(clear.querySelector('h2 + p')?.textContent || '') ? 'hard' : 'normal';
      if (month) gc(`clear-${month.padStart(2, '0')}-${level}`);
      addExit('clear');
    }
    if (main.querySelector('.ending-screen')) { gc('ending'); addExit('ending'); }
    if (main.querySelector('.station-screen')) { gc('station'); addExit('station'); }
    if (main.classList.contains('play-view')) gc('start');
  }
  new MutationObserver(onScreen).observe(main, {childList: true});
  gc('open');
})();

/* ③WebP が読めない古いブラウザでは、同じ名前の PNG に切りかえる（10/29） */
document.addEventListener('error', e => {
  const img = e.target;
  if (img.tagName === 'IMG' && /\.webp$/.test(img.getAttribute('src') || '')) img.src = img.getAttribute('src').replace(/\.webp$/, '.png');
}, true);
