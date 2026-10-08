import {characterCount} from './character-count.js';

export function studentSubmissions(revisions=[]) {
  return revisions.filter(r=>r.authorRole==='student'&&['submission','resubmission'].includes(r.revisionKind)&&typeof r.contentHtml==='string')
    .slice().sort((a,b)=>Number(b.revisionNumber)-Number(a.revisionNumber)||String(b.createdAt).localeCompare(String(a.createdAt))||String(b.id).localeCompare(String(a.id)));
}
const words=typeof Intl.Segmenter==='function'?new Intl.Segmenter('ko',{granularity:'word'}):null;
export function wordTokens(text) {
  // Korean word segmentation plus separate whitespace/newline runs. Never trim:
  // spaces and paragraph breaks are part of the submitted manuscript.
  return words?[...words.segment(text)].map(x=>x.segment):text.match(/\s+|[\p{L}\p{N}\p{M}]+|[^\s]/gu)||[];
}
function merge(parts) {
  const result=[];
  for(const part of parts){if(!part.text)continue;const last=result.at(-1);if(last?.kind===part.kind)last.text+=part.text;else result.push({...part});}
  return result;
}
function backtrack(trace,oldTokens,newTokens) {
  const parts=[];let x=oldTokens.length,y=newTokens.length;
  for(let d=trace.length-1;d>=0;d--){
    const v=trace[d],k=x-y,prevK=k===-d||(k!==d&&(v.get(k-1)??-Infinity)<(v.get(k+1)??-Infinity))?k+1:k-1;
    const prevX=v.get(prevK)??0,prevY=prevX-prevK;
    while(x>prevX&&y>prevY){parts.push({kind:'equal',text:oldTokens[x-1]});x--;y--;}
    if(d===0)break;
    if(x===prevX){parts.push({kind:'add',text:newTokens[y-1]});y--;}
    else {parts.push({kind:'remove',text:oldTokens[x-1]});x--;}
  }
  return parts.reverse();
}
export function diffText(previous,current,{maxWork=250000,maxDistance=400}={}) {
  if(previous.length+current.length>600000)throw new Error('comparison_too_large');
  const before=wordTokens(previous),after=wordTokens(current);
  let start=0,end=0;
  while(start<before.length&&start<after.length&&before[start]===after[start])start++;
  while(end<before.length-start&&end<after.length-start&&before[before.length-end-1]===after[after.length-end-1])end++;
  const a=before.slice(start,before.length-end),b=after.slice(start,after.length-end),prefix=before.slice(0,start).join(''),suffix=end?before.slice(before.length-end).join(''):'';
  let middle,coarse=false;
  if(!a.length)middle=[{kind:'add',text:b.join('')}];
  else if(!b.length)middle=[{kind:'remove',text:a.join('')}];
  else {
    const v=new Map([[1,0]]),trace=[];let work=0;
    outer:for(let d=0;d<=Math.min(a.length+b.length,maxDistance);d++){
      trace.push(new Map(v));
      for(let k=-d;k<=d;k+=2){
        if(++work>maxWork)break outer;
        let x=k===-d||(k!==d&&(v.get(k-1)??-Infinity)<(v.get(k+1)??-Infinity))?(v.get(k+1)??0):(v.get(k-1)??0)+1,y=x-k;
        while(x<a.length&&y<b.length&&a[x]===b[y]){x++;y++;if(++work>maxWork)break outer;}
        v.set(k,x);
        if(x>=a.length&&y>=b.length){middle=backtrack(trace,a,b);break outer;}
      }
    }
    if(!middle){coarse=true;middle=[{kind:'remove',text:a.join('')},{kind:'add',text:b.join('')}];}
  }
  const parts=merge([{kind:'equal',text:prefix},...middle,{kind:'equal',text:suffix}]);
  return {parts,coarse,previousCount:characterCount(previous),currentCount:characterCount(current),addedCount:characterCount(parts.filter(p=>p.kind==='add').map(p=>p.text).join('')),removedCount:characterCount(parts.filter(p=>p.kind==='remove').map(p=>p.text).join(''))};
}
