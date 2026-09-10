const invalid = message => Object.assign(new Error(message), { status: 400, code: 'invalid_publication' });

export function normalizeDriveFileUrl(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\s\\\u0000-\u001f]/.test(value.trim())) throw invalid('정상적인 Google Drive 파일 링크를 입력해 주세요.');
  let url;
  try { url = new URL(value.trim()); } catch { throw invalid('정상적인 Google Drive 파일 링크를 입력해 주세요.'); }
  if (url.protocol !== 'https:' || !['drive.google.com', 'docs.google.com'].includes(url.hostname) || url.username || url.password || url.port) throw invalid('https://drive.google.com 파일 공유 링크를 입력해 주세요.');
  const pathId = url.pathname.match(/^\/file\/d\/([A-Za-z0-9_-]+)(?:\/(?:view|preview|edit))?\/?$/)?.[1];
  const queryId = /^\/(?:open|uc)\/?$/.test(url.pathname) && url.searchParams.getAll('id').length === 1 ? url.searchParams.get('id') : null;
  const fileId = pathId || queryId;
  if (!fileId || !/^[A-Za-z0-9_-]{10,200}$/.test(fileId) || (pathId && url.searchParams.has('id'))) throw invalid('폴더나 문서가 아닌 Drive 파일 공유 링크를 입력해 주세요.');
  const keys = url.searchParams.getAll('resourcekey');
  if (keys.length > 1 || (keys.length && !/^[A-Za-z0-9_-]{1,200}$/.test(keys[0]))) throw invalid('Drive resourcekey가 올바르지 않습니다.');
  return { fileId, url: `https://drive.google.com/file/d/${fileId}/view${keys.length ? `?resourcekey=${keys[0]}` : ''}` };
}

export function validatePublication(input) {
  if (!input || typeof input !== 'object') throw invalid('발행 정보를 입력해 주세요.');
  const { number, year, season } = input;
  if (!Number.isSafeInteger(number) || number < 1 || number > 999999) throw invalid('호수 번호는 1–999999 사이의 정수여야 합니다.');
  if (!Number.isInteger(year) || year < 1900 || year > 2100) throw invalid('발행 연도는 1900–2100 사이여야 합니다.');
  if (!['Summer', 'Winter'].includes(season)) throw invalid('Summer 또는 Winter를 선택해 주세요.');
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.trim().length > 300 || /[\u0000-\u001f]/.test(input.title)) throw invalid('제목을 1–300자로 입력해 주세요.');
  const drive = normalizeDriveFileUrl(input.url);
  return { number, label: `No.${number}`, date: `${year} ${season}`, year, season, title: input.title.trim(), url: drive.url, fileId: drive.fileId };
}

// Keep the committed archive's exact fields, URLs and order. A newer endpoint
// can include baseline rows, but may never overwrite the local baseline.
export function mergeArchive(legacy, published) {
  if (!Array.isArray(legacy) || !Array.isArray(published)) throw invalid('발행 목록을 읽을 수 없습니다.');
  const numbers = new Set(legacy.map(x => x.number));
  const files = new Set(legacy.map(x => normalizeDriveFileUrl(x.url).fileId));
  const latest = Math.max(0, ...numbers);
  const additions = [];
  for (const candidate of published) {
    const checked = validatePublication(candidate);
    if (numbers.has(checked.number) || files.has(checked.fileId) || checked.number <= latest) continue;
    numbers.add(checked.number); files.add(checked.fileId);
    const { fileId, ...issue } = checked;
    additions.push(issue);
  }
  return [...additions.sort((a, b) => b.number - a.number), ...legacy];
}
