# Repository Guidelines

## Project Structure

Hexo static blog powered by the NexT theme.

- `source/_posts/` — blog posts (Markdown, named `YYYY-MM-DD-title.md`)
- `source/images/` — site assets (hero backgrounds, post images)
- `source/_data/` — custom overrides: `head.njk`, `body-end.njk`, `styles.styl`
- `themes/hexo-theme-next-master/` — vendored NexT theme (edit carefully; theme config in `_config.yml`)
- `tools/sync-posts.js` — syncs posts from external platforms (see `docs/sync-setup.md`)
- `.github/workflows/` — `deploy.yml` (GitHub Pages) and `sync-posts.yml` (scheduled sync)

## Build & Development Commands

- `npm run server` — local preview at http://localhost:4000
- `npm run build` — generate the static site into `public/`
- `npm run clean` — remove Hexo cache and `public/`
- `npm run deploy` — manually push to GitHub Pages (normally automatic)
- `node tools/sync-posts.js` — pull new posts from external platforms

Environment note: git/hexo commands are normally run in Windows PowerShell with the `myblogs` conda environment.

## Coding Style & Naming Conventions

- Posts: front matter with `title`, `date`, `categories`, `tags`; Chinese content is fine
- JavaScript: 2-space indent, camelCase; theme JS follows NexT conventions (`/* global NexT, CONFIG */`)
- YAML config: lowercase keys with underscores (`repo_id`, `category_id`)
- No linter is configured; keep changes minimal and consistent with existing files

## Testing Guidelines

No automated test suite exists for this static site. Verify changes with:

1. `npm run build` completes without errors
2. `npm run server`, then check affected pages in a browser (including dark mode)

## Commit & Pull Request Guidelines

- Use Conventional Commits: `feat:`, `fix:`, `chore:`, `build(deps:)`; short Chinese or English descriptions
- Dependency bumps: `build(deps): bump <pkg> from X to Y`
- PRs: explain what changed and why, link related issues, and include screenshots for visual changes
- Pushing to `master` triggers GitHub Actions deployment automatically

## Architecture Overview

Posts and assets in `source/` are compiled by Hexo into `public/`; `deploy.yml` publishes that to GitHub Pages at https://greeopia.github.io. Comments use giscus (GitHub Discussions), configured in `themes/hexo-theme-next-master/_config.yml` under `giscus:`.

## Notes

- All hexo / git operations must be run in the Windows PowerShell `myblogs` conda environment
- The blog deploys to `greeopia.github.io`, handled automatically by `.github/workflows/deploy.yml`
- The GitHub username was changed from `greenpia033-bot` to `greeopia` (2026-08-09); the repository is `greeopia/greeopia.github.io`; avatar and sidebar GitHub links have been updated accordingly
- Post syncing is triggered on a schedule by `sync-posts.yml`, and can also be run manually
