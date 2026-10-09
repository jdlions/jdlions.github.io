import {compareStudents,schoolNumber} from '../shared/student-identity.js';
import {statusBadge} from './student-overview.js';

// Deliberate allowlist: no article title/body, feedback, IDs, email or photos.
export function exportRows(data){return [...data.students].sort(compareStudents).map(s=>{
 let displayName=String(s.name||'');
 if(displayName===s.studentId)displayName='';
 else if(String(s.studentId).length>=8)displayName=displayName.replaceAll(String(s.studentId),'');
 displayName=displayName.replace(/[^\s<>]+@[^\s<>]+\.[^\s<>]+/g,'').replace(/\b\d{12,}\b/g,'').trim();
 const number=schoolNumber({name:displayName}),name=displayName.replace(number,'').trim()||'이름 확인 불가';
 const states=type=>{const rows=data.items.filter(a=>a.studentId===s.studentId&&a.articleType===type);return rows.length?rows.map(a=>({status:a.status,matches:a.matches!==false})):[{status:'missing',matches:true}];};
 return {number,name,school:states('school'),feature:states('feature')};});}
export function pngFilename(title,date){const clean=String(title).normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f]/g,'-').replace(/\s+/g,'-').replace(/[. ]+$/g,'').slice(0,70)||'전체';const p=n=>String(n).padStart(2,'0');return `PrideDesk_기사현황_${clean}_${date.getFullYear()}-${p(date.getMonth()+1)}-${p(date.getDate())}_${p(date.getHours())}${p(date.getMinutes())}.png`;}
export async function createQueuePng(data,filters={},date=new Date()){
 const rows=exportRows(data);if(!rows.length)throw new Error('현재 조건에 해당하는 학생이 없습니다.');
 // Canvas does not inherit the page CSS font. Load and verify the exact face
 // before measuring text or drawing; never export a silent system-font fallback.
 const fontError=()=>new Error('Pretendard 폰트를 불러오지 못했습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.');
 let fontTimer;
 try{
  const faces=await Promise.race([document.fonts.load('400 16px "Pretendard Variable"','기사 제출 현황 학번 이름 학교기사 피처기사'),new Promise((_,reject)=>{fontTimer=setTimeout(()=>reject(fontError()),30000);})]);
  if(!faces.some(face=>face.status==='loaded'&&face.family.replaceAll('"','')==='Pretendard Variable')||!document.fonts.check('400 16px "Pretendard Variable"'))throw fontError();
 }catch{throw fontError();}finally{clearTimeout(fontTimer);}
 const image=new Image();image.src=new URL('../../images/pridedesk-logo-dark-gold-2x.webp',import.meta.url).href;await image.decode();
 const palette=new Map();for(const state of new Set(rows.flatMap(r=>[...r.school,...r.feature].map(x=>x.status)))){
  const host=document.createElement('span');host.innerHTML=statusBadge(state);document.body.append(host);const badge=host.firstChild,style=getComputedStyle(badge);palette.set(state,{text:badge.textContent,color:style.color,background:style.backgroundColor});host.remove();
 }
 const canvas=document.createElement('canvas');canvas.width=1200;const ctx=canvas.getContext('2d');
 const font=size=>`400 ${size}px "Pretendard Variable"`;
 const wrap=(text,width,size)=>{ctx.font=font(size);const lines=[];let line='';for(const char of String(text)){if(line&&ctx.measureText(line+char).width>width){lines.push(line);line='';}line+=char;}lines.push(line);return lines;};
 const title=filters.campaign==='free'?'자유 기사':data.campaigns?.find(c=>c.id===filters.campaign)?.name||'전체 과제';
 const titleLines=wrap(title,1090,30);
 const filterText=Object.entries(filters).filter(([,v])=>v).map(([k,v])=>({grade:`${v}학년`,q:'검색 조건 적용',author:'학생 필터 적용',date:`제출일: ${v}`,type:`유형: ${{school:'학교기사',feature:'피처기사'}[v]||v}`,status:`상태: ${palette.get(v)?.text||v}`,campaign:''}[k]||'')).filter(Boolean).join(' · ');
 const filterLines=filterText?wrap(filterText,1090,20):[];
 const prepared=rows.map(row=>({...row,nameLines:wrap(row.name,280,25),height:Math.max(84,wrap(row.name,280,25).length*34+24,Math.max(row.school.length,row.feature.length)*40+24)}));
 const header=245+titleLines.length*40+filterLines.length*28;
 const height=header+60+prepared.reduce((n,r)=>n+r.height,0)+90;if(height>30000)throw new Error('출력할 학생이 너무 많습니다. 과제나 학년 필터를 선택해 주세요.');canvas.height=height;
 ctx.fillStyle='#0c0d18';ctx.fillRect(0,0,1200,height);ctx.drawImage(image,55,40,300,300*image.height/image.width);
 const text=(value,x,y,size=25,color='#f4f1e9')=>{ctx.fillStyle=color;ctx.font=font(size);ctx.fillText(value,x,y);};
 text('기사 제출 현황',55,170,42,'#e2c66f');let y=220;for(const line of titleLines){text(line,55,y,30);y+=40;}
 text(`${date.getFullYear()}. ${date.getMonth()+1}. ${date.getDate()}. ${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')} 기준 · ${rows.length}명`,55,y,22,'#aaa59c');y+=35;for(const line of filterLines){text(line,55,y,20,'#aaa59c');y+=28;}
 y=header;ctx.fillStyle='#252329';ctx.fillRect(45,y,1110,60);['학번','이름','학교기사','피처기사'].forEach((v,i)=>text(v,[65,210,520,830][i],y+40,25,'#e2c66f'));y+=60;
 for(const [index,row] of prepared.entries()){
  ctx.fillStyle=index%2?'#17171f':'#11131d';ctx.fillRect(45,y,1110,row.height);text(row.number||'—',65,y+43);row.nameLines.forEach((line,i)=>text(line,210,y+43+i*34));
  for(const [key,x] of [['school',520],['feature',830]])row[key].forEach((state,i)=>{const p=palette.get(state.status);ctx.globalAlpha=state.matches?1:0.65;ctx.fillStyle=p.background;ctx.fillRect(x-8,y+14+i*40,290,34);text(p.text+(state.matches?'':' · 조건 외'),x,y+40+i*40,22,p.color);ctx.globalAlpha=1;});
  y+=row.height;
 }
 text("The Lion's Pride · Joongdong High School",55,height-35,20,'#aaa59c');
 const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw new Error('이미지를 생성하지 못했습니다. 다시 시도해 주세요.');
 return {blob,filename:pngFilename(title,date),width:1200,height,rows};
}
export async function downloadQueuePng(data,filters){const result=await createQueuePng(data,filters);const url=URL.createObjectURL(result.blob),a=document.createElement('a');a.href=url;a.download=result.filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return result;}
