# Welsh Reader: Specification (v0.1 draft)

A static website, hosted on GitHub Pages, that serves as a growing library of Welsh-language articles for learners. Each article has audio, synchronised sentence highlighting, hover/tap translations for selected words, and an optional English translation. **New content is added by committing a folder; no code or index files are edited.**

---

## 1. Goals and non-goals

### Goals
1. **Zero-touch publishing.** Add `content/articles/<slug>/` with text and audio, push to `main`, and the site rebuilds and deploys with the new article in the index.
2. **Read and listen together.** Audio plays while the full text stays visible, with the current sentence highlighted.
3. **Contextual glossing.** Authors mark specific words or phrases with a translation shown on hover, focus or tap.
4. **Learner-friendly browsing.** Filter by Welsh for Adults level (Mynediad to Hyfedredd) and topic, with full-text search and an English toggle.
5. **Low maintenance.** Plain HTML/CSS/JS in the browser, a dependency-free Node build script, and a GitHub Actions deploy.

### Non-goals (v1)
- User accounts, progress tracking, quizzes or spaced repetition
- Server-side anything, comments, analytics or trackers
- Word-level audio highlighting (the format is designed so it can be added later)
- Automatic generation of audio, translations or timings (the sync tool in section 8 assists, but humans author)
- Offline/PWA support

---

## 2. Architecture overview

```
content/articles/<slug>/  ──►  scripts/build.mjs  ──►  dist/  ──►  GitHub Pages
 (markdown, audio, timings)    (Node, no npm deps)     (static)    (via Actions)
                                     ▲
                                site/ (templates, CSS, JS)
```

- **Source of truth:** the `content/` folder.
- **Build:** one Node script (Node 20+, built-in modules only) that validates content, renders each article to static HTML, writes a search/filter index, and copies assets into `dist/`.
- **Runtime:** vanilla JS enhances the pre-rendered pages (player, sync, tooltips, filters). Article text is readable even if JS fails.
- **Deploy:** a GitHub Actions workflow builds on every push to `main` and publishes `dist/` using the official Pages actions.
- **All URLs are relative.** Project sites are served at `/<repo-name>/`, so absolute paths (`/css/x.css`) will break. This is a classic Pages gotcha.

---

## 3. Repository layout

```
.
├── content/
│   ├── articles/
│   │   └── diwrnod-yn-y-farchnad/
│   │       ├── article.md          # required: Welsh text + frontmatter
│   │       ├── audio.mp3           # required: narration
│   │       ├── article.en.md       # optional: sentence-aligned English
│   │       └── timings.json        # optional: enables sentence highlighting
│   └── series/
│       └── cymraeg-byw.md          # optional: title, description and book credit for a series
├── site/
│   ├── index.html                  # home page template
│   ├── article.template.html       # article page template
│   ├── series.template.html        # series page template
│   ├── css/styles.css
│   └── js/
│       ├── index.js                # filters, search, card rendering
│       ├── article.js              # page bootstrap
│       ├── series.js               # series page: read progress, "continue"
│       ├── progress.js             # which chapters this browser has read
│       ├── player.js               # audio + sentence sync
│       ├── tooltip.js              # gloss tooltips
│       └── util.js                 # diacritic folding, URL state
├── scripts/
│   └── build.mjs                   # validate + render + index + copy
├── tools/
│   ├── editor.html                 # article editor (standalone): rows, tooltip builder, preview, zip
│   ├── editor-core.js              # editor logic (UMD, unit tested)
│   ├── render-core.js              # markup + tooltip rendering shared by build, site and editor
│   ├── lint-core.js                # parsing and format rules shared by build, linter and editor
│   ├── check.html                  # paste-and-check format checker (standalone)
│   └── sync-tool.html              # tap-along timing generator (standalone)
├── docs/
│   └── AUTHORING.md                # how to add an article (1 page)
├── .github/workflows/deploy.yml
├── SPEC.md
├── .gitignore                      # dist/
└── README.md
```

---

## 4. Content model

### 4.1 Article folder
- **Slug = folder name.** Lowercase ASCII, digits and hyphens only (no diacritics: `diwrnod-yn-y-farchnad`, not `diwrnod-yn-y-farchnad-ŵ`). The build rejects anything else.
- Folder contents as in section 3.

### 4.2 `article.md` frontmatter

Restricted YAML subset (flat `key: value`, plus inline lists `[a, b]`) so the build needs no parser dependency.

