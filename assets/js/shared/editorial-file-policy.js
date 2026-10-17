// Explicit application ceiling, not the upstream Drive limit. Keep chunk/hash
// metadata bounded (at most 10,240 canonical 2 MiB chunks per version).
export const EDITORIAL_CHUNK_BYTES=2*1024*1024;
export const MAX_EDITORIAL_BYTES=20*1024**3;
export function editorialFilename(value){
 if(typeof value!=='string'||!value||value.length>255||value!==value.trim()||/[\uD800-\uDFFF]/u.test(value)||/[\x00-\x1f\x7f-\x9f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069<>:"/\\|?*]/u.test(value)||/[. ]$/.test(value)||['.','..'].includes(value)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value))throw new Error('파일명에 경로·제어 문자 또는 사용할 수 없는 문자가 있습니다. 파일 이름을 변경해 주세요.');
 return value;
}
export function editorialExtension(name){const at=name.lastIndexOf('.');return at>0?name.slice(at+1).toLowerCase():'';}
export function editorialFileSize(bytes){if(bytes>=1024**3)return (bytes/1024**3).toFixed(2)+' GiB';if(bytes>=1024**2)return (bytes/1024**2).toFixed(1)+' MiB';if(bytes>=1024)return (bytes/1024).toFixed(1)+' KiB';return bytes+' B';}
