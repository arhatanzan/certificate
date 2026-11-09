const configurationUrl = new URL('config.js', document.baseURI);

import(/* @vite-ignore */ configurationUrl.href)
  .then(() => import('./app.js'))
  .catch(() => {
    const app = document.querySelector('#app');
    app.className = 'narrow-page';
    app.textContent = 'The application could not load. Please refresh or contact the organizer.';
  });