| Field | Required | Notes |
|---|---|---|
| `title` | yes | Welsh title |
| `title_en` | no | English title, shown on cards and under the heading |
| `level` | yes | One of `mynediad`, `sylfaen`, `canolradd`, `uwch`, `hyfedredd` (Entry, Foundation, Intermediate, Advanced, Proficiency). Lowercase in frontmatter; displayed capitalised, with the English name as a secondary label. Order is fixed in that sequence for filters and badges. |
| `type` | yes | What kind of piece it is: one of `news`, `article`, `story`, `poem`, `song`, `dialogue`, `podcast`, `video` (shown as News article, Article, Short story, …). The list lives in one place, `TYPES` in `tools/lint-core.js`; everything else reads it |
| `topics` | no | List, e.g. `[food, shopping]`; lowercase tags |
| `series` | no | Series this article is a chapter of: lowercase slug, the same for every chapter (section 4.8) |
| `part` | with `series` | Whole number from 1: the chapter's position. Unique within a series; required with `series`, and `series` is required with it |
| `part_label` | no | What readers see instead of "Part N" ("Uned 3", "Chapter 3") |
| `date` | yes | `YYYY-MM-DD`; drives newest-first ordering |
| `summary` | yes | One or two sentences, shown on the card |
| `audio` | yes | Filename in the same folder (default `audio.mp3`) |
| `narrator` | no | Credit |
| `dialect` | no | `north`, `south` or `neutral`. Informational badge only |
| `source` / `licence` | no | Attribution if text or audio isn't original |
| `draft` | no | `true` hides the article from the built site |

### 4.3 Body format: "one line = one sentence"

- Each **non-blank line** is one *segment* (usually a sentence). This is the unit of audio highlighting, timing and English alignment.
- A **blank line** starts a new paragraph.
- Lines starting with `## ` are subheadings. They are rendered but are not segments (not timed, not highlighted).
- Segment numbering is zero-based across the whole body, ignoring headings.

*Why not auto-split sentences?* Welsh abbreviations, quoted speech and ellipses make automatic splitting unreliable. Explicit lines make timings and translations deterministic. The trade-off is that editors must not hard-wrap lines; the build validates against this (see 6).

### 4.4 Gloss (tooltip) markup

```
{{surface text|translation}}
{{surface text|translation|word entry|word entry|…|note: free text}}
```

- **Surface text** is the word or phrase exactly as it appears in the article (single words, idioms: `{{ar y gair|nearby}}`). Never put tags or grammar in it; it is displayed in the text.
- **Translation** is the bold top line of the tooltip: the direct translation of *this use* in the text (`wind turbines`, not the dictionary headword).
- **Word entry** (zero or more): one tooltip line per word, written `Welsh forms, tag = English`.
  - Welsh forms are comma-separated: singular then plural (`tyrbin, tyrbinau`). English is the singular.
  - The optional tag is the last comma-separated part before `=`. Gender tags are typed once, per word: `eg` (enw gwrywaidd, masculine), `eb` (enw benywaidd, feminine), `egb` (either). The tooltip shows the Welsh tag and derives the English tag from it: `(eg)` … `(m)`, `(eb)` … `(f)`, `(egb)` … `(m/f)`.
  - Type labels for other words: `adj`, `verb`, `prep`, `adv`, `conj`, `pron` (Welsh aliases `ans`, `be`/`bf`, `ardd`, `adf`, `cys`, `rhag` are accepted). They show as neutral tags.
  - A phrase gets one entry per word, each on its own line: `{{tyrbinau gwynt|wind turbines|tyrbin, tyrbinau, eg = turbine|gwynt, eg = wind}}`.
- **Note**: any field with no `=`, or starting `note:`, is a smaller line under the entries, ideal for mutation and grammar hints. Several are allowed, one per line.
- Gender colour: `(eg)`/`(m)` blue, `(eb)`/`(f)` red, `(egb)`/`(m/f)` purple, always with the letters shown so colour is never the only cue. Colours are tuned for both themes.
- Escape literal braces with a backslash: `\{{`.
- Glosses cannot be nested and cannot span lines.

Example tooltip for `{{tyrbinau gwynt|wind turbines|tyrbin, tyrbinau, eg = turbine|gwynt, eg = wind}}`:

