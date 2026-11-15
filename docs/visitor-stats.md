# Visitor statistics

The site uses VerCount's read-only API and its official counting client at
`https://events.vercount.one/js`.
It replaces the original Busuanzi JSONP service, whose data endpoint repeatedly
failed during online verification. The existing Busuanzi-compatible IDs remain
in the footer; one controller mirrors those values into the desktop floating
panel without creating another request. Phones display the footer counters.

## Counting and storage

- `site_pv`: existing service total plus one report whenever the homepage or a
  published post is opened or refreshed. The existing total is not rescaled.
- `site_uv`: browsers under VerCount's cookie deduplication rules, not a precise
  count of distinct people. Clearing cookies or using another browser can create
  a new visitor.

The theme marks the first homepage and actual post templates with
`data-counter-count-page="true"`. These pages load the official client, which
sends one POST to `https://events.vercount.one/api/v2/log`. Archives, tags,
categories, later index pages and other pages use a read-only GET to
`https://events.vercount.one/api/v2/log?url=<encoded-page-url>` instead. They
continue displaying the latest totals without adding page views. This relies
on Hexo's page type, so a URL that merely starts with a date is not sufficient.
Search input, theme switching and other actions within a page do not count.
The previous alternating localStorage phase is no longer used.

The official client includes the page URL and its new-visitor flag, using a
first-party cookie for UV deduplication. A visitor is recorded on their first
homepage or post visit, including a single-page visit. Visitors who only open
archives, tags or other excluded pages are not recorded. The local controller
never increments, fabricates, halves or manually seeds totals, and page
eligibility does not depend on browser storage.

VerCount supports migration from Busuanzi, but historical totals cannot be
promised when the old service is unreachable. Do not use the former local-only
visitor counter as historical site data.

## Loading and validation

Only `https://greeopia.github.io` loads the remote client. Local previews show
`本地预览` without counting visits. Other hosts and offline page opens do not
contact the service either. A six-second display timeout provides a clear
unavailable state; a late valid result can still replace it. The controller loads
at most one counting client or one read-only request per page, and never falls
back to a counting request when a read fails or retries automatically. This
prevents duplicate page-view reports. Failed counting requests are not retried,
since retrying an uncertain result could count twice.

`source/_data/head.njk` styles the compact desktop floating panel and responsive
footer. The loader URL includes a version query so browsers discard the previous
controller after a behavior change (`vercount-3` for homepage/post eligibility).

Run `node --test tools/tests/visitor-stats.test.js` for offline tests covering
page eligibility, repeated initialization, blocked storage, success, mirrored
values, failures, local previews, late results, and single script injection.
Deployment verification must also confirm real numbers arrive
in the browser; passing mocked tests alone is insufficient.

References: [official project](https://github.com/EvanNotFound/vercount),
[official service](https://vercount.one/),
[official client](https://events.vercount.one/js),
[read-only GET handler](https://github.com/evannotfound/vercount/blob/main/apps/api/internal/api/log.go).
