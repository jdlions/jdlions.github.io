// Explicit allowlist shared by both deployment builds. No public news, mock
// data, Worker source, credentials or D1 files may enter the frontend output.
export const editorialFiles = [
  'cleanlogo.png',
  'assets/css/editorial.css',
  'assets/css/editorial-liquid-glass.css',
  'assets/js/config.js',
  'assets/js/admin/admin-app.js',
  'assets/js/student/student-app.js',
  'assets/js/auth/auth-service.js',
  'assets/js/auth/login-app.js',
  'assets/js/auth/production-auth-service.js',
  'assets/js/auth/route-guard.js',
  'assets/js/services/api-client.js',
  'assets/js/services/production-editorial-service.js',
  'assets/js/services/service-container.js',
  'assets/js/shared/shell.js',
  'assets/js/shared/ui.js'
];
