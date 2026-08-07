const CANONICAL_ORIGIN = 'https://agentrisklayer.com';
const SOCIAL_IMAGE = `${CANONICAL_ORIGIN}/agentrisklayer-social-1200x630.png`;
const LOGO_IMAGE = `${CANONICAL_ORIGIN}/agentrisklayer-logo-512.png`;

const NOINDEX_PATHS = new Set([
  '/404.html',
  '/admin.html',
  '/auth.html',
  '/control-intelligence-control.html',
  '/control-intelligence-report.html',
  '/control-intelligence.html',
  '/control-plane.html',
  '/dashboard.html',
  '/inspection-detail.html',
  '/inspector.html',
  '/reset.html',
  '/result.html',
  '/risk-readiness.html',
  '/sales-agent.html',
  '/success.html',
  '/verify.html',
  '/workspaces.html',
]);

const INDEXABLE_APP_PATHS = new Set([
  '/assessment.html',
  '/redteam.html',
]);

function canonicalPath(pathname) {
  let value = String(pathname || '/');
  if (value === '/' || value === '/index.html') return '/';
  value = value.replace(/\/{2,}/g, '/');
  if (value.length > 1) value = value.replace(/\/$/, '');
  if (/^\/checks\/[a-z0-9-]+$/i.test(value)) return value;
  if (value === '/privacy') return '/privacy.html';
  if (value === '/terms') return '/terms.html';
  const leaf = value.slice(value.lastIndexOf('/') + 1);
  if (leaf && !leaf.includes('.')) return `${value}.html`;
  return value;
}

function ensureMeta(selector, attributes) {
  let node = document.head.querySelector(selector);
  if (!node) {
    node = document.createElement('meta');
    document.head.appendChild(node);
  }
  Object.entries(attributes).forEach(([name, value]) => node.setAttribute(name, value));
  return node;
}

function ensureLink(selector, attributes) {
  let node = document.head.querySelector(selector);
  if (!node) {
    node = document.createElement('link');
    document.head.appendChild(node);
  }
  Object.entries(attributes).forEach(([name, value]) => node.setAttribute(name, value));
  return node;
}

function pageDescription() {
  return document.head.querySelector('meta[name="description"]')?.getAttribute('content')?.trim() || '';
}

function pageTitle() {
  return document.title.replace(/\s*[|—-]\s*AgentRiskLayer\s*$/i, '').trim() || 'AgentRiskLayer';
}

function shouldNoindex(pathname) {
  if (NOINDEX_PATHS.has(pathname)) return true;
  return document.body?.dataset.shell === 'app' && !INDEXABLE_APP_PATHS.has(pathname);
}

function applyIndexingSignals(pathname) {
  const noindex = shouldNoindex(pathname);
  ensureMeta('meta[name="robots"]', {
    name: 'robots',
    content: noindex ? 'noindex,nofollow,noarchive,nosnippet' : 'index,follow,max-image-preview:large',
  });

  if (noindex) {
    document.head.querySelector('link[rel="canonical"]')?.remove();
    return null;
  }

  const canonicalUrl = `${CANONICAL_ORIGIN}${pathname}`;
  ensureLink('link[rel="canonical"]', { rel: 'canonical', href: canonicalUrl });
  return canonicalUrl;
}

function applySocialMetadata(canonicalUrl) {
  if (!canonicalUrl) return;
  const title = pageTitle();
  const description = pageDescription();

  ensureMeta('meta[property="og:site_name"]', { property: 'og:site_name', content: 'AgentRiskLayer' });
  ensureMeta('meta[property="og:type"]', { property: 'og:type', content: 'website' });
  ensureMeta('meta[property="og:url"]', { property: 'og:url', content: canonicalUrl });
  ensureMeta('meta[property="og:title"]', { property: 'og:title', content: title });
  if (description) ensureMeta('meta[property="og:description"]', { property: 'og:description', content: description });
  ensureMeta('meta[property="og:image"]', { property: 'og:image', content: SOCIAL_IMAGE });
  ensureMeta('meta[property="og:image:width"]', { property: 'og:image:width', content: '1200' });
  ensureMeta('meta[property="og:image:height"]', { property: 'og:image:height', content: '630' });
  ensureMeta('meta[property="og:image:alt"]', { property: 'og:image:alt', content: 'AgentRiskLayer — AI agent security and evidence' });

  ensureMeta('meta[name="twitter:card"]', { name: 'twitter:card', content: 'summary_large_image' });
  ensureMeta('meta[name="twitter:title"]', { name: 'twitter:title', content: title });
  if (description) ensureMeta('meta[name="twitter:description"]', { name: 'twitter:description', content: description });
  ensureMeta('meta[name="twitter:image"]', { name: 'twitter:image', content: SOCIAL_IMAGE });
}

function applyHomepageStructuredData(pathname) {
  if (pathname !== '/' || document.querySelector('#arl-structured-data')) return;
  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': `${CANONICAL_ORIGIN}/#website`,
        url: `${CANONICAL_ORIGIN}/`,
        name: 'AgentRiskLayer',
        publisher: { '@id': `${CANONICAL_ORIGIN}/#organization` },
      },
      {
        '@type': 'Organization',
        '@id': `${CANONICAL_ORIGIN}/#organization`,
        name: 'AgentRiskLayer',
        url: `${CANONICAL_ORIGIN}/`,
        logo: {
          '@type': 'ImageObject',
          url: LOGO_IMAGE,
          width: 512,
          height: 512,
        },
        email: 'support@agentrisklayer.com',
      },
      {
        '@type': 'SoftwareApplication',
        '@id': `${CANONICAL_ORIGIN}/#software`,
        name: 'AgentRiskLayer',
        url: `${CANONICAL_ORIGIN}/`,
        applicationCategory: 'SecurityApplication',
        operatingSystem: 'Web',
        description: 'Understand what an AI agent can access, stop unsafe actions before they reach your systems and keep evidence for accountable deployment decisions.',
        publisher: { '@id': `${CANONICAL_ORIGIN}/#organization` },
        offers: {
          '@type': 'Offer',
          name: 'Community',
          price: '0',
          priceCurrency: 'GBP',
          url: `${CANONICAL_ORIGIN}/pricing.html`,
        },
      },
    ],
  };
  const script = document.createElement('script');
  script.id = 'arl-structured-data';
  script.type = 'application/ld+json';
  script.textContent = JSON.stringify(graph);
  document.head.appendChild(script);
}

export function applyDocumentSeo() {
  const pathname = canonicalPath(location.pathname);
  const canonicalUrl = applyIndexingSignals(pathname);
  applySocialMetadata(canonicalUrl);
  applyHomepageStructuredData(pathname);
}
