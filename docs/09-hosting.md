# Hosting

The app is a **static site**. No server, no API, no database, no upload — the
media is read and processed in the visitor's own browser, and nothing about it
ever crosses the network. That is the privacy story, and it also means hosting
is as easy as hosting a folder of HTML.

One property is worth protecting deliberately: the app does not use
`SharedArrayBuffer`, so it needs **no COOP/COEP headers** and no cross-origin
isolation. That is why it drops onto any static host without configuration.
If a future WASM kernel ever needs threads, gate it behind feature detection
rather than making cross-origin isolation the default — turning it on poisons
every cross-origin subresource on the page.

---

## 1. GitHub Pages — recommended

`.github/workflows/pages.yml` builds on every branch and deploys from the
repository's default branch.

**One manual step is unavoidable.** A repository owner has to turn Pages on:

> **Settings → Pages → Build and deployment → Source: *GitHub Actions***

The workflow cannot do it for you. `actions/configure-pages` has an
`enablement: true` input that is supposed to, and it returns *"Resource not
accessible by integration"* no matter what the `permissions:` block grants —
creating a Pages site needs admin rights that a workflow's `GITHUB_TOKEN` is
never given. This was tried; it fails the build, so the action is not used.

After enabling Pages, re-run the workflow (**Actions → Deploy web app → Run
workflow**) or push anything. The site lands at:

```
https://<owner>.github.io/<repo>/
```

Note the trailing path: a GitHub Pages *project* site is served from a subpath,
not the domain root. Every asset URL and — the part that actually breaks — every
worker URL has to resolve relative to the page. `vite.config.ts` sets
`base: './'` for exactly this, and it is verified rather than assumed:

```bash
npm run build
npm run smoke -- ./sample-shoot --base=/polysync
```

**Deploys only happen from the default branch.** GitHub refuses Pages
deployments from anything else, which is why the deploy job carries
`if: github.ref_name == github.event.repository.default_branch` rather than a
branch filter — this repository's default branch is not called `main`.

## 2. Netlify — fastest, no repository needed

For a one-off test with someone, `npm run build` and drag `apps/web/dist` (or a
zip of it) onto <https://app.netlify.com/drop>. A URL comes back in seconds.
Without an account the deploy is temporary; with a free account it persists.

To connect the repository instead, `netlify.toml` is already in the root:
build `npm ci && npm run build`, publish `apps/web/dist`.

## 3. Cloudflare Pages, Vercel, S3, anything else

Same three facts for any host:

| Setting | Value |
|---|---|
| Build command | `npm ci && npm run build` |
| Output directory | `apps/web/dist` |
| Node version | 22 |

No redirect or rewrite rules are needed — there is no client-side routing, just
one page.

---

## What to tell a tester

**Use Chrome or Edge.** They can remember the folder that was picked, so
reopening a project relinks instead of re-asking. Safari 26 and Firefox work
fine, they just need the folder dropped again each session — `File.slice()` is a
lazy range read on every browser, so reading a 200 GB card works identically
everywhere. What Chromium buys is convenience, not capability.

**HTTPS is required**, which every host above provides. `showDirectoryPicker()`
only exists in a secure context; over plain HTTP the app silently falls back to
the file-input path.

**Compressed camera audio needs WebCodecs.** AAC — iPhone, GoPro, most DSLRs —
decodes in Chrome, Edge and Safari 26. WAV and BWF from any recorder decode
everywhere, with no codec support at all. Anything that cannot be decoded is
named in the "Skipped" list with the reason, rather than failing silently.

**Nothing is uploaded.** Worth saying out loud to anyone being asked to drop
client rushes into a web page: there is no server to upload to. The page is
static files, and the media is read locally by the browser. It works with the
network disconnected after the page has loaded, which is the easiest way to
demonstrate it.

## What to ask for back

The point of a hosted test is the failure reports, so ask for:

- The **Skipped** list verbatim — that is the codec and container coverage
  report, and it is the fastest way to find out which cameras need work.
- Any clip in **Unsynced** that should have synced, with what it was.
- Anything in **Matches that disagree** — that section is the consistency
  checker catching a placement that is confident and wrong, and it is the one
  thing no other sync tool reports at all.
- Whether the exported XML actually relinked in their NLE, and what they had to
  type into "media folder on this machine" to make it work.
