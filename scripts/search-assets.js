/* global hexo */
'use strict';

const fs = require('node:fs');

// Serve the browser runtime from the installed plugin, alongside the index.
hexo.extend.generator.register('search-assets', function() {
  if (!this.theme.config.local_search?.enable) return [];

  return {
    path: 'assets/search/search.js',
    data: () => fs.createReadStream(require.resolve('hexo-generator-searchdb/dist/search.js'))
  };
});
