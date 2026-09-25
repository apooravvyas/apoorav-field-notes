# Apoorav’s Field Notes: a content graph for your writing

A static, read-only site that maps posts by recurring **themes** (what a post is about) and **tone** (how it is written). Each tag is a circle sized by the number of distinct posts carrying it; lines join tags that appear on the same post. Select a circle to read its posts, each linking back to the original.

**Current state:** The site uses clearly labelled sample posts because no real posts have been imported yet. The real-posts file is intentionally empty. Imported posts stay in a private review inbox and are not shown on the site until you choose to publish them.

## Apoorav: the next step, in plain English

When X says your archive is ready, download it and unzip it on this Mac. Keep the ZIP and extracted folder here; they include account data you should not upload to a chat or the public site. Then return to this Codex task and tell me the extracted folder’s name. I can run the local importer, make a simple review list, and leave every post unpublished until you choose what to include. The importer reads only the post and account files needed to build your post links.

No backend, no sign-in, no X API. It builds to plain HTML/CSS/JS you can host anywhere (Vercel, Netlify, GitHub Pages, Cloudflare Pages).

```bash
npm install
npm run dev        # local dev server
npm run build      # validate data, type-check, build to dist/
npm run preview    # serve dist/ locally
```

**Stack:** Vite + TypeScript, no UI framework. The graph is SVG (focusable, keyboard-accessible) laid out once with `d3-force` and panned/zoomed with `d3-zoom`. Fonts (Fraunces, Source Serif 4) are self-hosted from `@fontsource`. The repo started empty, so this was the smallest setup that gives typed data, a fast static build and good touch/zoom handling.

---

## Personalise: `site.config.ts`

Profiles shown on the site (tag rail "Apoorav elsewhere" and the About dialog):

