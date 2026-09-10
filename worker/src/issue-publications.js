import legacyArchive from '../../data/issues.json' with { type: 'json' };
import { normalizeDriveFileUrl, validatePublication } from '../../assets/js/shared/issue-publication.js';

const problem = (message, status = 409, code = 'publication_conflict') => Object.assign(new Error(message), { status, code });
const publicIssue = row => ({ number: row.number, label: `No.${row.number}`, date: `${row.year} ${row.season}`, year: row.year, season: row.season, title: row.title, url: row.url });
const baselineMax = Math.max(...legacyArchive.map(x => x.number));
const baselineFiles = new Set(legacyArchive.map(x => normalizeDriveFileUrl(x.url).fileId));

export class IssuePublications {
  constructor(db) { this.db = db.withSession ? db.withSession('first-primary') : db; }
  async list() {
    const { results } = await this.db.prepare('SELECT number, year, season, title, url FROM issue_publications ORDER BY number DESC').bind().all();
    return [...results.map(publicIssue), ...legacyArchive];
  }
  async publish(input, key, actor) {
    const issue = validatePublication(input);
    if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(key)) throw problem('유효한 발행 요청 ID가 필요합니다.', 400, 'invalid_idempotency_key');
    if (input.publicPdfConfirmed !== true) throw problem('미리보기에서 PDF와 공개 공유 설정을 확인해 주세요.', 400, 'pdf_confirmation_required');
    const requestJson = JSON.stringify(issue);
    const replay = async () => {
      const previous = await this.db.prepare('SELECT * FROM issue_publications WHERE idempotency_key = ?').bind(key).first();
      if (!previous) return null;
      if (previous.request_json !== requestJson || previous.published_by !== actor) throw problem('이 요청 ID는 다른 발행에 사용되었습니다.', 409, 'idempotency_conflict');
      return { issue: publicIssue(previous), replayed: true };
    };
    const previous = await replay();
    if (previous) return previous;
    if (legacyArchive.some(x => x.number === issue.number)) throw problem('이미 발행된 호수 번호입니다.');
    if (baselineFiles.has(issue.fileId)) throw problem('이미 발행된 Drive 파일입니다.');
    // This one statement checks the latest number and inserts atomically.
    // Unique indexes also arbitrate concurrent requests from different Workers.
    try {
      await this.db.prepare(`INSERT INTO issue_publications
        (number, year, season, title, url, drive_file_id, idempotency_key, request_json, published_by, published_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE ? > MAX(?, COALESCE((SELECT MAX(number) FROM issue_publications), 0))`)
        .bind(issue.number, issue.year, issue.season, issue.title, issue.url, issue.fileId, key, requestJson, actor, new Date().toISOString(), issue.number, baselineMax).run();
    } catch (error) {
      const retried = await replay();
      if (retried) return retried;
      if (String(error.message).includes('UNIQUE constraint')) throw problem('이미 발행된 호수 번호 또는 Drive 파일입니다.');
      throw error;
    }
    const inserted = await replay();
    if (!inserted) throw problem('현재 최신 호수보다 큰 번호를 입력해 주세요. 목록을 새로 확인해 주세요.');
    return { ...inserted, replayed: false };
  }
}

// This is the only unauthenticated data route; only archive metadata is selected.
export async function publicArchiveResponse(request, env) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': 'https://jdlions.github.io', 'X-Content-Type-Options': 'nosniff' };
  if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405, headers: { ...headers, Allow: 'GET, HEAD' } });
  try {
    const issues = await new IssuePublications(env.DB).list();
    return new Response(request.method === 'HEAD' ? null : JSON.stringify(issues), { headers });
  } catch {
    return new Response(request.method === 'HEAD' ? null : JSON.stringify({ error: { code: 'archive_unavailable', message: '발행 목록을 불러올 수 없습니다.' } }), { status: 503, headers });
  }
}
