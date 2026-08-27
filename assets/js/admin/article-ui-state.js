export const createArticleUiState = () => ({
  filters: { issueId: '', articleTypeId: '', studentId: '', status: '' }
});

export function updateArticleFilter(uiState, key, value) {
  uiState.filters[key] = value;
  return false;
}

export function filteredArticles(state, uiState, activeIssueId = '') {
  const issueId = uiState.filters.issueId || activeIssueId;
  const issue = state.issues.find(item => item.id === issueId) || null;
  uiState.filters.issueId = issue?.id || '';
  const rows = issue ? state.articles.filter(article => article.issueId === issue.id) : [];
  return {
    issue,
    rows: rows.filter(article => ['articleTypeId', 'studentId', 'status']
      .every(key => !uiState.filters[key] || article[key] === uiState.filters[key]))
  };
}

export function reconcileArticleSelection(rows, selectedArticleId) {
  if (!selectedArticleId) return null;
  return rows.some(article => article.id === selectedArticleId) ? selectedArticleId : rows[0]?.id || null;
}
