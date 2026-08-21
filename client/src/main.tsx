import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter/index.css'
import './index.css'
import App from './App.tsx'
import { initTheme } from './lib/theme'

const PRELOAD_RELOAD_KEY = 'bfs:preload-reload-attempted';

window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  if (sessionStorage.getItem(PRELOAD_RELOAD_KEY)) return;
  sessionStorage.setItem(PRELOAD_RELOAD_KEY, '1');
  window.location.reload();
});

window.addEventListener('load', () => {
  sessionStorage.removeItem(PRELOAD_RELOAD_KEY);
  sessionStorage.removeItem('bfs:chunk-reload-attempted');
});

// Keep the installed PWA service worker fresh. registerType:'autoUpdate'
// auto-reloads the page when a NEW worker takes control — but the browser only
// CHECKS for a new worker on a full navigation. Within a long single-page
// session the app can sit on a stale cached bundle, which is exactly the
// "I had to refresh the app before the fix showed up" symptom on iPhone.
// Polling reg.update() forces the check on a timer (and on tab refocus), so a
// fresh deploy rolls out within ~1 minute without a manual refresh.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.ready
    .then((reg) => {
      const check = () => { void reg.update().catch(() => {}); };
      setInterval(check, 60_000);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
    })
    .catch(() => {});
}

// Apply the saved theme BEFORE first paint, otherwise a light-mode user sees
// a flash of the dark app on every load.
initTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
