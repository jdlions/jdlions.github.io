import { api } from './api-client.js';

export function selectConfiguredCourses(courses = [], configuredCourseId) {
  return configuredCourseId ? courses.filter(course => course.id === configuredCourseId) : [];
}

export function normalizePhoto(row) {
  if (!row) return row;
  const byteSize = row.byteSize ?? row.byte_size;
  return {
    ...row,
    issueId: row.issueId ?? row.issue_id,
    articleSubmissionId: row.articleSubmissionId ?? row.article_submission_id,
    studentId: row.studentId ?? row.student_google_id,
    driveFileId: row.driveFileId ?? row.drive_file_id,
    fileId: row.fileId ?? row.driveFileId ?? row.drive_file_id,
    mimeType: row.mimeType ?? row.mime_type,
    byteSize,
    fileSize: row.fileSize ?? (Number.isFinite(Number(byteSize)) ? `${(Number(byteSize) / 1024 / 1024).toFixed(1)} MB` : ''),
    sourceType: row.sourceType ?? row.source_type,
    rightsConfirmed: Boolean(row.rightsConfirmed ?? row.rights_confirmed ?? true),
    contentUrl: row.contentUrl || (row.id ? `/api/photos/${encodeURIComponent(row.id)}/content` : ''),
    originalUrl: row.originalUrl || (row.id ? `/api/photos/${encodeURIComponent(row.id)}/original` : ''),
    createdAt: row.createdAt ?? row.created_at,
    updatedAt: row.updatedAt ?? row.updated_at
  };
}

export class ProductionEditorialService {
  constructor(state, session, request=api) { this.state=state; this.session=session; this.request=request; this.detailRequests=new Map(); }
  static empty(session, request=api) { return new ProductionEditorialService({issues:[],articles:[],photos:[],courses:[],courseWork:[],students:[],publications:[]},session,request); }
  static async create(session, request=api) { const service=ProductionEditorialService.empty(session,request); await service.load(); return service; }
  async load() {
    if(!this.session)return this;
    const issues=await this.request('/api/issues'), active=issues.find(x=>x.status==='active');
    let articles=[],photos=[],courses=[],courseWork=[],students=[];
    if(active){[articles,photos]=await Promise.all([this.request(`/api/articles?issueId=${encodeURIComponent(active.id)}`),this.request(`/api/photos?issueId=${encodeURIComponent(active.id)}`)]);photos=photos.map(normalizePhoto);}
    if(this.session.role==='admin'){const [courseResult,rosterResult]=await Promise.all([this.request('/api/classroom/courses'),this.request('/api/classroom/students')]);courses=selectConfiguredCourses(courseResult.courses||[],active?.classroomCourseId);students=rosterResult.students||[];const course=courses[0];if(course){const result=await this.request(`/api/classroom/${encodeURIComponent(course.id)}/coursework`);courseWork=(result.courseWork||[]).map(x=>({...x,courseId:course.id}));}}
    else if(this.session.studentId){students=[{id:this.session.studentId,name:this.session.name||'이름 확인 불가'}];}
    this.state={issues,articles:articles.map(x=>this.normalizeArticle(x)),photos,courses,courseWork,students,publications:[]};
    return this;
  }
  normalizeArticle(x){return {...x,title:x.attachments?.find(a=>a.title)?.title||'Article submission',originalContent:x.originalContent||'',editedContent:x.edit?.edited_html||'',editorNote:x.edit?.editor_note||'',noteVisibility:x.edit?.note_visibility||'internal',status:x.edit?.status||'unreviewed'};}
  async getArticleDetail(id){
    const row=this.state.articles.find(x=>x.id===id);if(!row)throw new Error('Article submission not found.');
    if(row.detailLoaded)return structuredClone(row);
    if(!this.detailRequests.has(id)){Object.assign(row,{detailLoading:true,detailError:null});this.detailRequests.set(id,this.request(`/api/articles/${encodeURIComponent(id)}?issueId=${encodeURIComponent(row.issueId)}`).then(detail=>{Object.assign(row,this.normalizeArticle(detail),{detailLoaded:true,detailLoading:false,detailError:null});return row;}).catch(error=>{Object.assign(row,{detailLoading:false,detailError:error.message||'Article detail could not be loaded.'});throw error;}).finally(()=>this.detailRequests.delete(id)));}
    return structuredClone(await this.detailRequests.get(id));
  }
  getState(){return structuredClone(this.state);}
  getActiveIssue(){return structuredClone(this.state.issues.find(x=>x.status==='active')||null);}
  listCourses(){return structuredClone(this.state.courses);}
  listCourseWork(courseId){return structuredClone(this.state.courseWork.filter(x=>x.courseId===courseId));}
  listArticles(filters={}){return structuredClone(this.state.articles.filter(x=>Object.entries(filters).every(([k,v])=>!v||x[k]===v)));}
  listPhotos(filters={}){return structuredClone(this.state.photos.filter(x=>Object.entries(filters).every(([k,v])=>!v||x[k]===v)));}
  async createIssue(input){const pending={...input,id:`pending-${Date.now()}`,status:input.status||'draft',createdAt:new Date().toISOString()};this.state.issues.push(pending);const issue=await api('/api/issues',{method:'POST',body:JSON.stringify(input)});Object.assign(pending,issue);return pending;}
  async saveArticleEdit(id,editedHtml,editorNote,noteVisibility='internal',status){const row=this.state.articles.find(x=>x.id===id);Object.assign(row,{editedContent:editedHtml,editorNote,noteVisibility,status:status||row.status});const saved=await api(`/api/articles/${encodeURIComponent(id)}/edit`,{method:'PATCH',body:JSON.stringify({issueId:row.issueId,editedHtml,editorNote,noteVisibility,status:row.status})});Object.assign(row,{editedContent:saved.edited_html,editorNote:saved.editor_note,noteVisibility:saved.note_visibility,status:saved.status});return row;}
  async updateArticleStatus(id,status){const row=this.state.articles.find(x=>x.id===id);return this.saveArticleEdit(id,row.editedContent,row.editorNote,row.noteVisibility,status);}
  async submitPhotos(input,files){const created=[];for(const file of files){const body=new FormData();Object.entries(input).forEach(([k,v])=>body.append(k,v));body.append('copyright','true');body.append('file',file);created.push(normalizePhoto(await this.request('/api/photos/upload',{method:'POST',body})));}this.state.photos.unshift(...created);return created;}
  reset(){throw new Error('Production data cannot be reset from the browser.');}
  async setActiveIssue(id){this.state.issues.forEach(x=>x.status=x.id===id?'active':x.status==='active'?'draft':x.status);return api(`/api/issues/${encodeURIComponent(id)}/activate`,{method:'PATCH'});}
  async updatePhotoStatus(id,status){const row=this.state.photos.find(x=>x.id===id);if(row)row.status=status;const saved=normalizePhoto(await api(`/api/photos/${encodeURIComponent(id)}/status`,{method:'PATCH',body:JSON.stringify({status})}));if(row)Object.assign(row,saved);return saved;}
  publishIssue(){throw new Error('Publication remains a separately governed workflow.');}
}