- X: [@apoorav_vyas](https://x.com/apoorav_vyas)
- LinkedIn: [linkedin.com/in/apooravvyas](https://www.linkedin.com/in/apooravvyas)
- Substack: [apoorav.substack.com](https://apoorav.substack.com)


| Field | What it does |
| --- | --- |
| `siteTitle` | Wordmark and browser tab title |
| `tagline` | Small line next to the wordmark (hidden on narrow screens) |
| `authorName` | Used in the About dialog, the profile links in the tag rail, and the sample-data notice |
| `xHandle` | Your handle without `@` (set to `apoorav_vyas`). Empty hides the X link |
| `intro` | One or two sentences in the About dialog |
| `substackUrl` | Optional newsletter link. Empty hides it |
| `linkedinUrl` | Optional LinkedIn profile link. Empty hides it |
| `dataMode` | `'auto'` (your posts; falls back to the labelled sample set while `content/posts.json` is empty), `'real'`, or `'demo'` |
| `dateLocale` | Date format on cards, e.g. `'en-GB'` → 12 Mar 2026 |

## Data files

```
content/
  posts.json         ← your published posts (the only post data the site ships)
  taxonomy.json      ← optional labels, colours and descriptions for your tags
  demo/              ← sample posts + taxonomy, clearly labelled, shown only while posts.json is empty
  x-inbox.json       ← importer output (private, git-ignored, never shipped)
```

### Post schema (`content/posts.json`)

```json
{
  "version": 1,
  "posts": [
    {
      "id": "x:1790000000000000000",
      "platform": "x",
      "url": "https://x.com/yourhandle/status/1790000000000000000",
      "text": "The full post text.",
      "publishedAt": "2026-03-12T09:30:00Z",
      "themes": ["community", "events"],
      "tones": ["practical"],
      "threadId": "x:1790000000000000000",
      "sequence": 1,
      "media": [{ "type": "image", "url": "https://pbs.twimg.com/media/....jpg", "alt": "..." }]
    }
  ]
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `id` | yes | Unique and stable. Convention: `<platform>:<native id>` |
| `platform` | yes | `"x"`, `"substack"` or `"linkedin"` (the graph ignores it; it only drives the source badge) |
| `url` | yes | **The public permalink.** For X: `https://x.com/<handle>/status/<id>` (twitter.com also accepted) |
| `text` | yes* | Full post text. *A Substack entry may use `title` instead |
| `publishedAt` | yes | ISO 8601 date/time |
| `themes`, `tones` | yes | Arrays of tag ids. Empty is allowed; the post just won't appear on that lens |
| `title` | no | Only when the original has one (Substack). **Don't add titles to X posts**; cards are text-first |
| `excerpt` | no | Short preview, used on titled cards |
| `media` | no | `image` / `video` / `gif`. Images show on the card; if one fails to load the card says "Image unavailable". Videos link out |
| `threadId`, `sequence` | no | Posts sharing a `threadId` are grouped on the card list in `sequence` order and labelled "2 of 5 in thread" |

Counts are always derived from unique post ids: a post tagged `community` + `events` adds 1 to each circle, and the header shows the unique total separately.

### Themes and tones (`content/taxonomy.json`)

Tags are just ids on posts. Writing `"themes": ["building-in-public"]` is enough: the tag appears with the label "building in public" and an automatic colour. Ids are normalised to lowercase-with-hyphens, so `"Building in Public"` works too.

To set a nicer label, colour or description, add it to `taxonomy.json`:

```json
{
  "themes": [
    { "id": "ai-tools", "label": "AI tools", "color": "mist" },
    { "id": "community", "color": "sage", "description": "Running and growing builder communities." }
  ],
  "tones": [
    { "id": "contrarian", "color": "clay", "description": "Pushing against the usual take." }
  ]
}
```

Colours: `rose`, `lavender`, `sage`, `mist` (dusty blue), `wheat`, `clay`, or any `#hex`. Descriptions show on hover in the tag list and at the top of the post panel. Renaming a tag = changing its `label`; merging two tags = find-and-replace the id in `posts.json`. Tags defined in `taxonomy.json` but used on no post are not drawn.

`taxonomy.json` starts empty on purpose: the tags should be yours. Nothing is auto-tagged.

`npm run validate` checks everything (and runs before every build). It reports skipped posts, undefined tags and posts with no theme or tone.

---

## Importing from your X archive (local, optional)

1. On X: **Settings → Your account → Download an archive of your data**. You get a ZIP by email/notification (X's own timing, often a day or more).
2. Unzip it **outside this repo**, or into `./archive/` (git-ignored).
3. Run:

   ```bash
   npm run import:x -- ./archive/twitter-2026-…     # the unzipped folder (or its data/ folder, or tweets.js)
   ```

   The importer reads only `data/tweets.js` (older archives: `tweet.js`), `data/note-tweet.js` (full text of long posts) and `data/account.js` (your handle and id, to build permalinks and tell threads from replies). It never opens DMs, likes, bookmarks, followers, contacts or anything else. No network calls, no AI.

   It keeps your original posts and self-reply thread parts; skips retweets and replies to other people; expands t.co links; and writes everything to `content/x-inbox.json` with empty tags and `"publish": false`.

4. Curate `content/x-inbox.json`: add `themes`/`tones` and set `"publish": true` on posts you want public.
5. Run `npm run publish:posts` (add `-- --dry` to preview). Only published posts are copied into `content/posts.json`, with public fields only. Re-running the importer later keeps your tags and choices; un-publishing a post removes it from `posts.json` on the next publish.

Threads are grouped only by explicit self-reply links (`in_reply_to_status_id` pointing at your own post), never by conversation id, so unrelated replies are not merged.

The archive format changes over time. The parser relies only on long-standing fields and reports entries it could not read instead of guessing. It was written against X's documented archive layout and tested with a synthetic archive, not a real export yet: if your archive reports unreadable entries, check one entry in `data/tweets.js` against `scripts/import-x-archive.mjs`.

Media URLs point to X's CDN as posted. Files in the archive's `tweets_media/` folder are not copied; if you want to self-host images, copy the ones you choose into `public/media/` and point `media[].url` at `./media/<file>`.

**Privacy guard rails:** `.gitignore` excludes `archive/`, `*.zip`, `tweets.js`, `direct-messages*.js`, `account.js` and `content/x-inbox.json`. Only `content/posts.json` is bundled into the site.

### X API (not configured)

There is no X API connection in this project, and none is needed. If you later want automatic syncing, add it as a separate server-side script (never browser code) that reads credentials from environment variables and writes to `content/x-inbox.json`, then keep using `publish:posts`. API access and pricing depend on X's current plans.

### Substack and LinkedIn (review first, same flow)

```bash
npm run import:substack -- ./archive/substack-export     # Substack: Settings → Exports (unzipped)
npm run import:substack -- https://apoorav.substack.com  # or the public RSS feed (recent posts only)
npm run import:linkedin -- ./archive/linkedin-export     # LinkedIn: Settings → Data privacy → Get a copy of your data → Posts
```

These write `content/substack-inbox.json` and `content/linkedin-inbox.json` (git-ignored). From a Substack export only published, free-for-everyone posts are kept; from LinkedIn only `Shares.csv` is read and connections-only posts are skipped. `npm run publish:posts` reads every inbox. Neither importer logs in or scrapes; both were tested with sample files shaped like the official exports, not with real exports yet.

---

## What's where

```
site.config.ts              personalisation
content/                    data (see above)
shared/schema.mjs           validation used by both the site and the scripts
src/types.ts                typed Post / Tag / Graph models
src/lib/data.ts             dataset loading, graph derivation (counts, co-occurrence), search
src/lib/graph.ts            SVG graph: layout, drag, pan/zoom, selection, fading
src/main.ts                 UI state, URL/back-forward sync, rail, panel, cards, empty states
src/styles.css              visual design, responsive layout, light/dark
scripts/                    validate-posts, import-x-archive, import-substack, import-linkedin, publish-posts
```

**URL state:** `?lens=tone&tag=practical&q=ai` is shareable; back/forward walks through tag selections and lens changes.

**Search** matches the start of words in tag names and post text/title/excerpt ("ai" finds "AI tools", not "email"). Unrelated circles fade, the tag list narrows, and an open panel filters to matching posts.

`npm run build:single` produces `dist-single/index.html`, one self-contained file that is handy for previews.
