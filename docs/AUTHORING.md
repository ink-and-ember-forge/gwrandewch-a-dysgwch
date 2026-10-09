# Adding an article

Add a folder under `content/articles/`, push to `main`, and the site rebuilds itself. You never edit an index or any code.

## 1. Create the folder

The folder name is the URL slug: lowercase ASCII letters, digits and hyphens only, no diacritics (`diwrnod-yn-y-farchnad`).

```
content/articles/<slug>/
├── article.md        required: frontmatter + Welsh text
├── audio.mp3         required: narration (mono, 64 kbps recommended, about 0.5 MB/min)
├── article.en.md     optional: English, one line per Welsh line
└── timings.json      optional: enables sentence highlighting
```

## 2. Write `article.md`

```markdown
---
title: Diwrnod yn y farchnad
title_en: A day at the market
level: sylfaen
topics: [food, shopping]
date: 2026-10-09
summary: A short piece about a busy Saturday morning at the market.
audio: audio.mp3
---

Bore dydd Sadwrn, es i i'r {{farchnad|market|soft mutation of marchnad after i'r}} yng Nghaerdydd.
Roedd hi'n brysur iawn.
```

**Frontmatter.** Required: `title`, `level`, `date` (YYYY-MM-DD), `summary`, `audio`. `level` is one of `mynediad`, `sylfaen`, `canolradd`, `uwch`, `hyfedredd`. Optional: `title_en`, `topics` (lowercase tags), `narrator`, `dialect` (`north`, `south`, `neutral`), `source`, `licence`, and `draft: true` to keep it off the site.

**One line = one sentence.** Never hard-wrap. A blank line starts a new paragraph. `## Heading` lines are headings and are not timed.

**Glosses.** `{{word|translation}}` or `{{word|translation|note}}`. Phrases work (`{{ar y gair|nearby}}`). Escape a literal `{{` as `\{{`. No nesting, no line breaks inside.

## 3. English (optional)

`article.en.md` has the same number of non-blank lines as `article.md` (headings excluded); line *n* translates sentence *n*. No frontmatter.

## 4. Timings (optional)

Open `tools/sync-tool.html` (also at `<site>/tools/sync-tool.html`), load the audio and `article.md`, play it, and press **Space** as each sentence begins. Download `timings.json` into the article folder.

It is an array of start times in seconds, one per sentence, strictly increasing: `[0.0, 4.1, 6.8]`. If you re-export the audio, re-sync.

## 5. Check and publish

```bash
node scripts/build.mjs          # same validation CI runs; needs Node 20+
python3 -m http.server -d dist  # optional local preview (seeking audio needs a server with Range support)
git add content && git commit -m "Add <slug>" && git push
```

The build **fails** (and the live site stays unchanged) on: a bad slug, a missing required field or audio file, a malformed `{{ }}`, timings that are the wrong length or not increasing, or English with the wrong line count. It **warns** about very long lines, articles with no glosses, one word glossed differently across articles, and audio over 10 MB.
