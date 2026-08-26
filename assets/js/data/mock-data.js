export const STORAGE_KEY = 'lions-pride-editorial-v1';

export const seedState = {
  courses: [
    { id: 'course-demo-2026', name: 'Editorial Workshop 2026', state: 'ACTIVE' },
    { id: 'course-demo-2027', name: 'Newspaper Studio 2027', state: 'ACTIVE' }
  ],
  courseWork: [
    { id: 'work-26-feature', courseId: 'course-demo-2026', title: 'Long-form reporting draft', dueDate: '2026-08-10' },
    { id: 'work-26-school', courseId: 'course-demo-2026', title: 'Campus reporting draft', dueDate: '2026-11-25' },
    { id: 'work-26-topic', courseId: 'course-demo-2026', title: 'Pitch and source plan', dueDate: '2026-06-12' },
    { id: 'work-26-photo', courseId: 'course-demo-2026', title: 'Visual reference dropbox', dueDate: '2026-11-28' },
    { id: 'work-27-a', courseId: 'course-demo-2027', title: 'First reporting submission', dueDate: '2027-05-10' },
    { id: 'work-27-b', courseId: 'course-demo-2027', title: 'Second reporting submission', dueDate: '2027-05-24' }
  ],
  issues: [
    { id: 'issue-2026-winter', name: '2026 Winter', year: 2026, season: 'Winter', status: 'active', classroomCourseId: 'course-demo-2026', articleTypes: [
      { id: 'feature', label: 'Feature Article', courseWorkId: 'work-26-feature' },
      { id: 'school', label: 'School Article', courseWorkId: 'work-26-school' }
    ], createdAt: '2026-03-14T09:00:00Z' }
  ],
  students: [
    { id: 'student-demo', name: 'Alex Park' },
    { id: 'student-2', name: 'Jordan Kim' },
    { id: 'student-3', name: 'Min Lee' },
    { id: 'student-4', name: 'Taylor Choi' },
    { id: 'student-5', name: 'Robin Han' }
  ],
  articles: [
    { id:'article-1', issueId:'issue-2026-winter', studentId:'student-demo', articleTypeId:'feature', courseWorkId:'work-26-feature', submittedAt:'2026-08-13T08:20:00Z', status:'accepted', title:'The Quiet Work Behind a Greener Campus', originalContent:`<h2>The Quiet Work Behind a Greener Campus</h2><p>Before the first bell rings, a small team is already moving through the school grounds. They sort reusable materials, check collection points, and record which habits are changing.</p><p>The project began as a simple question: could students make sustainability part of an ordinary school day? Interviews with volunteers suggest that visible, repeatable actions matter more than one large campaign.</p><p>The group now hopes to publish a guide that other classes can adapt. Their work is modest, but its consistency has made environmental responsibility easier to notice.</p>`, editedContent:`<h2>The Quiet Work Behind a Greener Campus</h2><p>Before the first bell, a small team is already moving through the school grounds—sorting reusable materials, checking collection points, and recording which habits are changing.</p><p>The project began with a simple question: Can sustainability become part of an ordinary school day? Volunteers say visible, repeatable actions matter more than a single large campaign.</p><p>The group now hopes to publish a guide other classes can adapt. The work is modest, but its consistency makes environmental responsibility impossible to miss.</p>`, editorNote:'Strong structure. Confirm the final quotation with the source.', noteVisibility:'internal', updatedAt:'2026-08-20T11:30:00Z' },
    { id:'article-2', issueId:'issue-2026-winter', studentId:'student-demo', articleTypeId:'school', courseWorkId:'work-26-school', submittedAt:'2026-11-30T06:10:00Z', status:'reviewing', title:'A New Space for Student Ideas', originalContent:`<h2>A New Space for Student Ideas</h2><p>A formerly unused classroom has reopened as a shared project room. Students can reserve tables for interviews, club planning, and small exhibitions.</p><p>During its first week, the room hosted a debate rehearsal and a display of science models. Organizers say the schedule will remain flexible while they learn what students need.</p>`, editedContent:'', editorNote:'Add one student voice before acceptance.', noteVisibility:'internal', updatedAt:'2026-12-01T08:00:00Z' },
    { id:'article-3', issueId:'issue-2026-winter', studentId:'student-2', articleTypeId:'feature', courseWorkId:'work-26-feature', submittedAt:'2026-08-14T09:00:00Z', status:'unreviewed', title:'Why We Still Read in Print', originalContent:`<h2>Why We Still Read in Print</h2><p>Printed pages ask readers to slow down. In a survey conducted for this article, students described fewer distractions and a stronger sense of completion.</p>`, editedContent:'', editorNote:'', noteVisibility:'internal', updatedAt:'2026-08-14T09:00:00Z' },
    { id:'article-4', issueId:'issue-2026-winter', studentId:'student-2', articleTypeId:'school', courseWorkId:'work-26-school', submittedAt:'2026-11-29T05:20:00Z', status:'hold', title:'The Library After Five', originalContent:`<h2>The Library After Five</h2><p>When regular classes end, the library changes character. Study groups form, quiet corners fill, and student librarians begin their final checks.</p>`, editedContent:'', editorNote:'Need a second interview.', noteVisibility:'internal', updatedAt:'2026-12-02T04:00:00Z' },
    { id:'article-5', issueId:'issue-2026-winter', studentId:'student-3', articleTypeId:'school', courseWorkId:'work-26-school', submittedAt:'2026-11-28T03:45:00Z', status:'rejected', title:'Festival Notes', originalContent:`<h2>Festival Notes</h2><p>The annual festival brought performances and exhibitions together for one crowded afternoon.</p>`, editedContent:'', editorNote:'Resubmit with reporting and attributed sources.', noteVisibility:'student', updatedAt:'2026-11-30T09:30:00Z' },
    { id:'article-6', issueId:'issue-2026-winter', studentId:'student-4', articleTypeId:'feature', courseWorkId:'work-26-feature', submittedAt:'2026-08-15T12:15:00Z', status:'accepted', title:'Learning to Listen', originalContent:`<h2>Learning to Listen</h2><p>Good interviews begin before the first question. Reporters need preparation, patience, and enough silence for an unexpected answer.</p>`, editedContent:`<h2>Learning to Listen</h2><p>Good interviews begin before the first question—with preparation, patience, and enough silence for an unexpected answer.</p>`, editorNote:'Ready for layout.', noteVisibility:'internal', updatedAt:'2026-08-22T02:00:00Z' }
  ],
  photos: [
    { id:'photo-1', issueId:'issue-2026-winter', studentId:'student-demo', articleSubmissionId:'article-1', fileId:'mock-drive-1', filename:'recycling-team.webp', resolution:'2400 × 1600', fileSize:'1.8 MB', caption:'Volunteers prepare collection bins before class.', photographer:'Alex Park', sourceType:'self', status:'approved', createdAt:'2026-08-18T07:30:00Z', color:'#987945' },
    { id:'photo-2', issueId:'issue-2026-winter', studentId:'student-demo', articleSubmissionId:'article-1', fileId:'mock-drive-2', filename:'collection-point.jpg', resolution:'3024 × 4032', fileSize:'2.6 MB', caption:'A newly labeled collection point.', photographer:'Editorial mock source', sourceType:'provided', status:'unreviewed', createdAt:'2026-08-18T07:32:00Z', color:'#3f5960' },
    { id:'photo-3', issueId:'issue-2026-winter', studentId:'student-2', articleSubmissionId:'article-4', fileId:'mock-drive-3', filename:'library-evening.jpg', resolution:'4000 × 2667', fileSize:'3.1 MB', caption:'The library shortly before closing.', photographer:'Jordan Kim', sourceType:'self', status:'hold', createdAt:'2026-11-30T10:15:00Z', color:'#473b31' },
    { id:'photo-4', issueId:'issue-2026-winter', studentId:'student-4', articleSubmissionId:'article-6', fileId:'mock-drive-4', filename:'interview-notes.png', resolution:'1920 × 1080', fileSize:'980 KB', caption:'A reporter reviews interview notes.', photographer:'Taylor Choi', sourceType:'self', status:'unreviewed', createdAt:'2026-08-17T12:00:00Z', color:'#54515f' }
  ],
  publications: []
};
