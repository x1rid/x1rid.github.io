(() => {
  const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const touchInput = navigator.maxTouchPoints > 0 || window.matchMedia('(pointer: coarse)').matches;
  if (reducedMotion || touchInput || window.__LEGACY_CURSOR_LOADED__) return;

  window.__CURSOR_NORMAL_URL = '../public/assets/cursor.gif';
  window.__CURSOR_REVERSED_URL = '../public/assets/cursor-reversed.gif';
  document.documentElement.classList.add('custom-cursor-enabled');
  const script = document.createElement('script');
  script.src = '../public/cursor.js';
  script.async = true;
  script.onload = () => { window.__LEGACY_CURSOR_LOADED__ = true; };
  script.onerror = () => document.documentElement.classList.remove('custom-cursor-enabled');
  document.body.appendChild(script);
})();
