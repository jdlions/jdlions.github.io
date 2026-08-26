import { seedState, STORAGE_KEY } from '../data/mock-data.js';
const clone = value => JSON.parse(JSON.stringify(value));
export class MockEditorialService {
  constructor() { this.state = this.load(); }
  load() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || clone(seedState); } catch { return clone(seedState); } }
  persist() { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state)); window.dispatchEvent(new CustomEvent('editorial:change')); }
  reset() { this.state = clone(seedState); this.persist(); }
  getState() { return clone(this.state); }
  getActiveIssue() { return clone(this.state.issues.find(x => x.status === 'active') || null); }
  listCourses() { return clone(this.state.courses); }
  listCourseWork(courseId) { return clone(this.state.courseWork.filter(x => x.courseId === courseId)); }
  createIssue(input) {
    const issue = { ...input, id:`issue-${Date.now()}`, status:input.status || 'draft', createdAt:new Date().toISOString() };
    this.state.issues.push(issue); this.persist(); return clone(issue);
  }
  setActiveIssue(id) { this.state.issues.forEach(x => { if (x.status === 'active') x.status = 'draft'; }); const issue=this.state.issues.find(x=>x.id===id); if(issue) issue.status='active'; this.persist(); }
  listArticles(filters = {}, session) {
    let rows=this.state.articles;
    if (session?.role === 'student') rows=rows.filter(x=>x.studentId===session.id);
    for (const [key,value] of Object.entries(filters)) if(value) rows=rows.filter(x=>x[key]===value);
    return clone(rows);
  }
  saveArticleEdit(id, editedContent, editorNote, noteVisibility='internal') { const row=this.state.articles.find(x=>x.id===id); if(!row) throw new Error('Submission unavailable.'); row.editedContent=editedContent; row.editorNote=editorNote; row.noteVisibility=noteVisibility; row.updatedAt=new Date().toISOString(); if(row.status==='unreviewed') row.status='reviewing'; this.persist(); return clone(row); }
  updateArticleStatus(id,status) { const row=this.state.articles.find(x=>x.id===id); if(!row) throw new Error('Submission unavailable.'); row.status=status; row.updatedAt=new Date().toISOString(); this.persist(); return clone(row); }
  listPhotos(filters = {}, session) { let rows=this.state.photos; if(session?.role==='student') rows=rows.filter(x=>x.studentId===session.id); for(const [key,value] of Object.entries(filters)) if(value) rows=rows.filter(x=>x[key]===value); return clone(rows); }
  submitPhotos(input, files, session) { if(session?.role!=='student') throw new Error('Student session required.'); const created=[...files].map((file,i)=>({id:`photo-${Date.now()}-${i}`, issueId:input.issueId, studentId:session.id, articleSubmissionId:input.articleSubmissionId, fileId:`local-mock-${Date.now()}-${i}`, filename:file.name, resolution:'Pending upload', fileSize:`${Math.max(.1,file.size/1048576).toFixed(1)} MB`, caption:input.caption, photographer:input.photographer, sourceType:input.sourceType, status:'unreviewed', createdAt:new Date().toISOString(), color:'#4a493f'})); this.state.photos.push(...created); this.persist(); return clone(created); }
  updatePhotoStatus(id,status) { const row=this.state.photos.find(x=>x.id===id); if(!row) throw new Error('Photo unavailable.'); row.status=status; this.persist(); return clone(row); }
  publishIssue(input) { const publication={...input,id:`publication-${Date.now()}`,createdAt:new Date().toISOString()}; this.state.publications.unshift(publication); const issue=this.state.issues.find(x=>x.id===input.issueId); if(issue) issue.status='published'; this.persist(); return clone(publication); }
}
