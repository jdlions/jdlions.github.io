import { api } from './api-client.js';

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
  static empty(session, request=api) { return new ProductionEditorialService({issues:[],articles:[],photos:[],students:[],campaigns:[],assignments:[],publications:[]},session,request); }
  static async create(session, request=api) { const service=ProductionEditorialService.empty(session,request); await service.load(); return service; }
  async load() {
    if(!this.session)return this;
    let students=[];
    const [nativeArticles,assignmentData,nativePhotos]=await Promise.all([this.request('/api/native/articles'),this.request('/api/assignments'),this.request('/api/photos')]);
    const articles=nativeArticles.map(x=>({...x,native:true})),photos=nativePhotos.map(normalizePhoto);
    if(this.session.role==='admin'){const rosterResult=await this.request('/api/classroom/students');students=rosterResult.students||[];}
    else if(this.session.studentId){students=[{id:this.session.studentId,name:this.session.name||'이름 확인 불가'}];}
    this.state={issues:[],articles:articles.map(x=>this.normalizeArticle(x)),photos,students,campaigns:assignmentData.campaigns||[],assignments:assignmentData.assignments||[],publications:[]};
    return this;
  }
  normalizeArticle(x){return {...x,title:x.titleKo||x.titleEn||x.attachments?.find(a=>a.title)?.title||'제목 없는 기사',articleTypeId:x.articleType||x.articleTypeId,originalContent:x.draftHtml||x.originalContent||'',editedContent:x.editorDraftHtml||x.edit?.edited_html||'',editorNote:x.studentFeedback||x.edit?.editor_note||'',status:x.status||x.edit?.status||'draft',native:Boolean(x.native)};}
  async getArticleDetail(id){
    const row=this.state.articles.find(x=>x.id===id);if(!row)throw new Error('Article submission not found.');
    if(row.detailLoaded)return structuredClone(row);
    if(row.native){const detail=await this.request(`/api/native/articles/${encodeURIComponent(id)}`);Object.assign(row,this.normalizeArticle(detail),{...detail,detailLoaded:true});return structuredClone(row);}
    if(!this.detailRequests.has(id)){Object.assign(row,{detailLoading:true,detailError:null});this.detailRequests.set(id,this.request(`/api/articles/${encodeURIComponent(id)}?issueId=${encodeURIComponent(row.issueId)}`).then(detail=>{Object.assign(row,this.normalizeArticle(detail),{detailLoaded:true,detailLoading:false,detailError:null});return row;}).catch(error=>{Object.assign(row,{detailLoading:false,detailError:error.message||'Article detail could not be loaded.'});throw error;}).finally(()=>this.detailRequests.delete(id)));}
    return structuredClone(await this.detailRequests.get(id));
  }
  async refreshArticleDetail(id){const row=this.state.articles.find(x=>x.id===id);if(!row)throw new Error('Article not found.');const detail=await this.request(`/api/native/articles/${encodeURIComponent(id)}`);Object.assign(row,this.normalizeArticle(detail),{...detail,detailLoaded:true});return structuredClone(row);}
  getState(){return structuredClone(this.state);}
  getActiveIssue(){return structuredClone(this.state.issues.find(x=>x.status==='active')||null);}
  listCampaigns(){return structuredClone(this.state.campaigns);}
  listAssignments(){return structuredClone(this.state.assignments);}
  listStudents(){return structuredClone(this.state.students);}
  listArticles(filters={}){return structuredClone(this.state.articles.filter(x=>Object.entries(filters).every(([k,v])=>!v||x[k]===v)));}
  listPhotos(filters={}){return structuredClone(this.state.photos.filter(x=>Object.entries(filters).every(([k,v])=>!v||x[k]===v)));}
  async createNativeArticle(input){const saved=this.normalizeArticle(await this.request('/api/native/articles',{method:'POST',body:JSON.stringify(input)}));this.state.articles.unshift(saved);return structuredClone(saved);}
  async createAssignment(input){const campaign=await this.request('/api/assignments',{method:'POST',body:JSON.stringify(input)});this.state.campaigns.unshift(campaign);return structuredClone(campaign);}
  async updateAssignment(id,input){const campaign=await this.request(`/api/assignments/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(input)});Object.assign(this.state.campaigns.find(x=>x.id===id),campaign);return campaign;}
  async distributeAssignment(id,input){const campaign=await this.request(`/api/assignments/${encodeURIComponent(id)}/distribute`,{method:'POST',body:JSON.stringify(input)});Object.assign(this.state.campaigns.find(x=>x.id===id),campaign);await this.refreshAssignments();return campaign;}
  async refreshAssignments(){const data=await this.request('/api/assignments');this.state.campaigns=data.campaigns||[];this.state.assignments=data.assignments||[];return data;}
  async openAssignmentArticle(instanceId){const saved=this.normalizeArticle(await this.request(`/api/assignment-instances/${encodeURIComponent(instanceId)}/article`,{method:'POST'}));const existing=this.state.articles.find(x=>x.id===saved.id);if(existing)Object.assign(existing,saved);else this.state.articles.unshift(saved);const instance=this.state.assignments.find(x=>x.id===instanceId);if(instance){instance.articleId=saved.id;instance.articleStatus=saved.status;}return structuredClone(saved);}
  async saveNativeDraft(id,input){const saved=this.normalizeArticle(await this.request(`/api/native/articles/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(input)}));Object.assign(this.state.articles.find(x=>x.id===id),saved);return saved;}
  async submitNativeArticle(id){await this.request(`/api/native/articles/${encodeURIComponent(id)}/submit`,{method:'POST'});return this.refreshArticleDetail(id);}
  async importNativeArticle(id,file){const body=new FormData();body.append('file',file);await this.request(`/api/native/articles/${encodeURIComponent(id)}/import`,{method:'POST',body});return this.refreshArticleDetail(id);}
  async saveNativeEditor(id,input){const saved=this.normalizeArticle(await this.request(`/api/native/articles/${encodeURIComponent(id)}/editor`,{method:'PATCH',body:JSON.stringify(input)}));Object.assign(this.state.articles.find(x=>x.id===id),saved);return saved;}
  async setNativeStatus(id,status){await this.request(`/api/native/articles/${encodeURIComponent(id)}/status`,{method:'PATCH',body:JSON.stringify({status})});return this.refreshArticleDetail(id);}
  async submitPhotos(input,files){const created=[];for(const file of files){const body=new FormData();Object.entries(input).forEach(([k,v])=>body.append(k,v));body.append('copyright','true');body.append('file',file);created.push(normalizePhoto(await this.request('/api/photos/upload',{method:'POST',body})));}this.state.photos.unshift(...created);return created;}
  reset(){throw new Error('Production data cannot be reset from the browser.');}
  async updatePhotoStatus(id,status){const saved=normalizePhoto(await this.request(`/api/photos/${encodeURIComponent(id)}/status`,{method:'PATCH',body:JSON.stringify({status})}));const row=this.state.photos.find(x=>x.id===id);if(row)Object.assign(row,saved);return saved;}
  publishIssue(){throw new Error('Publication remains a separately governed workflow.');}
}
