import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createArticleUiState, filteredArticles, reconcileArticleSelection, updateArticleFilter } from '../../assets/js/admin/article-ui-state.js';

const state = {
  issues: [
    { id: 'issue-a', status: 'active' },
    { id: 'issue-b', status: 'draft' }
  ],
  articles: [
    { id: 'a1', issueId: 'issue-a', articleTypeId: 'school', studentId: 's1', status: 'unreviewed' },
    { id: 'a2', issueId: 'issue-a', articleTypeId: 'feature', studentId: 's2', status: 'accepted' },
    { id: 'b1', issueId: 'issue-b', articleTypeId: 'school', studentId: 's1', status: 'accepted' }
  ]
};

test('article filters persist independently of selection and rerenders', () => {
  const ui = createArticleUiState();
  updateArticleFilter(ui, 'articleTypeId', 'feature');
  updateArticleFilter(ui, 'studentId', 's2');
  updateArticleFilter(ui, 'status', 'accepted');
  assert.deepEqual(filteredArticles(state, ui, 'issue-a').rows.map(row => row.id), ['a2']);
  assert.equal(reconcileArticleSelection(filteredArticles(state, ui, 'issue-a').rows, 'a2'), 'a2');
  assert.deepEqual(ui.filters, { issueId: 'issue-a', articleTypeId: 'feature', studentId: 's2', status: 'accepted' });
});

test('selection moves to the first filtered result or null without clearing filters', () => {
  const ui = createArticleUiState();
  updateArticleFilter(ui, 'status', 'accepted');
  const rows = filteredArticles(state, ui, 'issue-a').rows;
  assert.equal(reconcileArticleSelection(rows, 'a1'), 'a2');
  updateArticleFilter(ui, 'studentId', 'missing');
  const emptyRows = filteredArticles(state, ui, 'issue-a').rows;
  assert.equal(reconcileArticleSelection(emptyRows, 'a2'), null);
  assert.equal(ui.filters.status, 'accepted');
  assert.equal(ui.filters.studentId, 'missing');
});

test('changing Issue keeps the other filters intact and lets selection reconciliation choose the next row', () => {
  const ui = createArticleUiState();
  updateArticleFilter(ui, 'status', 'accepted');
  updateArticleFilter(ui, 'issueId', 'issue-b');
  updateArticleFilter(ui, 'studentId', 's1');
  assert.deepEqual(filteredArticles(state, ui, 'issue-a').rows.map(row => row.id), ['b1']);
  assert.equal(ui.filters.status, 'accepted');
});

test('admin rendering keeps filter values and every article rerender uses persistent state', async () => {
  const source = await readFile(new URL('../../assets/js/admin/admin-app.js', import.meta.url), 'utf8');
  assert.match(source, /const articleUiState=createArticleUiState\(\)/);
  assert.match(source, /selectedOption\(t\.id,f\.articleTypeId\)/);
  assert.match(source, /selectedOption\(x\.id,f\.studentId\)/);
  assert.match(source, /selectedOption\(x,f\.status\)/);
  assert.doesNotMatch(source, /renderArticles\(filters/);
  assert.doesNotMatch(source, /selectArticle\(id,filters/);
});

test('save, status, previous-next, lazy-load, and retry paths do not carry disposable filter arguments', async () => {
  const source = await readFile(new URL('../../assets/js/admin/admin-app.js', import.meta.url), 'utf8');
  assert.match(source, /\[data-save\][^;]*onclick=.*renderArticles\(\)/);
  assert.match(source, /\[data-status\][\s\S]*updateArticleStatus[\s\S]*renderArticles\(\)/);
  assert.match(source, /\[data-prev\][\s\S]*selectArticle\(rows\[idx-1\]\)/);
  assert.match(source, /\[data-next\][\s\S]*selectArticle\(rows\[idx\+1\]\)/);
  assert.match(source, /getArticleDetail\(id\);renderArticles\(\);try\{await pending;\}catch\{\}renderArticles\(\)/);
  assert.match(source, /data-retry-article[\s\S]*selectArticle\(button\.dataset\.selectArticle\|\|button\.dataset\.retryArticle\)/);
});

test('submission list has a bounded scroll region above mobile and page flow on mobile', async () => {
  const css = await readFile(new URL('../../assets/css/editorial.css', import.meta.url), 'utf8');
  assert.match(css, /\.submission-list\{max-height:calc\(100vh - 260px\);[^}]*overflow-y:auto/);
  assert.match(css, /@media\(max-width:1050px\) and \(min-width:761px\)\{\.submission-list\{max-height:min\(42vh,520px\)/);
  assert.match(css, /@media\(max-width:760px\)\{\.management-layout\{display:block\}\.submission-list\{max-height:none;overflow:visible/);
});
