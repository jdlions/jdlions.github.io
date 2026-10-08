export function editorText(editor){
  // One stored paragraph boundary or BR is one LF. innerText adds two LFs
  // between P elements, so it would count a single Enter differently from paste.
  const blocks=new Set(['P','DIV','H1','H2','H3','H4','H5','H6','LI','UL','OL','BLOCKQUOTE','PRE']);
  const text=node=>{
    if(node.nodeType===3)return node.nodeValue;
    if(node.nodeName==='BR')return '\n';
    if(!node.textContent&&node.childNodes.length===1&&node.firstChild.nodeName==='BR')return '';
    let result='',previous=null;
    for(const child of node.childNodes){
      if(child.nodeType===8)continue;
      if(previous&&(blocks.has(previous.nodeName)||blocks.has(child.nodeName)))result+='\n';
      result+=text(child);previous=child;
    }
    return result;
  };
  return text(editor).replace(/\r\n?/g,'\n');
}
const segmenter=typeof Intl.Segmenter==='function'?new Intl.Segmenter('ko',{granularity:'grapheme'}):null;
export function characterCount(text){
  if(!segmenter)return Array.from(text).length;
  let count=0;for(const _ of segmenter.segment(text))count++;return count;
}
