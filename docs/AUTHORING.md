# Adding an article

Add a folder under `content/articles/`, push to `main`, and the site rebuilds itself. You never edit an index or any code.

## The authoring dashboard

Everything lives behind one page: **`<site>/tools/`** (the small *Authoring* link in the site footer, or open `tools/index.html` from your clone). It links the article editor, sync tool and format checker, in the order you usually need them.

### Password

The authoring pages can be locked with a password so learners don't wander in by accident. Set it once:

1. In the repository: **Settings → Secrets and variables → Actions → New repository secret**.
2. Name `AUTHORING_PASSWORD`, value your password.
3. Re-run the latest *Build and deploy* (or push anything to `main`).

To change it, edit the secret and redeploy; to remove it, delete the secret and redeploy. Until a secret exists the tools are open, and the dashboard says so on the live site. The dashboard has a **Lock** link, and a browser stays unlocked until its tab is closed.

This is a deterrent, not a vault. A static site has no server to check a password, so the check runs in the browser against a salted hash (the password itself is never published). Someone determined could bypass it, but the tools hold nothing secret: your drafts stay in your own browser, and articles only go live when you commit them. Local copies from your clone are never password protected.

## The easy way: the article editor

Open **`tools/editor.html`** from the dashboard. Nothing is uploaded; it runs in your browser.

1. **Details:** title, type, level, date, summary, topics. The folder name is generated from the title.
2. **Sentences:** paste your Welsh (*Paste text…*) and it is split into one row per sentence, then paste the English the same way to fill the English column. Each row is a Welsh/English pair, so the two files cannot get out of step. Add, split (<kbd>Enter</kbd>), merge, move and delete rows; <kbd>¶</kbd> starts a new paragraph and <kbd>H</kbd> makes a `##` heading.
3. **Tooltips:** select words in a Welsh sentence (drag or double-click) and press <kbd>G</kbd> or *Add tooltip*. The builder takes the bold translation, one line per word (Welsh forms, tag, English), and notes, with mutation shortcuts and a live preview of the tooltip. Click a dotted word to edit it.
4. **Check:** the preview is the real article page (English toggle, tooltips), and the Checks panel runs the same rules as the build against the files it will write.
5. **Download zip:** the article folder, ready to unzip into `content/articles/`. Attach the audio and it is included; *Open folder…* re-opens an existing article (keeping its `timings.json` and audio) to edit it. Your work is backed up in the browser as you go.

Timings still come from the [sync tool](#4-timings-optional). The rest of this page describes the file format the editor writes, which you can also write by hand.

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

Bore dydd Sadwrn, es i i'r {{farchnad|market|marchnad, marchnadoedd, eb = market|note: soft mutation of marchnad after i'r}} yng Nghaerdydd.
Roedd hi'n brysur iawn.
```

**Frontmatter.** Required: `title`, `level`, `type`, `date` (YYYY-MM-DD), `summary`, `audio`. `level` is one of `mynediad`, `sylfaen`, `canolradd`, `uwch`, `hyfedredd`. `type` is what kind of piece it is:

| `type:` | Shown as |
|---|---|
| `news` | News article |
| `article` | Article |
| `story` | Short story |
| `poem` | Poem |
| `song` | Song |
| `dialogue` | Dialogue |
| `podcast` | Podcast |
| `video` | Video |

Type describes the *piece* (so a book's chapters can differ: a dialogue, then a song), while topics say what it is *about* and level says how hard it is. It shows as a badge on the card, article page and series chapter list, has its own filter on the home page (`?type=song`), and can be searched. **To add a new type**, add one line to `TYPES` near the top of `tools/lint-core.js` (`['letter', 'Letter or email']`): the build, the editor's dropdown, the filter and the badges all read that one list. Optional: `title_en`, `topics` (lowercase tags), `series`, `part` and `part_label` (see [Series](#series-chapters-of-a-book-or-course)), `narrator`, `dialect` (`north`, `south`, `neutral`), `source`, `licence`, and `draft: true` to keep it off the site.

**One line = one sentence.** Never hard-wrap. A blank line starts a new paragraph. `## Heading` lines are headings and are not timed.

**Glossary.** Every gloss in an article is also collected automatically into a *Geirfa* section at the foot of the article: alphabetical, one card per word, with its entries and notes. Glossing the same word the same way twice lists it once.

**Glosses (tooltips).** `{{surface|translation|entry|entry|…|note: …}}`

- `surface`: the word or phrase exactly as written in the text (no tags in it).
- `translation`: the bold top line, the meaning of *this use* in the sentence.
- `entry`, one per word, each on its own tooltip line: `Welsh forms, tag = English`.
- notes: a field with no `=` (or starting `note:`) is a smaller grey line, good for mutations.

```
{{tyrbinau gwynt|wind turbines|tyrbin, tyrbinau, eg = turbine|gwynt, eg = wind}}
{{farchnad|market|marchnad, marchnadoedd, eb = market|note: soft mutation after i'r}}
{{ddiogel|safe|diogel, adj = safe}}
```

shows, for the first one:

```
wind turbines
tyrbin, tyrbinau (eg) – turbine (m)
gwynt (eg) – wind (m)
```

Type the gender **once per word**, on the Welsh side; the English `(m)`/`(f)` is added for you, so they cannot disagree. Singular first, then plural; English is singular.

