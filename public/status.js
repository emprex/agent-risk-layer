import { escapeHtml, hydrateFooterLinks, hydrateNav } from './shared.js';
const root = document.querySelector('#statusRoot');
try {
  const response = await fetch(`/api/ready?time=${Date.now()}`, { cache: 'no-store', credentials: 'same-origin' });
  const data = await response.json();
  const checks = Array.isArray(data.readiness?.checks) ? data.readiness.checks : [];
  root.className = 'panel';
  root.innerHTML = `<div class="status-summary ${data.ok ? 'operational' : 'degraded'}"><span class="status-light"></span><div><span class="eyebrow">${data.ok ? 'All required systems operational' : 'Service attention required'}</span><h2>${escapeHtml(data.ok ? 'Operational' : 'Degraded')}</h2><p>Application ${escapeHtml(data.version || 'unknown')} · ${escapeHtml(data.productStage || 'unknown')} · checked ${new Date(data.timestamp || Date.now()).toLocaleString('en-GB')}</p></div></div><div class="status-check-grid"><article><span>Application</span><strong>${data.ok ? 'Ready' : 'Unavailable'}</strong><small>Public health and readiness checks</small></article><article><span>Database</span><strong>${data.database?.ok ? 'Connected' : 'Unavailable'}</strong><small>${escapeHtml(data.database?.adapter || 'unknown')} · ${Number(data.database?.latencyMs || 0)} ms</small></article><article><span>Required controls</span><strong>${checks.filter((item) => item.required && item.ok).length}/${checks.filter((item) => item.required).length}</strong><small>Production configuration gates</small></article></div><div class="readiness-list">${checks.map((item) => `<div><span class="status-light ${item.ok ? '' : 'bad'}"></span><strong>${escapeHtml(item.label)}</strong><b>${item.ok ? 'Pass' : item.required ? 'Fail' : 'Advisory'}</b></div>`).join('')}</div>`;
} catch (error) {
  root.className = 'panel';
  root.innerHTML = `<div class="error-box show">Could not retrieve live status: ${escapeHtml(error.message)}</div>`;
}
hydrateNav();
hydrateFooterLinks();
