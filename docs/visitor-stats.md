# Visitor statistics

The site uses Busuanzi's official `busuanzi.pure.mini.js` service. The official
documentation defines:

- `site_pv`: total site page views. A visitor reading multiple pages creates
  multiple views.
- `site_uv`: unique site visitors. One visitor reading multiple pages during the
  same browsing session creates one visitor.

The footer is the single visible source for both values, so the same statistics
remain visible on desktop and mobile.

`source/js/visitor-stats.js` loads the official script once, observes its
standard output nodes, and marks the statistics as `暂不可用` when the browser is
offline, the script fails, or data does not arrive within six seconds. It never
stores a synthetic site total in browser storage and never retries the service
automatically.

Only `https://greeopia.github.io` may contact the statistics service. Loopback
preview hosts show `本地预览`, and other non-production hosts show `暂不可用`;
neither path creates a Busuanzi request.

Official references:

- https://ibruce.info/2015/04/04/busuanzi/
- https://busuanzi.ibruce.info/

The footer styles in `source/_data/head.njk` wrap the counters on narrow screens
and provide matching colors for light and dark mode.
