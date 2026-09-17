(() => {
  const header = document.querySelector('.marketing-header');
  const nav = header?.querySelector('.marketing-nav');
  if (!header || !nav) return;

  const style = document.createElement('style');
  style.textContent = `
    .nav-toggle{display:none;width:46px;height:46px;border:1px solid rgba(11,17,23,.14);border-radius:10px;background:#fff;color:#0b1117;align-items:center;justify-content:center;flex-direction:column;gap:6px;cursor:pointer}
    .nav-toggle span{display:block;width:20px;height:1.5px;background:currentColor;transition:transform .18s ease,opacity .18s ease}
    @media(max-width:820px){
      .marketing-header{display:grid;grid-template-columns:1fr auto;align-items:center;flex-wrap:nowrap}
      .nav-toggle{display:flex}
      .marketing-nav{display:none;grid-column:1/-1;width:100%;overflow:visible;padding:14px 0 4px;border-top:1px solid rgba(11,17,23,.09);margin-top:2px;flex-direction:column;align-items:stretch;gap:2px}
      .marketing-header.nav-open .marketing-nav{display:flex}
      .marketing-nav a,.marketing-nav .nav-cta{min-height:48px;display:flex;align-items:center;padding:0 12px;border-radius:8px;white-space:normal}
      .marketing-nav a:not(.nav-cta)::after{display:none}
      .marketing-nav .nav-cta{justify-content:center;margin-top:8px}
      .marketing-header.nav-open .nav-toggle span:first-child{transform:translateY(3.75px) rotate(45deg)}
      .marketing-header.nav-open .nav-toggle span:last-child{transform:translateY(-3.75px) rotate(-45deg)}
    }
  `;
  document.head.appendChild(style);

  if (!nav.id) nav.id = 'marketing-navigation';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'nav-toggle';
  toggle.setAttribute('aria-controls', nav.id);
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-label', 'Open navigation');
  toggle.innerHTML = '<span aria-hidden="true"></span><span aria-hidden="true"></span>';
  header.insertBefore(toggle, nav);

  const setOpen = (open) => {
    header.classList.toggle('nav-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  };

  toggle.addEventListener('click', () => setOpen(!header.classList.contains('nav-open')));
  nav.addEventListener('click', (event) => {
    if (event.target.closest('a')) setOpen(false);
  });
  document.addEventListener('click', (event) => {
    if (header.classList.contains('nav-open') && !header.contains(event.target)) setOpen(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && header.classList.contains('nav-open')) {
      setOpen(false);
      toggle.focus();
    }
  });
  window.addEventListener('resize', () => {
    if (window.innerWidth > 820) setOpen(false);
  });
})();
