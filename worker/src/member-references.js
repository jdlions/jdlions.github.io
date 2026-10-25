// Identity-bearing columns in the current schema. Unknown additions fail closed.
export const identityReferences = {
  issue_publications:['published_by'],article_edits:['student_google_id','updated_by_google_id'],articles:['student_id'],article_revisions:['author_user_id'],article_feedback:['updated_by_user_id'],photos:['student_google_id'],
  assignment_campaigns:['created_by_user_id'],assignment_recipients:['student_id'],assignment_targets:['student_id'],assignment_slot_instances:['student_id'],
  editorial_edit_sessions:['user_id'],editorial_versions:['user_id'],editorial_locks:['user_id'],editorial_lock_audit:['actor_user_id'],assignment_length_reviews:['actor_id'],member_assignment_targets:['member_id'],member_signup_code:['updated_by']
};