| Tag | Meaning | Shown |
|---|---|---|
| `eg` | masculine noun | `(eg)` … `(m)` in blue |
| `eb` | feminine noun | `(eb)` … `(f)` in red |
| `egb` | either gender | `(egb)` … `(m/f)` in purple |
| `adj` `verb` `prep` `adv` `conj` `pron` | word type | neutral grey tag |

The Welsh dictionary abbreviations `ans`, `be`/`bf`, `ardd`, `adf`, `cys`, `rhag` also work. Colour is never the only signal: the letters are always shown. The checker flags `(m)`/`(f)` typed by hand, and the build warns if one headword is tagged with different genders in different articles.

Phrases work (`{{ar y gair|nearby}}`). Escape a literal `{{` as `\{{`. No nesting, no line breaks inside.

## Series: chapters of a book or course

Several articles can be linked as one series, for example the chapters of a learners' book. Each chapter is still an ordinary article folder; two fields in its frontmatter join it to the series:

```yaml
series: cymraeg-byw      # the series name: lowercase letters, digits, hyphens (same for every chapter)
part: 3                  # this chapter's position: 1, 2, 3 … (each chapter needs its own number)
part_label: Uned 3       # optional: what readers see instead of "Part 3" (Uned 3, Chapter 3, Pennod 3)
```

That is all a chapter needs. The site then builds a **series page** at `series/<name>/` listing the chapters in order, adds the series name and chapter label above each chapter's title, and replaces the older/newer links with **previous / next chapter** links. The home page shows the series as a single card (its chapters listed inside), with a **Series** filter, and searching a series name, author or any chapter's text finds it. Readers can tick chapters off as they read them (stored only in their own browser); the series page offers "Continue with …" and the home card shows progress.

**The series page (optional).** To give the series a proper title, a description and a book credit, add one small file, `content/series/<name>.md`, with the same `<name>` as the chapters use:

```markdown
---
title: Cymraeg Byw
title_en: Living Welsh
summary: A beginner's course in everyday Welsh, one unit at a time.
author: A. Learner
publisher: Example Press
edition: 2nd edition
licence: CC BY-NC 4.0
url: https://example.org/cymraeg-byw
---
```

Only `title` is required; the other fields are shown when given. Without the file the series still works and is titled from its name (`cymraeg-byw` becomes "Cymraeg byw").

**What gets checked.** The build **fails** if two chapters share a part number, a chapter has a `series` but no `part` (or the reverse), or a series file has no `title` or a bad link. It **warns** when a series has a gap (a missing or draft part; readers will see the gap), when a series has one chapter and no series file (usually a typo in `series:`), and when a series file has no chapters. `node scripts/lint.mjs` runs the same checks.

**In the editor.** *Details* has the series name, part number and chapter label, and a *Series page* section for the book details with a download for the series file. Series you have used before are remembered in the browser, so a later chapter fills the details in for you. Keep the series name identical across chapters; the editor's name suggestions help avoid typos.

## 3. English (optional)

`article.en.md` has the same number of non-blank lines as `article.md` (headings excluded); line *n* translates sentence *n*. No frontmatter.

## 4. Timings (optional)

Open `tools/sync-tool.html` (also at `<site>/tools/sync-tool.html`), load the audio and `article.md`, play it, and press **Space** as each sentence begins. Download `timings.json` into the article folder.

It is an array of start times in seconds, one per sentence, strictly increasing: `[0.0, 4.1, 6.8]`. If you re-export the audio, re-sync.

## 5. Check the formatting

Two tools, same rules, report-only (neither ever edits your files):

- **Browser:** open `tools/check.html` (or `<site>/tools/check.html`), paste or open both files. Problems list as you type, click one to jump to the line, and a side-by-side table shows Welsh line *n* next to English line *n* so a missing or merged line is obvious.
- **Terminal:** `node scripts/lint.mjs [slug]` (add `--align` for the side-by-side table, `--strict` to fail on warnings, `--quiet` to hide notes).

What it checks, beyond what the build already enforces:

| Area | Examples |
|---|---|
| Alignment | line counts, a question matched with a statement, a line far longer/shorter than its pair, blank-line paragraphs and `##` headings that don't mirror each other, and a hint at where the files drift apart |
| Whitespace | tabs, trailing or leading spaces, double spaces, non-breaking spaces, invisible characters, runs of blank lines |
| Typography | space before `, ; : ! ?`, missing space after a comma, mixed straight/curly apostrophes, quotes or ellipses, `--` for dashes, decomposed accents (ŵ ŷ typed as letter + mark) |
| Stray markdown | lists, `# ` or `###` headings, `---` rules, `**bold**`, links, HTML, backticks (none are rendered, and a `---` or `-` line would become a timed sentence) |
| English file | frontmatter by mistake, `{{glosses}}` that belong in the Welsh file |
| Structure | several sentences on one line, a sentence hard-wrapped over two lines |

Errors fail the build; warnings and notes are advice, and CI shows them as annotations without blocking.

## 6. Build and publish

```bash
node scripts/build.mjs          # same validation CI runs; needs Node 20+
python3 -m http.server -d dist  # optional local preview (seeking audio needs a server with Range support)
git add content && git commit -m "Add <slug>" && git push
```

The build **fails** (and the live site stays unchanged) on: a bad slug, a missing required field or audio file, a malformed `{{ }}`, timings that are the wrong length or not increasing, or English with the wrong line count. It **warns** about very long lines, articles with no glosses, one word glossed differently across articles, and audio over 10 MB.
