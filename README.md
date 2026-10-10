# Gwrandewch a Dysgwch

A static library of Welsh-language articles for learners: audio, synchronised sentence highlighting, tap-for-translation glosses, and an optional English line-by-line view. See [SPEC.md](SPEC.md) for the full design.

**Publishing = committing a folder.** Add `content/articles/<slug>/`, push to `main`, and GitHub Actions validates, builds and deploys. See [docs/AUTHORING.md](docs/AUTHORING.md).

## One-time setup

1. Make sure the repository is public (required for free GitHub Pages).
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
3. Push to `main`. The site appears at `https://<user>.github.io/<repo>/`.

There is no manual build step: `.github/workflows/deploy.yml` runs `node scripts/build.mjs` and publishes `dist/` (git-ignored) using the official Pages actions. Pull requests run the same build without deploying.

## Layout

| Path | Purpose |
|---|---|
| `content/articles/<slug>/` | Source of truth: `article.md`, `audio.mp3`, optional `article.en.md`, `timings.json` |
| `content/series/<name>.md` | Optional page for a series (a book or course whose chapters are articles linked by `series:` and `part:`) |
| `site/` | Home and article templates, CSS, vanilla JS (no dependencies, all URLs relative) |
| `scripts/build.mjs` | Validate, render, write `data/index.json`, copy assets (Node 20+, no npm deps) |
| `tools/index.html` | **Authoring dashboard** at `<site>/tools/`: links the tools below; optional password via the `AUTHORING_PASSWORD` Actions secret (see `docs/AUTHORING.md`) |
| `tools/editor.html` | **Article editor**: build an article from Welsh/English sentence rows, with a tooltip builder, live preview, checks and a zip download (`tools/editor-core.js` holds its logic, `tools/render-core.js` the markup shared with the build) |
| `tools/sync-tool.html` | Tap-along generator for `timings.json` |
| `tools/check.html`, `scripts/lint.mjs` | Format checker for `article.md` / `article.en.md` (browser and CLI, shared rules in `tools/lint-core.js`) |
| `tests/` | `node --test tests/*.test.mjs` covers the linter, the editor, series and the zip writer; they use their own fixtures, never the live content |
| `docs/AUTHORING.md` | How to add an article |

## Local preview

```bash
node scripts/build.mjs
python3 -m http.server -d dist 8000   # http://localhost:8000
```
