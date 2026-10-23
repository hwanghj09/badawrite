const root = document.documentElement;
const toggle = document.getElementById('theme-toggle');
const media = matchMedia('(prefers-color-scheme: dark)');
const metaColors = { light: '#f4f6f9', dark: '#0d1420' };

const current = () => root.dataset.theme || (media.matches ? 'dark' : 'light');

function sync() {
  const theme = current();
  toggle.setAttribute('aria-checked', String(theme === 'dark'));
  toggle.title = theme === 'dark' ? '화이트 모드로 바꾸기' : '다크 모드로 바꾸기';
  document.querySelectorAll('meta[name="theme-color"]').forEach(meta => { meta.content = metaColors[theme]; });
}

function apply(theme) {
  root.dataset.theme = theme;
  try { localStorage.setItem('theme', theme); } catch {}
  sync();
}

// Circular reveal from the switch where View Transitions exist; plain swap otherwise.
toggle.addEventListener('click', () => {
  const next = current() === 'dark' ? 'light' : 'dark';
  if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) return apply(next);
  const box = toggle.getBoundingClientRect();
  const x = box.left + box.width / 2, y = box.top + box.height / 2;
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  document.startViewTransition(() => apply(next)).ready.then(() => {
    root.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
      { duration: 560, easing: 'cubic-bezier(.2, .7, .2, 1)', pseudoElement: '::view-transition-new(root)' },
    );
  });
});
media.addEventListener('change', sync);
sync();
