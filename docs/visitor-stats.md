# Visitor statistics

The site uses the official Busuanzi service:

- `site_pv`: total page views across the site.
- `site_uv`: visitors under the service's deduplication rules. Consecutive page
  views from one visitor count once; this is not a guaranteed lifetime count of
  distinct people.

Both counters appear in the footer on desktop and mobile. Their responsive
styles and light/dark colors are in `source/_data/head.njk`.

## Loading and failure behavior

`source/js/visitor-stats.js` loads the official script once. Only
`https://greeopia.github.io` contacts the service. Local previews display
`本地预览`; other hosts display `暂不可用` without sending requests.

Offline, blocked, failed, or slow requests display `暂不可用` after at most six
seconds. The original request can still supply a late result: when all counter
nodes contain numbers, the controller displays them and stops observing.
Partial values and placeholders never count as success. A zero returned by the
service is valid. No browser storage, synthetic fallback total, or automatic
retry is used.

On 2026-11-01, the official static script returned HTTP 200, while one counting
API probe with the site's Referer returned HTTP 502 on the tested network path.
Browser verification also observed a pending JSONP request. These results do not
establish a global outage. Keep the explicit fallback while the service or
network is unavailable; changing the frontend cannot reconstruct missed visits.

## Validation and references

Run `node --test tools/tests/visitor-stats.test.js` for offline regression checks
covering successful output, local previews, failure, timeouts, late results,
partial/invalid values, and single script injection. Tests do not call the live
counting service.

The official installation article and script still use `busuanzi.ibruce.info`:

- [Official installation article](https://ibruce.info/2015/04/04/busuanzi/)
- [Official service](https://busuanzi.ibruce.info/)
- [Official script](https://busuanzi.ibruce.info/busuanzi/2.3/busuanzi.pure.mini.js)
