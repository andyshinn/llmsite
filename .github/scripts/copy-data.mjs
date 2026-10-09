// One-off helper for .github/workflows/rename.yml: copies the radar-* data into the
// sb-* resources. Talks to the Cloudflare REST API directly because
// `wrangler d1 export` refuses databases with virtual tables (tools_fts).
//
//   node copy-data.mjs dump <db> <out.sql>          data-only SQL for every app table
//   node copy-data.mjs verify <from-db> <to-db>     row counts match, search index filled
//   node copy-data.mjs r2-copy <db> <from> <to>     copy text/<post id>.txt objects
//   node copy-data.mjs r2-delete <db> <bucket>      delete them (so the bucket can be removed)
//
// Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.

import { writeFileSync } from "node:fs";

const { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account } = process.env;
if (!token || !account) throw new Error("CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required");
const api = `https://api.cloudflare.com/client/v4/accounts/${account}`;
const auth = { Authorization: `Bearer ${token}` };

// Parents before children (foreign keys). The target's schema, FTS triggers and
// d1_migrations come from applying migrations/, so they are not copied; inserting
// into tools fills tools_fts through its trigger.
const TABLES = [
  "tools",
  "tool_aliases",
  "tool_merges",
  "posts",
  "post_snapshots",
  "repo_snapshots",
  "review_decisions",
  "reports",
  "source_runs",
  "operations",
  "settings",
];
const SKIP = /^(sqlite_|_cf_|d1_migrations$|tools_fts)/;
const PAGE = 500;

async function call(path, init = {}) {
  const res = await fetch(`${api}${path}`, { ...init, headers: { ...auth, ...init.headers } });
  const body = await res.json();
  if (!body.success) throw new Error(`${init.method ?? "GET"} ${path}: ${JSON.stringify(body.errors)}`);
  return body.result;
}

async function dbId(name) {
  const found = (await call(`/d1/database?name=${encodeURIComponent(name)}`)).find((d) => d.name === name);
  if (!found) throw new Error(`D1 database ${name} not found`);
  return found.uuid;
}

async function query(id, sql, params = []) {
  const [result] = await call(`/d1/database/${id}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sql, params }),
  });
  return result.results;
}

const literal = (v) => {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error(`Cannot copy number ${v}`);
    return String(v);
  }
  if (typeof v === "string") return `'${v.replaceAll("'", "''")}'`;
  throw new Error(`Cannot copy value of type ${typeof v}`);
};

async function dump(name, out) {
  const id = await dbId(name);
  const tables = (await query(id, "SELECT name FROM sqlite_master WHERE type = 'table'")).map((r) => r.name);
  const unknown = tables.filter((t) => !SKIP.test(t) && !TABLES.includes(t));
  if (unknown.length) throw new Error(`Tables not in copy-data.mjs: ${unknown.join(", ")}. Add them to TABLES.`);

  // Clearing first makes a re-run replace what an earlier run copied (and the
  // settings rows the migrations seeded) instead of failing on duplicate keys.
  const lines = ["PRAGMA defer_foreign_keys = true;"];
  for (const t of [...TABLES].reverse()) lines.push(`DELETE FROM ${t};`);
  for (const t of TABLES) {
    let last = Number.MIN_SAFE_INTEGER;
    let count = 0;
    for (;;) {
      const rows = await query(id, `SELECT rowid AS _rowid, * FROM ${t} WHERE rowid > ? ORDER BY rowid LIMIT ${PAGE}`, [last]);
      for (const { _rowid, ...row } of rows) {
        const cols = Object.keys(row);
        lines.push(`INSERT INTO ${t} (${cols.join(", ")}) VALUES (${cols.map((c) => literal(row[c])).join(", ")});`);
        last = _rowid;
      }
      count += rows.length;
      if (rows.length < PAGE) break;
    }
    console.log(`${t}: ${count} rows`);
  }
  writeFileSync(out, lines.join("\n") + "\n");
}

async function counts(id) {
  const sql = TABLES.map((t) => `SELECT '${t}' AS t, count(*) AS n FROM ${t}`).join(" UNION ALL ");
  return Object.fromEntries((await query(id, sql)).map((r) => [r.t, r.n]));
}

async function verify(from, to) {
  const [a, b] = await Promise.all([dbId(from), dbId(to)]);
  const [ca, cb] = await Promise.all([counts(a), counts(b)]);
  let ok = true;
  for (const t of TABLES) {
    const same = ca[t] === cb[t];
    ok &&= same;
    console.log(`${same ? "ok  " : "DIFF"} ${t}: ${from} ${ca[t]}, ${to} ${cb[t]}`);
  }
  const [{ n: fts }] = await query(b, "SELECT count(*) AS n FROM tools_fts");
  console.log(`${fts === cb.tools ? "ok  " : "DIFF"} tools_fts: ${fts} (tools ${cb.tools})`);
  if (!ok || fts !== cb.tools) throw new Error("Copy does not match the source");
}

async function postIds(db) {
  return (await query(await dbId(db), "SELECT id FROM posts ORDER BY id")).map((r) => r.id);
}

// Runs fn over items, `limit` at a time.
async function pool(items, limit, fn) {
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < items.length) await fn(items[next++]);
    }),
  );
}

async function withRetry(fn) {
  try {
    return await fn();
  } catch {
    await new Promise((r) => setTimeout(r, 2000));
    return fn();
  }
}

const objectPath = (bucket, id) => `${api}/r2/buckets/${bucket}/objects/text/${id}.txt`;

async function r2Copy(db, from, to) {
  const ids = await postIds(db);
  let copied = 0;
  await pool(ids, 16, (id) =>
    withRetry(async () => {
      const get = await fetch(objectPath(from, id), { headers: auth });
      if (get.status === 404) return;
      if (!get.ok) throw new Error(`GET ${from} text/${id}.txt: ${get.status}`);
      const put = await fetch(objectPath(to, id), {
        method: "PUT",
        headers: { ...auth, "Content-Type": "text/plain; charset=utf-8" },
        body: await get.arrayBuffer(),
      });
      if (!put.ok) throw new Error(`PUT ${to} text/${id}.txt: ${put.status} ${await put.text()}`);
      copied++;
    }),
  );
  console.log(`Copied ${copied} of ${ids.length} possible objects from ${from} to ${to}`);
}

async function r2Delete(db, bucket) {
  const ids = await postIds(db);
  await pool(ids, 16, (id) =>
    withRetry(async () => {
      const res = await fetch(objectPath(bucket, id), { method: "DELETE", headers: auth });
      if (!res.ok && res.status !== 404) throw new Error(`DELETE ${bucket} text/${id}.txt: ${res.status}`);
    }),
  );
  console.log(`Deleted text objects for ${ids.length} posts from ${bucket}`);
}

const [cmd, ...args] = process.argv.slice(2);
const commands = { dump, verify, "r2-copy": r2Copy, "r2-delete": r2Delete };
if (!commands[cmd]) throw new Error(`Unknown command ${cmd}. Use ${Object.keys(commands).join(", ")}.`);
await commands[cmd](...args);
