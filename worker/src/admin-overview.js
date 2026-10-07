// Read-only projections: no article bodies, Drive IDs, roster calls or per-student queries.
const rows=async(db,query,args=[]) => (await db.prepare(query).bind(...args).all()).results;
export async function articleStudentOverview(db,roster=[]){
  const scope=await rows(db,`WITH scope AS (
    SELECT i.student_id,r.student_name,i.article_id,i.campaign_id,s.article_type
    FROM assignment_slot_instances i JOIN assignment_slots s ON s.id=i.slot_id
    JOIN assignment_recipients r ON r.campaign_id=i.campaign_id AND r.student_id=i.student_id
    UNION ALL SELECT a.student_id,a.student_id,a.id,NULL,a.article_type FROM articles a
    WHERE NOT EXISTS(SELECT 1 FROM assignment_slot_instances i WHERE i.article_id=a.id)
  ) SELECT x.student_id studentId,x.student_name studentName,x.campaign_id campaignId,c.name assignmentName,
    x.article_type articleType,a.id,a.title_ko titleKo,a.title_en titleEn,a.status,a.updated_at updatedAt,a.submitted_at submittedAt
    FROM scope x LEFT JOIN articles a ON a.id=x.article_id LEFT JOIN assignment_campaigns c ON c.id=x.campaign_id`);
  const students=new Map(roster.map(s=>[s.id,{studentId:s.id,name:s.name||s.id}])),items=[],campaigns=new Map(),seen=new Set();
  for(const row of scope){
    if(!students.has(row.studentId))students.set(row.studentId,{studentId:row.studentId,name:row.studentName||row.studentId});
    if(row.campaignId)campaigns.set(row.campaignId,{id:row.campaignId,name:row.assignmentName});
    if(row.id&&!seen.has(row.id)){seen.add(row.id);const {studentName,...item}=row;items.push({...item,authorName:students.get(row.studentId).name});}
  }
  return {students:[...students.values()],items,campaigns:[...campaigns.values()]};
}
export async function dashboardSummary(db){
  const campaignQuery=async()=>{
    const campaign=await db.prepare("SELECT id,name,year,issue_label issueLabel FROM assignment_campaigns WHERE status='active' AND (starts_at IS NULL OR starts_at<=?) ORDER BY COALESCE(starts_at,created_at) DESC,created_at DESC,id DESC LIMIT 1").bind(new Date().toISOString()).first();
    if(!campaign)return {campaign:null,progress:[]};
    const progress=await rows(db,`SELECT s.article_type articleType,COUNT(*) total,
      SUM(CASE WHEN a.status IN ('submitted','reviewing','revision_requested','hold','approved','scheduled') THEN 1 ELSE 0 END) submitted,
      SUM(CASE WHEN EXISTS(SELECT 1 FROM photos p WHERE p.article_id=a.id) THEN 1 ELSE 0 END) withPhotos
      FROM assignment_slot_instances i JOIN assignment_slots s ON s.id=i.slot_id LEFT JOIN articles a ON a.id=i.article_id
      WHERE i.campaign_id=? GROUP BY s.article_type`,[campaign.id]);
    return {campaign,progress};
  };
  const editorialQuery=()=>db.prepare(`SELECT p.year,p.season,v.version,v.editor_name editorName FROM editorial_projects p
    JOIN editorial_versions v ON v.project_id=p.id AND v.version=p.latest_version AND v.state='complete' AND v.state!='cancelled'
    ORDER BY p.year DESC,CASE p.season WHEN 'Winter' THEN 1 ELSE 0 END DESC,p.id DESC LIMIT 1`).first();
  const [assignment,editorial]=await Promise.allSettled([campaignQuery(),editorialQuery()]);
  return {assignment:assignment.status==='fulfilled'?assignment.value:null,editorial:editorial.status==='fulfilled'?editorial.value:null,
    errors:{...(assignment.status==='rejected'?{assignment:'과제 요약을 불러오지 못했습니다.'}:{}),...(editorial.status==='rejected'?{editorial:'편집 파일 요약을 불러오지 못했습니다.'}:{})}};
}
export async function photoStudentSummary(db){
  return rows(db,`WITH scope AS (
    SELECT i.student_id,i.article_id,s.article_type,i.campaign_id,r.student_name
    FROM assignment_slot_instances i JOIN assignment_slots s ON s.id=i.slot_id
    JOIN assignment_recipients r ON r.campaign_id=i.campaign_id AND r.student_id=i.student_id
    UNION ALL SELECT a.student_id,a.id,a.article_type,NULL,a.student_id FROM articles a
      WHERE NOT EXISTS(SELECT 1 FROM assignment_slot_instances i WHERE i.article_id=a.id)
  ) SELECT x.student_id studentId,MAX(x.student_name) studentName,x.article_type articleType,x.campaign_id campaignId,
    c.name campaignName,COUNT(p.id) photoCount,
    SUM(CASE WHEN p.status='unreviewed' THEN 1 ELSE 0 END) unreviewed,
    SUM(CASE WHEN p.status='approved' THEN 1 ELSE 0 END) approved,
    SUM(CASE WHEN p.status='hold' THEN 1 ELSE 0 END) hold,
    SUM(CASE WHEN p.status='rejected' THEN 1 ELSE 0 END) rejected
    FROM scope x LEFT JOIN photos p ON p.article_id=x.article_id LEFT JOIN assignment_campaigns c ON c.id=x.campaign_id
    GROUP BY x.student_id,x.article_type,x.campaign_id ORDER BY studentName,x.student_id,x.article_type`);
}
export async function studentPhotos(db,studentId){
  if(!studentId||studentId.length>200)throw Object.assign(new Error('Invalid student.'),{status:400,code:'invalid_student'});
  return rows(db,`SELECT p.*,a.article_type articleType,c.name campaignName FROM photos p JOIN articles a ON a.id=p.article_id
    LEFT JOIN assignment_slot_instances i ON i.article_id=a.id LEFT JOIN assignment_campaigns c ON c.id=i.campaign_id
    WHERE a.student_id=? ORDER BY p.created_at DESC,p.id DESC`,[studentId]);
}