```
wind turbines
tyrbin, tyrbinau (eg) – turbine (m)
gwynt (eg) – wind (m)
```

**Why inline rather than a shared glossary:** Welsh mutations change word shapes (*bara → fara → mara*), so only the author knows which form means what in context. Inline markup guarantees accuracy. The cost is repetition, which is mitigated by build-time reporting (section 6) and the planned word bank (section 11).

### 4.5 `article.en.md` (optional)
Plain text, **same number of non-blank lines as `article.md`** (headings excluded), line *n* translating segment *n*. No frontmatter. If absent, the English toggle is not shown for that article.

### 4.6 `timings.json` (optional)
An array of start times in seconds, one per segment:

```json
[0.0, 4.1, 6.8]
```

A segment ends where the next begins; the last ends at the audio's end. The array length must equal the segment count. If absent, the article gets the plain player with no highlighting.

### 4.7 Worked example

`article.md`
```markdown
---
title: Diwrnod yn y farchnad
title_en: A day at the market
level: sylfaen
topics: [food, shopping]
date: 2026-10-09
summary: A short piece about a busy Saturday morning at the market.
audio: audio.mp3
dialect: south
---

Bore dydd Sadwrn, es i i'r {{farchnad|market|marchnad, marchnadoedd, eb = market|note: soft mutation of marchnad after i'r}} yng Nghaerdydd.
Roedd hi'n brysur iawn.

Prynais {{fara|bread|bara, eg = bread|note: soft mutation of bara}} ffres a {{chaws|cheese|caws, cawsiau, eg = cheese|note: aspirate mutation of caws after a}} lleol.
```

`article.en.md`
```
On Saturday morning, I went to the market in Cardiff.
It was very busy.

I bought fresh bread and local cheese.
```

`timings.json`
```json
[0.0, 4.1, 6.8]
```

---

### 4.8 Series

A **series** groups articles as the chapters of a book or course. Membership is declared on each chapter (`series`, `part`, optional `part_label`), so adding a chapter is still just adding a folder.

**Series file (optional):** `content/series/<series>.md`, frontmatter only: `title` (required), `title_en`, `summary`, `author`, `publisher`, `edition`, `licence`, `url` (http/https). Without it the series is titled from its slug. Text below the frontmatter is ignored (with a warning).

**Behaviour**
- A series page is built at `series/<series>/`: title, description, book credit, chapter count and total audio length, a "Start / Continue" button, and the ordered chapter list.
- A chapter page shows the series name and chapter label above the title, an "All N chapters" link, and **previous / next chapter** links (in part order, skipping gaps) in place of the date-based older/newer links. Standalone articles keep older/newer links among standalone articles only.
- The home page shows a series as **one card** with its chapters inside (collapsed; open when filtering). Search and the level/topic filters work on chapters; a series card appears when any chapter matches and lists the matching chapters. A **Series** filter chip limits the list to one series (`?series=<slug>`). A series' title, description and author are searchable from every chapter.
- **Read tracking** (browser only, no accounts): a chapter can be marked read (also set when its audio ends); the series page and card show progress and "Continue with …".
- `data/index.json` gains `series` entries (with ordered `chapters`) and per-article `series`, `part` and `label`.

**Validation.** Errors: invalid series slug; `part` not a positive integer; `series` without `part` or `part` without `series`; duplicate `part` within a series; series file without `title`, with a bad `url`, or with a non-slug file name. Warnings: a gap in part numbers (naming draft chapters), a one-chapter series with no series file (likely typo), a series file with no published chapter, unknown series-file fields.

## 5. Build pipeline (`scripts/build.mjs`)

1. **Discover** every folder in `content/articles/`; skip those with `draft: true`.
2. **Parse and validate** (section 6).
3. **Render** each article to `dist/articles/<slug>/index.html` from `article.template.html`:
   - Welsh text wrapped as `<p lang="cy"><span class="seg" data-i="0">…</span> …</p>`
   - Glosses rendered as `<span class="gloss" tabindex="0" data-tip="…" data-entries="[json]" data-note="…">` (escaped HTML, no raw injection)
   - English lines embedded as `<span class="seg-en" lang="en" hidden>` under each segment
   - Timings embedded as `<script type="application/json" id="timings">`
4. **Write `dist/data/index.json`**: for each article: slug, title, title_en, level, topics, date, summary, duration (if readable), has-sync, has-english, and a diacritic-folded plain-text blob for search.
5. **Copy** audio and `site/` assets into `dist/` with relative paths.
6. **Exit non-zero on any error** so a broken article can never be deployed.

