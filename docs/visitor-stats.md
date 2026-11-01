# Visitor statistics

The site loads the official VerCount client at `https://events.vercount.one/js`.
It replaces the original Busuanzi JSONP service, whose data endpoint repeatedly
failed during online verification. The existing Busuanzi-compatible IDs remain
in the footer; one controller mirrors those values into the desktop floating
panel without creating another request. Phones display the footer counters.

## Counting and storage

- `site_pv`: site page views counted by the service.
- `site_uv`: browsers under VerCount's cookie deduplication rules, not a precise
  count of distinct people. Clearing cookies or using another browser can create
  a new visitor.

The official client sends a POST to `https://events.vercount.one/api/v2/log`,
including the page URL and its new-visitor flag. It uses a first-party cookie for
UV deduplication and may cache the latest server response in browser storage.
The local controller never increments, fabricates, or manually seeds totals.

VerCount supports migration from Busuanzi, but historical totals cannot be
promised when the old service is unreachable. Do not use the former local-only
visitor counter as historical site data.

## Loading and validation

Only `https://greeopia.github.io` loads the remote client. Local previews show
`本地预览` without counting visits. A six-second display timeout provides a clear
unavailable state; a late valid result can still replace it. The controller loads
one provider client and never falls back to a second counting service or retries
automatically. This prevents duplicate page-view requests.

`source/_data/head.njk` styles the compact desktop floating panel and responsive
footer. The loader URL includes a version query so browsers discard the previous
Busuanzi-specific controller after this migration.

Run `node --test tools/tests/visitor-stats.test.js` for offline tests covering
success, mirrored values, failures, local previews, late results, and single
script injection. Deployment verification must also confirm real numbers arrive
in the browser; passing mocked tests alone is insufficient.

References: [official project](https://github.com/EvanNotFound/vercount),
[official service](https://vercount.one/),
[official client](https://events.vercount.one/js).
