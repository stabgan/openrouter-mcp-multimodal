#!/usr/bin/env node
/**
 * Harvest npm / Docker Hub / GitHub-traffic metrics and write:
 *   metrics/snapshots/<YYYY-MM-DD>.json — full dated snapshot
 *   metrics/history.csv                  — append-only rolling CSV
 *
 * Invoked by .github/workflows/metrics.yml on a daily cron. Runs from
 * the `metrics` branch checkout; the workflow points us here via
 * `node ../main/scripts/harvest-metrics.mjs` so this file lives in
 * main-branch source.
 *
 * Config is read from env:
 *   REPO     — "<owner>/<repo>" (e.g. stabgan/openrouter-mcp-multimodal)
 *   GH_TOKEN — token with `repo` scope (GITHUB_TOKEN from Actions works)
 *
 * All 3rd-party endpoints are public; only GitHub traffic needs auth.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

const REPO = process.env.REPO;
const GH_TOKEN = process.env.GH_TOKEN;
if (!REPO) throw new Error('REPO env var required (e.g. owner/repo)');
if (!GH_TOKEN) throw new Error('GH_TOKEN env var required');

// Hardcode the npm + Docker coordinates. They differ from the GitHub repo
// slug and we'd rather be explicit than guess.
const NPM_PKG = '@stabgan/openrouter-mcp-multimodal';
const DOCKER_REPO = 'stabgan/openrouter-mcp-multimodal';

const TODAY = new Date().toISOString().slice(0, 10); // YYYY-MM-DD in UTC

async function getJSON(url, headers = {}) {
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}: ${await r.text()}`);
  return r.json();
}

async function harvestNpm() {
  const encoded = encodeURIComponent(NPM_PKG);
  // Point-in-time counters (matches npmjs.com frontend)
  const [day, week, month] = await Promise.all([
    getJSON(`https://api.npmjs.org/downloads/point/last-day/${encoded}`),
    getJSON(`https://api.npmjs.org/downloads/point/last-week/${encoded}`),
    getJSON(`https://api.npmjs.org/downloads/point/last-month/${encoded}`),
  ]);
  // All-time range since the first published version date. npm rejects
  // unbounded ranges, so we anchor to a historical floor and let the
  // range endpoint return zeros for pre-publish days.
  const rangeStart = '2025-07-01';
  const range = await getJSON(
    `https://api.npmjs.org/downloads/range/${rangeStart}:${TODAY}/${encoded}`,
  );
  const alltime = (range.downloads ?? []).reduce((a, d) => a + d.downloads, 0);

  // Version-level metadata for release cadence correlation
  const registry = await getJSON(`https://registry.npmjs.org/${encoded}`);
  const versionTimes = registry.time ?? {};
  const versions = Object.keys(versionTimes)
    .filter((v) => v !== 'created' && v !== 'modified')
    .sort((a, b) => new Date(versionTimes[a]) - new Date(versionTimes[b]));
  const latest = registry['dist-tags']?.latest ?? null;

  return {
    pkg: NPM_PKG,
    last_day: day.downloads ?? 0,
    last_week: week.downloads ?? 0,
    last_month: month.downloads ?? 0,
    alltime_since: rangeStart,
    alltime_downloads: alltime,
    version_count: versions.length,
    latest_version: latest,
    latest_published_at: latest ? versionTimes[latest] : null,
    daily_series: range.downloads ?? [], // full [{day, downloads}] history
  };
}

async function harvestDocker() {
  const repo = await getJSON(
    `https://hub.docker.com/v2/repositories/${DOCKER_REPO}/`,
  );
  const tags = await getJSON(
    `https://hub.docker.com/v2/repositories/${DOCKER_REPO}/tags/?page_size=100`,
  );
  return {
    repo: DOCKER_REPO,
    pull_count: repo.pull_count ?? 0,
    star_count: repo.star_count ?? 0,
    last_updated: repo.last_updated ?? null,
    date_registered: repo.date_registered ?? null,
    tag_count: tags.count ?? 0,
    recent_tags: (tags.results ?? []).slice(0, 10).map((t) => ({
      name: t.name,
      pushed: t.tag_last_pushed,
      size_bytes: t.full_size,
    })),
  };
}

async function harvestGitHub() {
  const headers = {
    Authorization: `Bearer ${GH_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const base = `https://api.github.com/repos/${REPO}`;
  const [meta, clones, views, referrers, paths] = await Promise.all([
    getJSON(base, headers),
    getJSON(`${base}/traffic/clones`, headers),
    getJSON(`${base}/traffic/views`, headers),
    getJSON(`${base}/traffic/popular/referrers`, headers),
    getJSON(`${base}/traffic/popular/paths`, headers),
  ]);
  // Stargazer timestamps (first 100 only — good enough for current scale).
  // The `star+json` accept header adds `starred_at` to each entry.
  const stars = await getJSON(`${base}/stargazers?per_page=100`, {
    ...headers,
    Accept: 'application/vnd.github.star+json',
  });
  return {
    repo: REPO,
    stars: meta.stargazers_count,
    forks: meta.forks_count,
    watchers: meta.subscribers_count,
    open_issues: meta.open_issues_count,
    size_kb: meta.size,
    created_at: meta.created_at,
    pushed_at: meta.pushed_at,
    clones_14d: {
      total: clones.count,
      unique: clones.uniques,
      daily: clones.clones,
    },
    views_14d: {
      total: views.count,
      unique: views.uniques,
      daily: views.views,
    },
    referrers: referrers, // already an array of {referrer, count, uniques}
    popular_paths: paths, // array of {path, title, count, uniques}
    stargazers: stars.map((s) => ({
      login: s.user?.login ?? null,
      starred_at: s.starred_at ?? null,
    })),
  };
}

async function main() {
  const snapshot = {
    captured_at: new Date().toISOString(),
    date: TODAY,
    npm: await harvestNpm(),
    docker: await harvestDocker(),
    github: await harvestGitHub(),
  };

  // Write dated snapshot. Overwrite silently if re-run on the same UTC day
  // (manual workflow_dispatch, for example).
  const snapDir = 'metrics/snapshots';
  await fs.mkdir(snapDir, { recursive: true });
  const snapPath = path.join(snapDir, `${TODAY}.json`);
  await fs.writeFile(snapPath, JSON.stringify(snapshot, null, 2) + '\n');
  console.log(`wrote ${snapPath}`);

  // Append to rolling CSV. Lean columns — the snapshots hold the full
  // payload; the CSV is for quick charting in a spreadsheet.
  const csvPath = 'metrics/history.csv';
  const header =
    'date,npm_day,npm_week,npm_month,npm_alltime,npm_latest,docker_pulls,docker_tags,' +
    'gh_stars,gh_forks,gh_views_14d,gh_views_unique_14d,gh_clones_14d,gh_clones_unique_14d\n';
  const row = [
    TODAY,
    snapshot.npm.last_day,
    snapshot.npm.last_week,
    snapshot.npm.last_month,
    snapshot.npm.alltime_downloads,
    snapshot.npm.latest_version,
    snapshot.docker.pull_count,
    snapshot.docker.tag_count,
    snapshot.github.stars,
    snapshot.github.forks,
    snapshot.github.views_14d.total,
    snapshot.github.views_14d.unique,
    snapshot.github.clones_14d.total,
    snapshot.github.clones_14d.unique,
  ].join(',');

  let existing = '';
  try {
    existing = await fs.readFile(csvPath, 'utf8');
  } catch {
    /* first run — file will be created */
  }
  if (!existing) {
    await fs.writeFile(csvPath, header + row + '\n');
  } else {
    // If today's row already exists, replace it; else append.
    const lines = existing.split('\n').filter(Boolean);
    const kept = lines.filter((l, i) => i === 0 || !l.startsWith(`${TODAY},`));
    kept.push(row);
    await fs.writeFile(csvPath, kept.join('\n') + '\n');
  }
  console.log(`updated ${csvPath}`);
}

main().catch((err) => {
  console.error('harvest failed:', err);
  process.exit(1);
});
