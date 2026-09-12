import {draftSummary} from '../../assets/js/shared/article-preview.js';
export function pageResponse(rows){
 const byStatus={};for(const row of rows)byStatus[row.status]=(byStatus[row.status]||0)+1;
 return {items:rows.map(({draftHtml,editorDraftHtml,internalNote,...row})=>({...row,...(draftHtml===undefined?{}:draftSummary(draftHtml))})),nextCursor:null,limit:20,stats:{total:rows.length,byStatus},campaigns:[]};
}
