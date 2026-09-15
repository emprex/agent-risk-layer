// Social crawlers receive these tags in the initial HTML; no JavaScript required.
export const SITE_ORIGIN = 'https://agentrisklayer.com';
export const DEFAULT_SOCIAL_IMAGE = `${SITE_ORIGIN}/agentrisklayer-social-v2-1200x630.png`;
const DEFAULT_DESCRIPTION = 'Evidence-led AI agent security. Understand agent access, test authority boundaries and make accountable deployment decisions.';
const DEFAULT_ALT = 'AgentRiskLayer — evidence-led AI agent security';
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const decode = value => String(value).replace(/&(amp|lt|gt|quot|apos|#39|#(\d+)|#x([\da-f]+));/gi, (match, entity, decimal, hex) => decimal || hex ? String.fromCodePoint(parseInt(decimal || hex, hex ? 16 : 10)) : ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" })[entity.toLowerCase()]);
function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(m => [m[1].toLowerCase(), decode(m[2] ?? m[3])]));
}
function httpsUrl(value, fallback) {
  try {
    const url = new URL(value, SITE_ORIGIN);
    if (url.protocol !== 'https:' || url.username || url.password) return fallback;
    return url.href;
  } catch { return fallback; }
}
export function socialPageUrl(pathname = '/') {
  let route = new URL(pathname, SITE_ORIGIN).pathname.replace(/\/{2,}/g, '/');
  if (route === '/index.html') route = '/';
  if (route.length > 1) route = route.replace(/\/$/, '');
  if (route === '/research' || route === '/research.html' || route.startsWith('/research/')) route = route.replace(/\.html$/, '');
  else if (route !== '/' && !route.startsWith('/checks/') && !route.split('/').pop().includes('.')) route += '.html';
  return SITE_ORIGIN + route;
}
export function applySocialMetadata(html, pathname = '/') {
  return String(html).replace(/<head\b[^>]*>([\s\S]*?)<\/head>/i, (head, contents) => {
    const metas = [...contents.matchAll(/<meta\b[^>]*>/gi)].map(m => attributes(m[0]));
    const meta = key => metas.find(m => (m.property || m.name) === key)?.content?.trim();
    const title = meta('og:title') || decode(contents.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || 'AgentRiskLayer').trim();
    const description = meta('og:description') || meta('description') || DEFAULT_DESCRIPTION;
    const url = socialPageUrl(pathname);
    // Optional explicit override: og:image plus type, width, height and alt.
    const image = httpsUrl(meta('og:image') || DEFAULT_SOCIAL_IMAGE, DEFAULT_SOCIAL_IMAGE);
    const custom = image !== DEFAULT_SOCIAL_IMAGE;
    const imageType = custom && /\.jpe?g(?:[?#]|$)/i.test(image) ? 'image/jpeg' : 'image/png';
    const dimension = (key, fallback) => custom && /^[1-9]\d*$/.test(meta(key) || '') ? meta(key) : fallback;
    const alt = custom ? meta('og:image:alt') || DEFAULT_ALT : DEFAULT_ALT;
    const og = {
      title, description, type: new URL(url).pathname.startsWith('/research/') ? 'article' : 'website', url,
      image, 'image:secure_url': image, 'image:type': imageType,
      'image:width': dimension('og:image:width', '1200'), 'image:height': dimension('og:image:height', '630'),
      'image:alt': alt, site_name: 'AgentRiskLayer',
    };
    const twitter = { card: 'summary_large_image', title, description, image, 'image:alt': alt, site: '@AgentRiskLayer', creator: '@AgentRiskLayer' };
    const tags = [
      ...Object.entries(og).map(([key, value]) => `<meta property="og:${key}" content="${escape(value)}">`),
      ...Object.entries(twitter).map(([key, value]) => `<meta name="twitter:${key}" content="${escape(value)}">`),
    ].join('\n  ');
    const cleaned = contents.replace(/<meta\b[^>]*>/gi, tag => {
      const attrs = attributes(tag);
      return /^(og:|twitter:)/.test(attrs.property || attrs.name || '') ? '' : tag;
    });
    return head.replace(contents, cleaned + '\n  ' + tags + '\n');
  });
}
