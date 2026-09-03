// The backend runs as serverless functions on this same site (see /api), so
// API calls are same-origin — no separate host or URL to configure.
window.APP_CONFIG = {
  API_BASE_URL: '/api'
};
