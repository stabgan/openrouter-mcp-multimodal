# Metrics time series

This branch is machine-written by `.github/workflows/metrics.yml`.
Do not edit by hand. Each daily run writes:

- `metrics/snapshots/YYYY-MM-DD.json` — full snapshot
- `metrics/history.csv`               — append-only rolling CSV

Data sources: npm registry downloads API, Docker Hub v2 API,
GitHub repo traffic API. All public, no credentials beyond the
default `GITHUB_TOKEN` for traffic endpoints.
