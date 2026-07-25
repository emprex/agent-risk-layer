import { hydrateNav } from './shared.js';

const search = document.querySelector('#helpSearch');
const clear = document.querySelector('#clearSearch');
const status = document.querySelector('#searchStatus');
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
