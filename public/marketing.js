(() => {
  const header = document.querySelector('.marketing-header');
  const nav = header?.querySelector('.marketing-nav');
  if (!header || !nav) return;

  if (!document.querySelector('link[href="/marketing-nav.css"]')) {
    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = '/marketing-nav.css';
    document.head.appendChild(stylesheet);
  }

  header.classList.add('nav-enhanced');
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

  const darkSurfaces = [...document.querySelectorAll('.hero, .authority, .price-band')];
  const syncHeaderTheme = () => {
    const y = header.getBoundingClientRect().top + header.offsetHeight / 2;
    const dark = darkSurfaces.some((surface) => {
      const rect = surface.getBoundingClientRect();
      return rect.top <= y && rect.bottom >= y;
    });
    header.classList.toggle('is-dark', dark);
    header.classList.toggle('is-light', !dark);
  };
  syncHeaderTheme();
  document.addEventListener('scroll', syncHeaderTheme, { passive: true });
  window.addEventListener('resize', syncHeaderTheme);

  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches && 'IntersectionObserver' in window) {
    const revealItems = document.querySelectorAll('.steps li, .authority-grid p');
    revealItems.forEach((item) => item.classList.add('reveal'));
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    revealItems.forEach((item) => observer.observe(item));
  }
})();
