export const editorialConfig = Object.freeze({
  mode: 'production',
  apiBaseUrl: '',
  origin: 'https://lions-pride-editorial-api.editor-936.workers.dev'
});

export function editorialUrl(path) {
  return `${location.hostname === 'jdlions.github.io' ? editorialConfig.origin : ''}${path}`;
}

