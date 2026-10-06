const TRACKING_PARAMS = /^(utm_.*|ref|ref_src|fbclid|gclid|mc_cid|mc_eid)$/i;

// First path segments on github.com that are not owner names.
const GITHUB_RESERVED = new Set([
  "about", "apps", "collections", "customer-stories", "enterprise", "events", "explore", "features",
  "login", "marketplace", "new", "orgs", "pricing", "settings", "sponsors", "topics", "trending",
]);

// Hosts shared by many unrelated projects; a homepage here says nothing about tool identity.
const GENERIC_HOSTS = [
  "github.com", "github.io", "gitlab.com", "gitlab.io", "bitbucket.org", "codeberg.org",
  "vercel.app", "netlify.app", "pages.dev", "workers.dev", "fly.dev", "onrender.com", "herokuapp.com",
  "replit.app", "huggingface.co", "medium.com", "substack.com", "dev.to", "hashnode.dev", "notion.site",
  "npmjs.com", "pypi.org", "crates.io", "marketplace.visualstudio.com", "open-vsx.org",
  "chromewebstore.google.com", "apps.apple.com", "play.google.com", "youtube.com", "youtu.be",
  "x.com", "twitter.com", "linkedin.com", "reddit.com", "news.ycombinator.com", "lobste.rs",
  "producthunt.com", "itch.io", "google.com", "docs.google.com",
];

export function parseUrl(raw: string): URL | null {
  try {
    const url = new URL(raw.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

export function hostOf(raw: string): string | null {
  const url = parseUrl(raw);
  return url ? url.hostname.toLowerCase().replace(/^www\./, "") : null;
}

export function isGenericHost(host: string): boolean {
  return GENERIC_HOSTS.some((g) => host === g || host.endsWith(`.${g}`));
}

/** "owner/repo" (lowercase) for a github.com repo URL, else null. */
export function githubRepoFromUrl(raw: string): string | null {
  const url = parseUrl(raw);
  if (!url || hostOf(raw) !== "github.com") return null;
  const [owner, repo] = url.pathname.split("/").filter(Boolean);
  if (!owner || !repo || GITHUB_RESERVED.has(owner.toLowerCase())) return null;
  return `${owner}/${repo.replace(/\.git$/, "")}`.toLowerCase();
}

/** Accepts "owner/repo" or any GitHub repo URL; returns lowercase "owner/repo" or null. */
export function normalizeGithubRepo(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  if (/^[\w.-]+\/[\w.-]+$/.test(v)) return v.replace(/\.git$/, "").toLowerCase();
  return githubRepoFromUrl(v.startsWith("http") ? v : `https://${v}`);
}

/** URL used for dedupe: https, no www, no fragment or tracking params; GitHub reduced to owner/repo. */
export function canonicalUrl(raw: string): string {
  const repo = githubRepoFromUrl(raw);
  if (repo) return `https://github.com/${repo}`;
  const url = parseUrl(raw);
  if (!url) return raw.trim();
  url.protocol = "https:";
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
  const out = url.toString();
  return url.pathname === "/" && !url.search ? out.slice(0, -1) : out;
}
