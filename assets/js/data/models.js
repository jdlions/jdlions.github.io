/** @typedef {'public'|'student'|'admin'} UserRole */
/** @typedef {'draft'|'active'|'archived'|'published'} IssueStatus */
/** @typedef {'unreviewed'|'reviewing'|'accepted'|'hold'|'rejected'|'edited'} ArticleStatus */
/**
 * Issue.articleTypes is deliberately extensible. Each mapping stores the stable
 * Classroom courseWorkId selected by an editor; assignment titles are display data only.
 */
export const ARTICLE_STATUSES = ['unreviewed', 'reviewing', 'accepted', 'hold', 'rejected'];
export const PHOTO_STATUSES = ['unreviewed', 'approved', 'hold', 'rejected'];
export const SOURCE_TYPES = [
  { id: 'self', label: 'Taken by me' },
  { id: 'provided', label: 'Provided by another person' },
  { id: 'other', label: 'Other' }
];
