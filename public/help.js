import { hydrateNav } from './shared.js';

const search = document.querySelector('#helpSearch');
const clear = document.querySelector('#clearSearch');
const status = document.querySelector('#searchStatus');
const processSection = document.querySelector('#process');
if (processSection && !document.querySelector('#control-intelligence')) {
  processSection.insertAdjacentHTML('afterend', `<section class="panel help-section" data-search="control intelligence architecture threat evidence chain deployment snapshot" id="control-intelligence"><span class="eyebrow">Control Intelligence</span><h2>Follow evidence from architecture to deployment</h2><p>Control Intelligence connects your agent architecture to the risks that apply, the tests performed, the evidence collected, the findings discovered, the fixes made and the final deployment decision.</p><ol class="manual-steps"><li><strong>Describe the agent architecture.</strong></li><li><strong>Confirm applicable controls.</strong></li><li><strong>Run or record tests.</strong></li><li><strong>Review evidence and findings.</strong></li><li><strong>Fix and retest.</strong></li><li><strong>Make a deployment decision.</strong></li></ol><p>This is evidence-linked decision support, not an accredited certification or a guarantee that the system is risk-free.</p><a class="button ghost" href="/control-intelligence.html">Open Control Intelligence</a></section>`);
}
const sections = [...document.querySelectorAll('.help-section')];
const noResults = document.querySelector('#noHelpResults');

function normalise(value) {
  return String(value || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

function filterHelp() {
  const query = normalise(search.value.trim());
  let visible = 0;
  for (const section of sections) {
    const matches = !query || normalise(`${section.dataset.search || ''} ${section.textContent}`).includes(query);
    section.hidden = !matches;
    if (matches) visible += 1;
  }
  noResults.hidden = visible !== 0;
  status.textContent = query
    ? `${visible} help ${visible === 1 ? 'section' : 'sections'} found for “${search.value.trim()}”.`
    : 'Showing the complete Help Centre.';
}

search.addEventListener('input', filterHelp);
clear.addEventListener('click', () => {
  search.value = '';
  filterHelp();
  search.focus();
});

document.querySelectorAll('.help-nav a').forEach((link) => link.addEventListener('click', () => {
  if (search.value) {
    search.value = '';
    filterHelp();
  }
}));

hydrateNav();
