// Keep old stored HTML readable without changing production records. Formatting
// authored with PrideDesk's toolbar remains; external attributes never render.
const tags=new Set(['p','br','div','strong','b','em','i','u','s','h1','h2','h3','h4','h5','h6','ul','ol','li','blockquote','pre','code','a','span']);
export function readableEditorHtml(html){
  const template=document.createElement('template');template.innerHTML=html||'';
  template.content.querySelectorAll('script,style,iframe,object,embed,svg,math').forEach(el=>el.remove());
  for(const el of template.content.querySelectorAll('*')){
    const href=el.tagName==='A'?el.getAttribute('href'):null;
    for(const attr of [...el.attributes])el.removeAttribute(attr.name);
    if(href){try{const url=new URL(href);if(['https:','http:','mailto:'].includes(url.protocol))el.setAttribute('href',url.href);}catch{}}
    if(!tags.has(el.tagName.toLowerCase()))el.replaceWith(...el.childNodes);
  }
  return template.innerHTML;
}
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
      if(previous&&(blocks.has(previous.nodeName)||blocks.has(child.nodeName)))result+='\n';
      result+=text(child);previous=child;
    }
    return result;
  };
  return text(editor).replace(/\r\n?/g,'\n');
}
const segmenter=typeof Intl.Segmenter==='function'?new Intl.Segmenter('ko',{granularity:'grapheme'}):null;
export function editorHtml(editor){
  // Enter in an initially empty Chromium editor creates DIVs. D1's existing
  // sanitizer permits P instead: retain these paragraph boundaries on save.
  const template=document.createElement('template');template.innerHTML=editor.innerHTML;
  for(const div of template.content.querySelectorAll('div')){
    const paragraph=document.createElement('p');paragraph.append(...div.childNodes);div.replaceWith(paragraph);
  }
  return template.innerHTML;
}
export function characterCount(text){
  if(!segmenter)return Array.from(text).length;
  let count=0;for(const _ of segmenter.segment(text))count++;return count;
}
export function bindPlainTextPaste(editor){
  editor.addEventListener('paste',event=>{
    if(editor.contentEditable!=='true'||!event.clipboardData)return;
    event.preventDefault();
    const text=event.clipboardData.getData('text/plain').replace(/\r\n?/g,'\n');
    // Only escaped clipboard text enters HTML. BR is preserved by the existing
    // server sanitizer (Chromium insertText may create unsupported DIV blocks).
    const html=text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
    document.execCommand('insertHTML',false,html);
    editor.dispatchEvent(new Event('input',{bubbles:true}));
  });
}
