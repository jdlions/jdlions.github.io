import { api } from './api-client.js';

export class ProductionEditorialService {
  constructor(state, session) { this.state=state; this.session=session; }
  static async create(session) {
    if(!session)return new ProductionEditorialService({issues:[],articles:[],photos:[],courses:[],courseWork:[],students:[],publications:[]},null);
    const issues=await api('/api/issues'), active=issues.find(x=>x.status==='active');
    let articles=[],photos=[],courses=[],courseWork=[];
    if(active){articles=await api(`/api/articles?issueId=${encodeURIComponent(active.id)}`);articles=await Promise.all(articles.map(a=>api(`/api/articles/${encodeURIComponent(a.id)}?issueId=${encodeURIComponent(active.id)}`)));photos=await api(`/api/photos?issueId=${encodeURIComponent(active.id)}`);}
    if(session?.role==='admin'){const result=await api('/api/classroom/courses');courses=result.courses||[];for(const course of courses){const result=await api(`/api/classroom/${encodeURIComponent(course.id)}/coursework`);courseWork.push(...(result.courseWork||[]).map(x=>({...x,courseId:course.id})));}}
    const students=[...new Set(articles.map(x=>x.studentId))].map(id=>({id,name:`Classroom user ${id.slice(-6)}`}));
    return new ProductionEditorialService({issues,articles:articles.map(x=>({...x,title:x.attachments?.[0]?.title||'Google Docs submission',originalContent:x.originalContent,editedContent:x.edit?.edited_html||'',editorNote:x.edit?.editor_note||'',noteVisibility:x.edit?.note_visibility||'internal',status:x.edit?.status||'unreviewed'})),photos,courses,courseWork,students,publications:[]},session);
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
  async submitPhotos(input,files){const created=[];for(const file of files){const body=new FormData();Object.entries(input).forEach(([k,v])=>body.append(k,v));body.append('file',file);created.push(await api('/api/photos/upload',{method:'POST',body}));}this.state.photos.push(...created);return created;}
  reset(){throw new Error('Production data cannot be reset from the browser.');}
  async setActiveIssue(id){this.state.issues.forEach(x=>x.status=x.id===id?'active':x.status==='active'?'draft':x.status);return api(`/api/issues/${encodeURIComponent(id)}/activate`,{method:'PATCH'});}
  async updatePhotoStatus(id,status){const row=this.state.photos.find(x=>x.id===id);if(row)row.status=status;const saved=await api(`/api/photos/${encodeURIComponent(id)}/status`,{method:'PATCH',body:JSON.stringify({status})});if(row)row.status=saved.status;return saved;}
  publishIssue(){throw new Error('Publication remains a separately governed workflow.');}
}
