# Slop Bucket — UI handoff

As of Oct 8, 2026 · first design pass

This is the visual and interaction spec for the public site and the admin. `docs/DESIGN.md` is still the source of truth for scope, data and behavior; if this doc and DESIGN.md disagree, stop and ask. Where a section below needs a data or behavior change, it is listed under [Changes DESIGN.md needs](#changes-designmd-needs) so the PR that builds it can update DESIGN.md too.

**Design canvas:** https://claude.ai/artifact/6ewcH4jnKM8GnD3fDSzzzw (private to Andy; 15 artboards). Each screen below names its artboard. The canvas is a mockup, not code: copy the structure, spacing and copy, and build with Tailwind utilities.

**Don't copy these from the canvas:**

- It shows the old six categories. Build with the v3 list (below).
- The dashed "YOUR LOGO" boxes are placeholders. See [Open questions](#open-questions).
- On the Search artboard, the name "Worktrunk" is highlighted for the query "worktree". That's wrong: only text the search actually matched gets highlighted.
- Trending order, star counts for repos without snapshots, 7-day gains, Pi's license and language, the Status page's rate and backfill progress, the two reports and the merge-history entry are illustrative. Everything else came from the production D1 on Oct 7.

## Decisions

| Area | Decision |
| --- | --- |
| Name | Slop Bucket (replaces the working title "AI Coding Tools Radar") |
| Personality | Playful name and mascot, serious and dense UI |
| Copy voice | Deadpan curator: dry, short, specific. "Every AI dev tool the internet posted about, ranked by who's talking about it. Sorted. Mostly." |
| Theme | Light first, with a dark mode that follows the OS and can be toggled. Admin is light only for now |
| Palette | Tailwind `lime` accent on `stone` neutrals |
| Type | Space Grotesk (UI, headings) and Space Mono (numbers, ranks, tags, labels) |
| Components | Tailwind Plus patterns; Tailwind Plus Elements only where a widget needs JS (dialogs). No React |
| Browse layout | Ranked list with a left filter sidebar; on phones, a Filters slide-over plus category chips |
| Row signals | Source badges (HN, LOB, GH) and stars with the 7-day gain. No rank-movement arrows or sparklines |
| Tool image | GitHub owner avatar when the tool has a repo, otherwise a monogram tile colored by category |
| Tags | A curated, admin-managed vocabulary. The classifier may only pick from it; visitors filter by it |
| Admin | Phone first; at `lg` and up it becomes a sidebar layout with a split-view queue |
| Scope | Unchanged for v1 (AI coding tools). Category navigation must handle 10–15 categories |

## Open questions

1. **Logo.** Three concepts are in `docs/brand/logo-concepts/` (A: pig in a bucket, B: pig in a suit wearing a bucket, C: bucket with pig ears), each in pink and gray. Pick one. They use a classic serif and a salmon pink (`#e9aea3`), which the lime and Space Grotesk system doesn't include. Options: keep lime for UI and use the gray variant in the header; or bring the pink in as a second accent for the mascot only (empty states, 404). Don't use the pink for UI text or controls without checking contrast. Each concept has a tagline that fits the voice: "I only use it for boilerplate.", "It's not slop. It's an agentic framework.", "An index of AI dev tools".
2. **Tag groups after categories v3.** The canvas has two tag groups, "Works with" and "Topic". Categories v3 now covers most of Topic (add-ons, agent tools, security, review and testing, memory). Proposal: keep **Works with** (host agent or editor: Claude Code, Codex, Cursor, OpenCode, Pi, Gemini CLI…) and replace Topic with **Platform** (macOS, Linux, Windows, self-hosted, local models). Confirm before building the vocabulary.
3. **Filter apply behavior on desktop.** Either an Apply button (no JS), or a few lines of inline script that submit the form on change. The canvas assumes submit on change on desktop and an explicit "Show N tools" button on phones.

## Tokens

Replace the indigo brand in `apps/site/src/styles/global.css`:

```css
@import "tailwindcss";

/* Dark mode follows a `dark` class on <html>, set by a small inline script
   from localStorage or prefers-color-scheme (see Theme toggle). */
@custom-variant dark (&:where(.dark, .dark *));

@theme {
  --font-sans: "Space Grotesk", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-mono: "Space Mono", ui-monospace, SFMono-Regular, Menlo, monospace;

  --color-brand-50: var(--color-lime-50);
  --color-brand-200: var(--color-lime-200);
  --color-brand-300: var(--color-lime-300);
  --color-brand-400: var(--color-lime-400);
  --color-brand-600: var(--color-lime-600);
  --color-brand-700: var(--color-lime-700);
  --color-brand-950: var(--color-lime-950);
}
```

Self-host the fonts with `@fontsource/space-grotesk` (400, 500, 600, 700) and `@fontsource/space-mono` (400, 700). That avoids a Google Fonts request, and the files ship as Worker static assets.

| Role | Light | Dark |
| --- | --- | --- |
| Page background | `bg-stone-50` | `dark:bg-stone-950` |
| Surface (header, cards, list) | `bg-white` | `dark:bg-stone-900` |
| Hover and subtle fill | `bg-stone-100` | `dark:bg-stone-800` |
| Divider | `border-stone-200` | `dark:border-stone-800` |
| Input border, strong divider | `border-stone-300` | `dark:border-stone-700` |
| Text | `text-stone-900` | `dark:text-stone-50` |
| Secondary text | `text-stone-600` | `dark:text-stone-300` |
| Muted text (captions, counts) | `text-stone-500` | `dark:text-stone-400` |
| Accent fill (primary buttons, active nav, release marker) | `bg-lime-400 text-lime-950 hover:bg-lime-300` | same |
| Accent text and links | `text-lime-700` | `dark:text-lime-400` |
| Accent soft ("Open source" badge, selected rows) | `bg-lime-50 text-lime-700 ring-lime-200` | `dark:bg-lime-400/10 dark:text-lime-400 dark:ring-lime-400/30` |
| Focus ring | `outline-lime-600` | `dark:outline-lime-400` |

Two contrast rules: text on a lime fill is always `lime-950`, never white, and lime text in light mode is never lighter than `lime-700`. Muted `stone-500` passes 4.5:1 only on white and `stone-50`; don't put it on `stone-100` or darker.

Admin status colors: OK `bg-emerald-50 text-emerald-700`, warning `bg-amber-50 text-amber-800 ring-amber-200`, danger `text-red-700 ring-red-300`. Lime and emerald are reserved (brand/action and OK), so no category uses them.

### Category colors (v3)

Badges follow the Tailwind Plus flat badge: `bg-{hue}-50 text-{hue}-700 ring-1 ring-inset ring-{hue}-600/20`, dark `dark:bg-{hue}-400/10 dark:text-{hue}-300 dark:ring-{hue}-400/20`. Monogram tiles use `bg-{hue}-100 text-{hue}-800` (dark `bg-{hue}-500/20 text-{hue}-200`). Filter dots use `bg-{hue}-700` (dark `bg-{hue}-300`). The label always appears next to the color, so color is never the only signal.

| Category | Label | Hue |
| --- | --- | --- |
| `agent` | Agent | violet |
| `agent-addon` | Agent add-on | indigo |
| `agent-tools` | Agent tools | sky |
| `agent-security` | Agent security | rose |
| `review-testing` | Review & testing | orange |
| `memory-context` | Memory & context | cyan |
| `ide` | IDE | blue |
| `cli` | CLI | amber |
| `mcp-dev` | MCP · dev | teal |
| `mcp-general` | MCP · general | pink |
| `other` | Other | stone |

Display labels and hues belong in `packages/core` next to the category list, so a category added from settings falls back to stone and its slug until code adds a label.

### Type scale

| Use | Canvas | Utilities |
| --- | --- | --- |
| Home H1 | 52px bold, -0.035em, line-height 1.04 | `text-5xl/none font-bold tracking-tighter` (phone `text-4xl`) |
| Tool page H1 | 48px bold | `text-5xl font-bold tracking-tighter` (phone `text-4xl`) |
| Search H1 | 36px bold | `text-4xl font-bold tracking-tight` |
| Section heading | 22px bold | `text-xl font-bold tracking-tight` |
| Tool name in a row | 17px semibold | `text-base/6 font-semibold` or `text-[17px]` |
| Row description | 15px, line-height 22px | `text-[15px]/[22px] text-stone-600` |
| Eyebrow and labels | Space Mono 11–12px, uppercase, 0.08em | `font-mono text-xs uppercase tracking-widest` |
| Meta, counts, stars | Space Mono 12px | `font-mono text-xs tabular-nums` |

## Public site

Every public page shares a header and footer.

- **Header** (64px, white surface, bottom border): logo linking home; nav (Trending, New, Categories menu); search field with a `/` shortcut hint; theme toggle (icon button with `aria-label` "Switch to dark theme" or "Switch to light theme"). The active nav item is a lime pill. On phones: logo, search icon, theme icon and a menu button, each 44px.
- **Footer**: "Slop Bucket reads Hacker News, lobste.rs and GitHub every morning, keeps the AI dev tools and tosses the rest." plus links to How ranking works and About.
- **Theme toggle**: an inline `<head>` script sets `dark` on `<html>` from `localStorage.theme`, falling back to `prefers-color-scheme`, before first paint. The button flips it and saves it. Admin pages leave the script out and stay light.

### Home `/` (artboards: Home · trending, Home · phone)

- **Intro.** An eyebrow with a lime dot: "Updated daily · last run Oct 7, 06:03 UTC" (latest finished daily `source_runs`). H1 "Trending in the bucket", with a lime highlighter band behind "bucket" (`background: linear-gradient(transparent 58%, var(--color-lime-400) 58% 92%, transparent 92%)`; in dark mode use lime-400 at 40% opacity). The subline in the deadpan voice. Three mono stats on the right: In the bucket (published tools), Posts read (all stored posts), Tossed out (dropped posts, shown muted).
- **Filter sidebar** (232–264px; a GET form, so the filter state lives in the URL). In order: License as a segmented control (Any / Open / Closed); Category checkboxes with a color dot and a count; Works with checkboxes with counts plus "Show N more"; the second tag group; GitHub stars as pills (Any, 10+, 100+, 1k+, 10k+); Language and First seen as collapsed `<details>` sections. Counts are faceted over the current result set; options with 0 stay visible but dimmed.
- **List header**: "117 tools, ranked by sources, chatter and star growth." with a How ranking works link, and a Sort select (Trending, Newest, Most stars, Most discussed).
- **Row** (Tailwind Plus stacked list in a rounded card):
  - two-digit mono rank
  - 44px avatar or monogram tile (10px radius)
  - name, which is a stretched link covering the row, so the tag and source links inside sit at `relative z-10`
  - category badge and an "Open source" or "Closed source" (lock icon) badge
  - description, 1 line on desktop and clamped to 2 on phones
  - a mono meta line with source badges (`<abbr title="Hacker News">HN</abbr>`), up to 3 `#tag` links, and "2 posts · today"
  - a right column with ★ stars and "+480 this week" in lime-700. Closed-source tools show "no public repo" instead. Hide the gain until 7 days of `repo_snapshots` exist.
- **Pagination**: "1–25 of 117" with Previous and Next page. Use 25 per page (the canvas shows 12).
- **Phone**: a Filters button and Sort select side by side, then a horizontally scrolling row of category chips (All plus each category), then compact rows (tile with `#rank` under it, name and category badge, 2-line description, then "★ 6.6k +480/wk · GH HN · today").

### Filters slide-over (artboard: Filters sheet · phone)

A right-side panel 344px wide over a dark scrim, using `<el-dialog>` from Tailwind Plus Elements. It has the same sections as the sidebar with 44px rows and 20px checkboxes. The footer is pinned with "Clear all" and a lime "Show 7 tools" button that applies the filters. The count needs a count query, or use "Show results" if that's too much for v1.

### Search `/search` and the list pages (artboard: Search + filters)

- URL params: `q`, `category`, `works`, `platform`, `license`, `stars`, `lang`, `seen`, `sort`, `page`.
- Under the H1 ("2 tools match “worktree”") sits a row of active-filter chips. Each chip is a link to the same URL without that filter. "Clear all" goes home.
- Default sort is Best match (FTS5 `bm25`). Highlight matched text in names and descriptions with FTS5 `highlight()`, styled as `bg-lime-50 shadow-[inset_0_-2px_0_var(--color-lime-400)]` on a `<mark>`. Only real matches get highlighted.
- Optional hint below the results when a filter is hiding matches: "1 more tool matches “worktree” without the Claude Code filter. Show D-Engine". That's one extra count query per active filter, which is cheap at this size.
- Empty state (Tweaks → `empty` on the canvas): a "0 RESULTS" pill, "The bucket is empty for this one.", "Nothing matches “…” with these three filters. Removing one usually helps.", chips that drop each filter, and "Or browse what's trending".
- `/new`, `/category/[name]` and `/tag/[slug]` reuse this layout with their own H1 and a one-line description.

### Tool page `/tools/[slug]` (artboards: Tool page · Pi, Tool page · phone)

- Breadcrumb in mono: Trending / {Category} / {Name}.
- **Header**: 80px tile or avatar, H1, category badge, open/closed badge, the one-line description, tag chips. Actions: a lime "Visit {domain}" button and a secondary "View source" button when there's a repo.
- **At a glance** (description list card): stars with the 7-day gain, license, language, repository, homepage, first seen. Closed-source tools leave out the GitHub rows.
- **Timeline**, newest first. Each entry is a date column, a marker on a vertical line, and a card.
  - Releases: lime marker with a tag icon, a "RELEASE" label and the version.
  - Launch, discussion and news: neutral marker and label.
  - Each card has the title linked to the post URL, the domain, "Hacker News · 686 points · 362 comments", and "posted by {author}". HN entries get "Read the HN thread", linking to `news.ycombinator.com/item?id={external_id}`.
  - The list ends with "First spotted {date} on {source}".
- **Report link** in the aside ("Something wrong with this listing? Report it") opens the report dialog.

### Report dialog (artboard: Report this · phone)

A centered `<el-dialog>` on desktop and a bottom sheet on phones.
- Title "Report {Tool}", with the subline "Tell us what's wrong with this listing. A person reads every report."
- Reasons as radio cards with a hint each:
  - Not an AI coding tool
  - Wrong merge (two different tools ended up on one page)
  - Spam
  - Broken link
- An optional note, the Turnstile widget, Cancel, and "Send report" (disabled until a reason is picked).
- Success state: "Report sent", "Thanks. It's in the admin queue, and the listing stays up until someone looks at it.", and "Back to {Tool}".
- Rate-limited as DESIGN.md says.

## Admin

Same tokens and type, light only. It still ships no JavaScript: every action is a link or a form POST.

- **Sections**: Queue (count), Tools (count), Tags, Reports (open count), Status, Settings.
- **Phone**: a 52px top bar (logo, "ADMIN" chip, View site link), then underline tabs that scroll sideways. The active tab is `border-stone-900` and its count chip is lime.
- **Desktop (`lg`+)**: a dark sidebar (`bg-stone-900`, 240px) with icon, label and count, and the active item on `bg-white/10`. View public site sits at the bottom.

### Queue item (artboards: Admin · review queue, Admin desktop · queue split view)

These are changes to the current page.
- **Resolves to** box: the existing tool's name, post count and status, or a lime "New tool" badge with "No repo, domain or name matched, so this post creates it."
- **Model's reason**: a plain block quote under a mono "MODEL'S REASON" label. Drop the left-border accent box.
- **Tags**: in-vocabulary tags as chips; tags not in the vocabulary struck through, with "Struck tags aren't in your tag list and get dropped on approve. Review suggestions" linking to Tags.
- **Approve and Reject**: Approve is the lime fill with a check icon; Reject stays a red outline. The sticky bottom bar and the few-shot checkbox are unchanged.
- **Desktop**: a filter bar (source, confidence band, order), a 360px list of queued posts (2-line title, source badge, tool name, age, confidence pill), and the detail pane. The detail pane has actions top right and the extracted text open by default in a scroll box. Keyboard shortcuts (A, R, S) are optional extras and need a few lines of JS; every action must still work without them.

### Tools `/admin/tools` (artboard: Admin desktop · tools)

- Search by name, repo or domain (through `tool_aliases`).
- Status tabs with counts (All, Published, Queued, Hidden), a category select, and Sort.
- Table columns: tool (tile, name, repo in mono), category, status chip, posts, last post, source (open/closed), Edit.
- On phones the table becomes a stacked list.

### Edit tool `/admin/tools/[id]` (artboard: Admin · edit tool)

- **Form**: name, slug, a one-line description with a live "96 / 140" counter and the hint "Describe the tool, not a post.", category select, a tag picker limited to the vocabulary, homepage, GitHub repo, Open source / Closed segmented control, and Save changes.
- **Aliases**: kind chip (repo, domain, name), value, a 44px remove button, and "+ Add alias". Aliases that came from a merge say "via merge".
- **Merge history**: each un-undone `tool_merges` row where this tool is the target, with "Split back out".
- **Posts**: title, source, date and type, with Move (the existing reassign flow) and "Show all".
- **Other actions**: "Merge into another tool" and "Hide this tool" (red outline), with "Hidden tools disappear from public pages. Their posts stay linked, so new posts about them stay hidden too."

### Merge `/admin/tools/[id]/merge` (artboard: Admin · merge tools)

- Search for the tool to keep, then pick it from radio cards (tile, name, "CLI · 5 posts · anthropics/claude-code").
- A "What moves to {target}" summary lists the posts and aliases.
- Footer text: "The old page redirects to {target}. You can undo this later with Split on {target}'s page."
- Buttons: "Merge into {target}" and Cancel.

### Tags and categories `/admin/taxonomy` (artboard: Admin · tags & categories)

- A Tags / Categories segmented control (two links, `?view=`).
- **Tags**: one card per group. Each row shows the label, the `#slug` in mono, a count and a chevron, with "+ Add to {group}" at the end. Under the groups, **Suggested by the model** lists tags the classifier proposed that aren't in the vocabulary, with counts, plus "Map to…" (alias it to an existing tag) and Add. A note says language tags are ignored because the Language filter reads GitHub.
- **Categories**: each row has a color dot, label, slug, count and an edit button, with "+ Add category" at the end. A note: "Other always stays last and always goes to review. After changing categories, re-classify the queue from Status." Show a warning card when Other holds more than 20% of tools (it held 46% before v3).

### Reports `/admin/reports` (artboard: Admin · reports)

- Open reports, newest first. Each card has the reason chip, age, a tool link, the visitor's note as a quote, "Open tool" and a lime "Resolve" (form POST).
- Empty state: "No open reports" / "Nobody has complained about anything. Enjoy it."
- "Show resolved reports" at the bottom.

### Status (artboard: Admin · status)

A restyle of the existing page, with no new behavior.
- Title row with the model ID in mono and Refresh.
- **In progress**: classifying (waiting count, rate, ETA) and one card per operation, with lime progress bars.
- **Sources**: one card per source with a status mark (round green dot for OK, amber diamond for a warning, so shape differs too), last run, items, duration and Run now. A drop warning sits in an amber panel: "33 items is 82% below this source's 7-day average of 184. Check the adapter or run it again." Product Hunt shows as a muted "Off until API access is granted" card.
- **Jobs**: Start a backfill and Re-classify the queue, each leading to its existing confirmation step.

Settings keeps its current forms with the new tokens.

## Copy rules

- The jokes live in a few places: the hero subline, the "Tossed out" stat, the footer, empty states and the mascot. Errors, admin messages and form labels stay plain.
- Name things by what visitors recognize ("Works with", "Open source"), not by schema names.
- Buttons say what happens: "Send report", "Merge into Claude Code", "Split back out", "Show 7 tools".
- The public site never shows confidence or whether an entry was auto-classified (DESIGN.md).

## Accessibility

- Text meets 4.5:1 (3:1 at 24px and up) in both themes. See the contrast rules under Tokens.
- Touch targets are at least 44px on phones: rows, chips, tabs, icon buttons, checkboxes (20px box inside a 44px row).
- Use real `<a>`, `<button>`, `<input>` and `<label>` elements. Icon-only buttons get `aria-label`. Source badges use `<abbr title>`. Segmented controls are radio groups, and progress bars set `role="progressbar"` with values.
- Every interactive element gets a visible `focus-visible` outline.
- Color is never the only signal: categories carry labels, statuses carry text, and warnings use a different shape.

## Changes DESIGN.md needs

Each of these goes in the same PR as the UI that needs it.

1. **Name**: Slop Bucket replaces "AI Coding Tools Radar".
2. **Tag vocabulary**: a new `tags` setting (groups of `{slug, label}`) with a zod schema. The classifier prompt and JSON schema enum the vocabulary (like categories), and unknown tags are stored as suggestions. Add a migration that maps existing free-form tags onto the vocabulary. New public filters by tag group, and `/tag/[slug]`.
3. **Admin sections**: Tags and Reports are new pages, and the Tools list gets search and status tabs. The admin layout at `lg` and up becomes a sidebar layout (still no JS).
4. **Avatars**: a site route such as `/avatar/[owner]` that returns the GitHub owner's avatar (`github.com/{owner}.png?size=88`) or an SVG monogram when there is none, cached at the edge. That gives a fallback without client JS and keeps visitors' browsers off GitHub.
5. **Merge redirects**: a merged tool's slug redirects (301) to the target. Split removes the redirect.
6. **Home stats and last-run time**, read from `tools`, `posts` and `source_runs`.
7. **Faceted counts** for filters, and FTS5 `highlight()` for search results.
8. **Theme**: light and dark, with a small inline script on public pages only.

## Suggested build order

Each step is one small PR, per CLAUDE.md.

1. Tokens, fonts, base layout (header, footer, theme toggle), and category labels and hues in `packages/core`.
2. Home trending list, the row component and the avatar route.
3. Filter sidebar, `/search` with URL state, the mobile filter dialog, `/new`, `/category/[name]`.
4. Tool page and report dialog.
5. Admin restyle: new nav, queue item changes, lime Approve.
6. Admin tools list, edit, merge and split, with merge redirects.
7. Tag vocabulary: setting, classifier, migration, Tags admin page, public tag filters and `/tag/[slug]`.
8. Reports admin page.
9. Desktop admin shell and queue split view.

## Data notes from the Oct 7 pass

- Some tool descriptions describe a post rather than the tool. Claude Code's reads "Anthropic's command-line coding agent; this thread discusses ECONNRESET errors users are seeing." The edit page's hint helps; a classifier prompt tweak ("describe the tool, not this post") would prevent it.
- Claude Code has a name alias `claudeapiplugin`, picked up from a post about an evals plugin. It's a good first test of the alias remove and Move flows.
- Before categories v3, Other held 46% of tools, mostly Claude Code add-ons. v3 targets exactly that.
