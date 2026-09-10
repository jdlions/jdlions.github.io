import { escapeHtml } from '../shared/ui.js';
import { mergeArchive } from '../shared/issue-publication.js';

const list = document.querySelector('#archive-list');
const endpoint = 'https://lions-pride-editorial-api.editor-936.workers.dev/api/public/issues';
function render(issues) {
  let previousYear;
  list.innerHTML = issues.map(issue => {
    const heading = previousYear === issue.year ? '' : `<div class="year-lbl">${escapeHtml(issue.year)}</div>`;
    previousYear = issue.year;
    const season = issue.season === 'Winter' ? 'w' : 's';
    return `${heading}<a class="issue-row" href="${escapeHtml(issue.url)}" target="_blank" rel="noopener noreferrer"><span class="ino">${escapeHtml(issue.label)}</span><span class="ititle">${escapeHtml(issue.title)}</span><span class="spill ${season}"><span class="sdot"></span>${escapeHtml(issue.season)}</span><span class="iarrow">↗</span></a>`;
  }).join('');
  const numbers = issues.map(x => x.number);
  document.querySelector('.archive-count').textContent = `No.${Math.min(...numbers)} — No.${Math.max(...numbers)}`;
}
async function read(url) {
  const response = await fetch(url, { credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error('Archive data unavailable');
  return response.json();
}
// A failed API never removes the committed baseline; failed JSON retains HTML.
try {
  const legacy = await read('./data/issues.json');
  render(mergeArchive(legacy, []));
  try { render(mergeArchive(legacy, await read(endpoint))); }
  catch (error) { console.warn('Using committed Archive fallback:', error.message); }
} catch (error) { console.warn('Using embedded Archive fallback:', error.message); }
