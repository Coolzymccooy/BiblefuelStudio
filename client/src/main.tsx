import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter/index.css'
import './index.css'
import App from './App.tsx'

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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
