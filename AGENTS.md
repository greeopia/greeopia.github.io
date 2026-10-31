# Repository Guidelines

## Project Structure & Module Organization

This Hexo blog uses the vendored NexT theme.

- `source/_posts/`: Markdown articles; `scaffolds/`: post, page, and draft templates.
- `source/images/`: assets, including imported images under `cnblogs/`.
- `source/_data/`: custom Nunjucks, CSS, and Stylus overrides.
- `scripts/`: Hexo rendering hooks and helpers; `source/js/`: browser enhancements.
- `_config.yml`: site settings; `themes/hexo-theme-next-master/_config.yml`: theme and giscus settings.
- `tools/sync-posts.js`: cnblogs importer; `docs/sync-setup.md`: synchronization details.
- `.github/workflows/`: deployment and scheduled imports. `public/` and `db.json` are generated and ignored.

## Build, Test, and Development Commands

Use Node.js 20.19+. On Windows, run Hexo/Git commands in PowerShell with the `myblogs` conda environment activated: `conda activate myblogs`.

- `npm ci`: install dependencies from `package-lock.json`.
- `npm test`: check rendering, browser integration, assets, and offline import behavior.
- `npm run server`: preview at `http://localhost:4000`.
- `npm run build`: generate the site in `public/`.
- `npm run clean`: remove generated output and Hexo's cache.
- `npx hexo new "Title"`: create a post using `scaffolds/post.md`.
- `node tools/sync-posts.js`: fetch external articles and localize images; review resulting changes.
- `npm run deploy`: publish manually to the configured Git remote. Actions normally handles deployment.

## Coding Style & Naming Conventions

Use two-space indentation in JavaScript, YAML, and styles. Follow CommonJS imports, single quotes, semicolons, camelCase functions, and uppercase configuration constants. No linter or formatter is configured.

Prefer `YYYY-MM-DD-title.md` for posts. Include explicit `title` and `date` front matter; add `tags` and `categories` as appropriate. Preserve imported `cnblogs_url` metadata for deduplication. Prefer customization in `source/_data/` over broad edits to vendored theme files.

## Testing Guidelines

Run `npm test` for the Node.js regression tests in `tools/tests/`; no coverage threshold is configured. Name tests `*.test.js`. Importer tests use temporary files and mocked downloads. Run `npm run build`, then preview affected pages with `npm run server`. Check navigation, images, category/tag pages, mobile layouts, and light/dark appearance when relevant. For importer changes, verify deduplication and preservation of existing content and metadata.

## Commit & Pull Request Guidelines

Use history prefixes: `feat:`, `fix:`, `chore:`, and `build(deps):`. Write concise Chinese or English descriptions; dependency updates follow `build(deps): bump <package> from X to Y`.

PRs should explain the change and motivation, link relevant issues, and report validation. Include screenshots for visual changes. Pushes to `main` or `master` trigger Pages deployment; keep generated output out of commits.

## Others
Use subagents with `ccs-deepseek/deepseek-flash` or `ccs-packycode/glm-5.3`, always at `max` effort. Use the full model catalog IDs.
