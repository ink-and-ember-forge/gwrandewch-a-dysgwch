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

Bore dydd Sadwrn, es i i'r {{farchnad|market|marchnad, marchnadoedd, eb = market|note: soft mutation of marchnad after i'r}} yng Nghaerdydd.
Roedd hi'n brysur iawn.
```

**Frontmatter.** Required: `title`, `level`, `date` (YYYY-MM-DD), `summary`, `audio`. `level` is one of `mynediad`, `sylfaen`, `canolradd`, `uwch`, `hyfedredd`. Optional: `title_en`, `topics` (lowercase tags), `narrator`, `dialect` (`north`, `south`, `neutral`), `source`, `licence`, and `draft: true` to keep it off the site.

**One line = one sentence.** Never hard-wrap. A blank line starts a new paragraph. `## Heading` lines are headings and are not timed.

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
