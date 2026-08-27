const now = () => new Date().toISOString();
const json = value => JSON.stringify(value ?? []);
const parseIssue = row => row && ({ id: row.id, name: row.name, year: row.year, season: row.season, status: row.status, classroomCourseId: row.classroom_course_id, articleTypes: JSON.parse(row.article_types_json), createdAt: row.created_at, updatedAt: row.updated_at });

export class D1EditorialRepository {
  constructor(db) { this.db = db; }
  async listIssues() { const { results } = await this.db.prepare('SELECT * FROM issues ORDER BY created_at DESC').all(); return results.map(parseIssue); }
  async getIssue(id) { return parseIssue(await this.db.prepare('SELECT * FROM issues WHERE id=?').bind(id).first()); }
  async createIssue(input) {
    const timestamp = now(), id = crypto.randomUUID();
    await this.db.prepare('INSERT INTO issues(id,name,year,season,status,classroom_course_id,article_types_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,input.name,input.year,input.season,input.status || 'draft',input.classroomCourseId,json(input.articleTypes),timestamp,timestamp).run();
    return this.getIssue(id);
  }
  async setActiveIssue(id) { const timestamp=now(); await this.db.batch([this.db.prepare("UPDATE issues SET status='draft',updated_at=? WHERE status='active'").bind(timestamp),this.db.prepare("UPDATE issues SET status='active',updated_at=? WHERE id=?").bind(timestamp,id)]); const issue=await this.getIssue(id); if(!issue)throw Object.assign(new Error('Issue not found.'),{status:404,code:'issue_not_found'}); return issue; }
  async listEdits(issueId, studentId) { let q='SELECT * FROM article_edits WHERE issue_id=?', args=[issueId]; if(studentId){q+=' AND student_google_id=?';args.push(studentId);} return (await this.db.prepare(q).bind(...args).all()).results; }
  async getEdit(id) { return this.db.prepare('SELECT * FROM article_edits WHERE submission_id=?').bind(id).first(); }
  async saveEdit(id, input, actorId) { const timestamp=now(); await this.db.prepare(`INSERT INTO article_edits(submission_id,issue_id,course_id,course_work_id,student_google_id,edited_html,editor_note,note_visibility,status,updated_by_google_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(submission_id) DO UPDATE SET edited_html=excluded.edited_html,editor_note=excluded.editor_note,note_visibility=excluded.note_visibility,status=excluded.status,updated_by_google_id=excluded.updated_by_google_id,updated_at=excluded.updated_at`).bind(id,input.issueId,input.courseId,input.courseWorkId,input.studentGoogleId,input.editedHtml,input.editorNote,input.noteVisibility,input.status||'reviewing',actorId,timestamp,timestamp).run(); return this.getEdit(id); }
  async createPhoto(input) { const id=crypto.randomUUID(), timestamp=now(); await this.db.prepare('INSERT INTO photos(id,issue_id,article_submission_id,student_google_id,drive_file_id,filename,mime_type,byte_size,caption,photographer,source_type,rights_confirmed,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,input.issueId,input.articleSubmissionId,input.studentGoogleId,input.driveFileId,input.filename,input.mimeType,input.byteSize,input.caption,input.photographer,input.sourceType,input.rightsConfirmed?1:0,'unreviewed',timestamp,timestamp).run(); return this.getPhoto(id); }
  async listPhotos(issueId, studentId) { let q='SELECT * FROM photos WHERE issue_id=?',args=[issueId];if(studentId){q+=' AND student_google_id=?';args.push(studentId);}return (await this.db.prepare(q).bind(...args).all()).results; }
  async getPhoto(id) { return this.db.prepare('SELECT * FROM photos WHERE id=?').bind(id).first(); }
  async updatePhotoStatus(id,status){await this.db.prepare('UPDATE photos SET status=?,updated_at=? WHERE id=?').bind(status,now(),id).run();const row=await this.db.prepare('SELECT * FROM photos WHERE id=?').bind(id).first();if(!row)throw Object.assign(new Error('Photo not found.'),{status:404,code:'photo_not_found'});return row;}
}

export function repository(env) {
  if (!env.DB) throw Object.assign(new Error('D1 binding DB is required for production persistence.'), { status: 503, code: 'database_unconfigured' });
  return new D1EditorialRepository(env.DB);
}
