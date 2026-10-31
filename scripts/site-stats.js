/* global hexo */
'use strict';

const cheerio = require('cheerio');

// Count the published body, excluding duplicated excerpts, hidden math markup,
// and generated line numbers. This value is identical on every site page.
hexo.extend.helper.register('site_word_count', function() {
  let total = 0;
  this.site.posts.forEach(post => {
    const $ = cheerio.load(post.more || post.content || '', {}, false);
    $('script, style, .gutter, .katex-mathml').remove();
    total += Array.from($.root().text().replace(/\s/gu, '')).length;
  });
  return total;
});
