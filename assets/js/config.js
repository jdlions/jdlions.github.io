const params = new URLSearchParams(location.search);
if (params.get('editorialMode') === 'production') localStorage.setItem('lions-pride-editorial-mode', 'production');
if (params.get('editorialMode') === 'mock') localStorage.setItem('lions-pride-editorial-mode', 'mock');

export const editorialConfig = Object.freeze({
  mode: localStorage.getItem('lions-pride-editorial-mode') || 'mock',
  apiBaseUrl: 'https://lions-pride-editorial-api.editor-936.workers.dev'
});