Sorting: newest `date` first, ties broken by title.

---

## 6. Validation rules

**Errors (fail the build):**
- Invalid or non-ASCII slug
- Missing required frontmatter field, or `level` not one of the five allowed values
- `audio` file missing
- Unclosed or malformed `{{ }}`; a gloss with an empty surface or translation
- `timings.json` present but length ≠ segment count, non-numeric, or not strictly increasing, or last start > audio duration (when duration is readable)
- `article.en.md` present but line count ≠ segment count

**Warnings (printed in the Action log):**
- Segment longer than ~250 characters (probably a hard-wrapped paragraph or merged sentences)
- No glosses in the article
- The same surface form glossed with different translations across articles, or the same headword tagged with different genders or types (consistency checks)
- Audio over 10 MB

---

## 7. The front end

### 7.1 Home page
- Header with site title and a one-line description
- **Search box:** client-side, over title, English title, summary and body text. Matching is **diacritic- and case-insensitive**, so `wy` finds *ŵy* and `cymraeg` finds *Cymraeg*.
- **Filter chips:** series, type, level and topic (each multi-select). Active filters are reflected in the URL (`?type=song&level=sylfaen&topic=food&q=bara`) so views are shareable and the back button works.
- **Article cards:** title, English title, type badge, level badge, topic tags, summary, duration, small icons for "has English" and "synced". Newest first.
- Empty-state message when filters match nothing.

### 7.2 Article page
- Title, English title, type, level and topic badges, narrator/source credits
- **Text column:** readable measure (~65ch), generous line height, `lang="cy"`
- **Sticky audio bar:** play/pause, scrubber with elapsed/total time, speed (0.6x, 0.75x, 1x, 1.25x), previous/next sentence
- **Sentence sync** (when `timings.json` exists):
  - Current sentence highlighted (background **and** a non-colour cue such as a left border or underline)
  - Auto-scrolls to keep the current sentence in view, with a "stop following" behaviour if the user scrolls manually
  - **Click a sentence to seek and play from it**
  - Clicking a glossed word shows its tooltip and does *not* seek
- **English toggle:** shows each English line beneath its Welsh sentence. The choice is remembered in `localStorage`.
- Prev/next article links by date, and a back-to-index link

