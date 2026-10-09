# Use cases

Static site for the top 15 use cases people post about for consumer AI agent products.

`data/` is updated daily by an external pipeline that commits new JSON files only. There is no site build. A push to `main` publishes the files that are already in the repo.

Until those files exist, the site shows "No data yet".

## Run locally

From the repository root:

```bash
python3 -m http.server
```

Open the URL the server prints. For a local preview with fake data, see below. Do not commit that fake data.

## Pages

GitHub Actions deploys on every push to `main` (`.github/workflows/pages.yml`). The workflow checks the JSON, copies `index.html`, `css/`, `js/`, and `data/` unchanged, then uploads that directory with `actions/upload-pages-artifact` and publishes it with `actions/deploy-pages`. Pages itself is enabled outside this repo (build type: workflow).

## Data contract

All files are UTF-8 JSON. When any JSON file is present, these files are required:

- `data/index.json`
- `data/products.json`
- `data/taxonomy.json`
- `data/posts.json`
- `data/snapshots/YYYY-MM-DD.json` for every date listed in `index.json`

`data/index.json`

```json
{
  "updated": "ISO-8601 timestamp",
  "snapshots": ["YYYY-MM-DD"],
  "products": ["product-id"],
  "taxonomy_version": 1,
  "method": "Plain-text method note."
}
```

`snapshots` is ascending and unique. `products` is the ordered list of product ids. The page reads product names from `products.json`. It does not hardcode a product list. `method` is shown in the footer. `updated` is shown in Pacific time (`America/Los_Angeles`).

`data/products.json` is a list of:

```json
{
  "id": "product-id",
  "name": "Display name",
  "maker": "Maker",
  "launched": "Launch label",
  "source_url": "https://example.com/product",
  "verified": false,
  "note": "Short note."
}
```

The set of ids matches `index.json` `products`. `verified` is a boolean. `source_url` is an empty string or an `http`/`https` URL.

`data/taxonomy.json`

```json
{
  "version": 1,
  "categories": [
    {
      "code": "inbox",
      "label": "Inbox",
      "definition": "What this category means.",
      "added": "YYYY-MM-DD"
    }
  ],
  "changelog": [{ "date": "YYYY-MM-DD", "change": "What changed." }]
}
```

`version` matches `taxonomy_version`. Category codes are unique.

`data/posts.json` is a list of:

```json
{
  "id": "post-id",
  "url": "https://example.com/post",
  "post_platform": "Platform name",
  "agent_product": "product-id",
  "use_cases": ["inbox"],
  "date": "YYYY-MM-DD",
  "first_seen": "ISO-8601 timestamp",
  "author": "handle",
  "quote": "Verbatim quote.",
  "sentiment": "label"
}
```

`agent_product` is a known product id. Each `use_cases` entry is a known category code. The list may be empty. Platform names are not fixed; the filter lists whatever appears in the file.

`data/snapshots/YYYY-MM-DD.json`

```json
{
  "date": "YYYY-MM-DD",
  "cumulative": true,
  "basis": "How the snapshot was counted.",
  "totals": {
    "all": { "posts": 0, "use_case_posts": 0 },
    "product-id": { "posts": 0, "use_case_posts": 0 }
  },
  "top15": {
    "all": [{ "code": "inbox", "label": "Inbox", "count": 0, "share": 0 }],
    "product-id": []
  }
}
```

The filename date, the `date` field, and the `index.json` entry match. `totals` and `top15` include `all` and every product id. Each top list is rank order (first is rank 1), at most 15 rows, with non-increasing `count`. `share` is a non-negative number. The page treats shares as fractions of 1 when every share in that list is at most 1, and as percents otherwise.

Extra fields are ignored. Unknown JSON files are ignored.

## Validate

```bash
python3 scripts/validate_data.py
python3 scripts/validate_data.py --self-test
```

Exit 0 prints `No data yet.` when `data/` has no JSON. Exit 1 lists contract errors. `--data-dir` checks another directory.

## Local fixture

`scripts/make_fixture.py` writes invented posts and counts to `fixtures/`, which is gitignored. `scripts/serve_fixture.py` serves that folder at `/data/` so the real `data/` directory stays empty.

```bash
python3 scripts/make_fixture.py
python3 scripts/serve_fixture.py
```

## Views

Top 15: product control, date slider, and play control. The bars move with transform and opacity only. Hover or tap a bar for the category definition and a link to the matching posts.

Posts: date, platform, product, use case, quote, author, and a link to the original post. Column headers sort date, platform, product, and use case. Filters and the quote search are stored in the URL hash.

- `#top`
- `#top?product=product-id&date=YYYY-MM-DD`
- `#posts?platform=&product=&use=&q=&sort=&dir=&page=`

The posts table shows 100 rows per page.
