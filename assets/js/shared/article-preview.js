export function draftSummary(html){
  const text=String(html||'').replace(/<[^>]*>/g,'').replace(/&(?:amp|lt|gt|quot|apos|nbsp|#\d+|#x[\da-f]+);/gi,value=>{const name=value.slice(1,-1);if(name[0]==='#'){const point=name[1].toLowerCase()==='x'?parseInt(name.slice(2),16):parseInt(name.slice(1),10);return point<=0x10ffff?String.fromCodePoint(point):'�';}return {amp:'&',lt:'<',gt:'>',quot:'\"',apos:"'",nbsp:' '}[name.toLowerCase()];});
  return {draftPreview:text.slice(0,130),wordCount:text.trim().split(/\s+/).filter(Boolean).length};
}
