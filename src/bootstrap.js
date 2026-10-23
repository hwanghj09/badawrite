import './style.css';

async function enableParallelRuntime() {
  if (!isSecureContext || !navigator.serviceWorker || window !== window.top) return false;
  const flag = 'badawrite-parallel-reload';
  try {
    if (crossOriginIsolated) sessionStorage.removeItem(flag);
    const registration = navigator.serviceWorker.register(`${import.meta.env.BASE_URL}parallel-runtime.js`, { updateViaCache: 'none' });
    const controlled = navigator.serviceWorker.controller || await new Promise(resolve => {
      let timer;
      const changed = () => { clearTimeout(timer); navigator.serviceWorker.removeEventListener('controllerchange', changed); resolve(navigator.serviceWorker.controller); };
      navigator.serviceWorker.addEventListener('controllerchange', changed);
      timer = setTimeout(() => { navigator.serviceWorker.removeEventListener('controllerchange', changed); resolve(null); }, 2000);
      registration.catch(() => changed());
    });
    void registration.catch(() => {});
    // Reload only before app startup, once per tab. Blocked isolation/embedded
    // browsers continue with one CPU thread rather than entering a reload loop.
    if (controlled && !crossOriginIsolated && !sessionStorage.getItem(flag)) {
      sessionStorage.setItem(flag, '1'); location.reload(); return true;
    }
  } catch { /* Unsupported storage or service workers use the regular runtime. */ }
  return false;
}

const main = document.querySelector('main');
main.inert = true;
if (!await enableParallelRuntime()) {
  await import('./main.js');
  main.inert = false;
}
