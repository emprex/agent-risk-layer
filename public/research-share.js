(() => {
  const canonical = document.querySelector('link[rel="canonical"]')?.href || window.location.href;
  const title = document.querySelector('meta[property="og:title"]')?.content || document.title;
  const description = document.querySelector('meta[property="og:description"]')?.content || '';
  const shareText = `${title}\n${canonical}`;

  const links = {
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(canonical)}`,
    x: `https://x.com/intent/post?text=${encodeURIComponent(title)}&url=${encodeURIComponent(canonical)}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(canonical)}`,
    whatsapp: `https://wa.me/?text=${encodeURIComponent(shareText)}`,
    bluesky: `https://bsky.app/intent/compose?text=${encodeURIComponent(shareText)}`,
    email: `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(`${description}\n\n${canonical}`)}`,
  };

  document.querySelectorAll('[data-share-network]').forEach((link) => {
    const network = link.dataset.shareNetwork;
    if (links[network]) link.href = links[network];
  });

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(canonical);
      return true;
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = canonical;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const ok = document.execCommand('copy');
      textarea.remove();
      return ok;
    }
  };

  const announce = (root, message) => {
    const status = root.querySelector('[data-share-status]');
    if (status) status.textContent = message;
  };

  document.querySelectorAll('[data-copy-link]').forEach((button) => {
    button.addEventListener('click', async () => {
      const root = button.closest('[data-share-block]') || document;
      const copied = await copyText();
      announce(root, copied ? 'Link copied.' : 'Copy failed. Select the address from your browser.');
    });
  });

  document.querySelectorAll('[data-native-share]').forEach((button) => {
    if (!navigator.share) {
      button.hidden = true;
      return;
    }
    button.addEventListener('click', async () => {
      const root = button.closest('[data-share-block]') || document;
      try {
        await navigator.share({ title, text: description, url: canonical });
        announce(root, 'Share sheet opened.');
      } catch (error) {
        if (error?.name !== 'AbortError') announce(root, 'Sharing is not available here. Try Copy link.');
      }
    });
  });
})();