### 7.3 Tooltip behaviour
- Desktop: show on hover **and** keyboard focus
- Touch: tap to toggle (hover doesn't exist on phones, so this is not optional)
- `Esc` or tapping elsewhere closes it; only one open at a time
- Positioned to avoid viewport edges; never covers the highlighted sentence's start if avoidable
- Content: translation in bold, note beneath. Linked via `aria-describedby`
- Does not pause or interrupt audio

### 7.4 Keyboard shortcuts (article page)
`Space` play/pause, `←`/`→` previous/next sentence, `[`/`]` slower/faster, `E` toggle English.

---

## 8. Authoring support

### 8.1 Article editor (`tools/editor.html`)
A standalone, no-build page (opens locally or from Pages; no server, nothing uploaded) for creating and editing articles:
- **Sentence rows:** each sentence is a Welsh/English pair, so alignment cannot break. Paste text to split into sentences, split/merge/move rows, paragraph breaks and `##` headings.
- **Tooltip builder:** select words in the Welsh to build a gloss (translation, per-word entries with forms and tag, notes) with a live preview; click a gloss to edit or remove it.
- **Details form** for the frontmatter, with the folder name generated from the title.
- **Live preview** rendered with the site's own CSS and the same render code as the build (`tools/render-core.js`), and **checks** from the same rules as the build (`tools/lint-core.js`).
- **Output:** a zip containing the correctly named article folder (`article.md`, `article.en.md`, `timings.json` if present and matching, and the audio if attached). Opening an existing article folder round-trips it. Drafts are backed up in the browser.

### 8.2 Format checker (`tools/check.html`, `scripts/lint.mjs`)
Report-only checks of hand-written `article.md` / `article.en.md` (alignment, whitespace, typography, stray markdown). The CLI is also run in CI.

### 8.3 Sync tool (`tools/sync-tool.html`)

Timing every sentence by hand is the most laborious part of authoring. `tools/sync-tool.html` is a standalone page (no build, opens locally or from Pages):

1. Load `audio.mp3` and paste or load `article.md`
2. Play the audio and press **Space** as each sentence begins; the tool records the timestamp
3. Nudge/undo mistakes, preview playback with highlighting
4. Download `timings.json`

Tapping along runs at roughly real-time plus a little correction.

---

## 9. Deployment

`.github/workflows/deploy.yml`:
- Trigger: push to `main` (plus `workflow_dispatch`); also run the build, without deploying, on pull requests
- Steps: checkout → setup Node 20 → `node scripts/build.mjs` → `actions/configure-pages` → `actions/upload-pages-artifact` (path `dist`) → `actions/deploy-pages`
- Permissions: `contents: read`, `pages: write`, `id-token: write`
- One-time repo setting: **Settings → Pages → Source: GitHub Actions**

**Constraints to know:**
- GitHub Pages on a free account requires a **public** repository.
- Published site limit is about 1 GB; a single file in git must be under 100 MB.
- **Don't use Git LFS** for audio, because Pages won't serve LFS objects correctly.
- Recommended audio encoding: **mono MP3, 64 kbps** (about 0.5 MB per minute). 100 five-minute articles is about 240 MB.

---

## 9b. Non-functional requirements
- **No runtime dependencies**, no CDNs, no external fonts or trackers
- **Accessibility:** `lang` attributes on Welsh and English text; full keyboard operation; visible focus; tooltips reachable without a mouse; `prefers-reduced-motion` respected (no smooth auto-scroll); contrast of at least WCAG AA; light and dark themes via `prefers-color-scheme`
- **Performance:** `preload="metadata"` on audio; index JSON should stay under ~1 MB (fine to a few hundred articles; beyond that, split search data)
- **Browser support:** current evergreen browsers, iOS Safari included

---

## 10. Acceptance criteria

1. Adding a valid article folder and pushing to `main` results, within a few minutes and with no other file changed, in the article appearing on the index and its page working.
2. An article with a broken timings file or mismatched English lines **fails the build** and the live site stays unchanged.
3. On a phone, tapping a glossed word shows the translation; tapping elsewhere dismisses it.
4. During playback, exactly one sentence is highlighted at any time and it matches the audio within ±0.3 s.
5. Filtering by level and topic and searching without diacritics all work and are reflected in the URL.
6. The article text is fully readable with JavaScript disabled.
7. The deployed site works from `https://<user>.github.io/<repo>/` (a subpath), with no broken asset links.

---

## 11. Milestones

| # | Scope |
|---|---|
| **M1: Skeleton** | Build script, validation, index page listing articles, article page with plain audio player and inline tooltips, Actions deploy |
| **M2: Sync** | `timings.json` support, sentence highlighting, click-to-seek, speed control, shortcuts |
| **M3: Discovery** | Level and topic filters, search, English toggle, URL state |
| **M4: Authoring** | Sync tool, `AUTHORING.md`, consistency warnings, accessibility pass |

**Later (v1.x ideas):** per-article "word bank" auto-generated from glosses; site-wide glossary page; sentence looping; word-level timings; dialect filter; copy-gloss-to-flashcards export.

---

## 12. Open questions

1. **Audio source:** your own recordings, other speakers, or generated voices? This affects the narrator and licence fields and how much material you can produce.
2. **Text sourcing:** original writing, or adapted from elsewhere? If adapted, check copyright before publishing.
3. **Dialect:** do you want dialect tagging to matter (filter and badge), or just informational?
4. **Public repo:** acceptable? (Required for free Pages.) Custom domain wanted?
5. **Hosting scale:** if the library grows to hundreds of hours of audio, consider moving audio to external object storage (e.g. Cloudflare R2) and keeping only text in the repo. The `audio` field could then accept a full URL.

---

## 13. Risks and design critique

- **Authoring cost is the real constraint, not code.** Each article needs text, audio, timings, glosses and optionally English. If it takes two hours per article, the library will stall. The sync tool and validation exist to protect your future motivation.
- **Inline glossing is high-accuracy but high-effort.** If it feels burdensome, the fallback is a hybrid with a shared glossary and inline overrides. The build format can be extended without breaking existing articles.
- **"One line = one sentence" is fragile** if an editor soft-wraps and saves hard line breaks. The long-segment warning is the safety net.
- **Timings drift** if audio is re-exported. Treat `audio.mp3` and `timings.json` as a pair; re-sync on any re-encode.
