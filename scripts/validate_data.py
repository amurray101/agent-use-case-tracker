#!/usr/bin/env python3
"""Check data/*.json against the site contract.

Run from anywhere:

    python3 scripts/validate_data.py
    python3 scripts/validate_data.py --data-dir path/to/data
    python3 scripts/validate_data.py --self-test

Exit 0 when data/ is missing or has no JSON ("No data yet"), or when every
file matches the contract. Exit 1 when JSON is present but invalid.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import tempfile
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATE_RE_LEN = 10
REQUIRED = ("index.json", "products.json", "taxonomy.json", "posts.json")


def fail(errors: list[str], message: str) -> None:
    errors.append(message)


def is_number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def is_whole(value: object) -> bool:
    return is_number(value) and float(value).is_integer() and float(value) >= 0


def is_str(value: object) -> bool:
    return isinstance(value, str)


def check_date(errors: list[str], value: object, where: str) -> bool:
    if not is_str(value) or len(value) != DATE_RE_LEN or value[4] != "-" or value[7] != "-":
        fail(errors, f"{where}: expected YYYY-MM-DD")
        return False
    try:
        datetime.strptime(value, "%Y-%m-%d")
    except ValueError:
        fail(errors, f"{where}: not a calendar date")
        return False
    return True


def check_timestamp(errors: list[str], value: object, where: str) -> None:
    if not is_str(value) or not value.strip():
        fail(errors, f"{where}: expected ISO-8601 timestamp")
        return
    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        datetime.fromisoformat(text)
    except ValueError:
        fail(errors, f"{where}: expected ISO-8601 timestamp")


def load_json(errors: list[str], path: Path):
    try:
        with path.open(encoding="utf-8") as handle:
            return json.load(handle)
    except FileNotFoundError:
        fail(errors, f"{path.name}: missing")
    except json.JSONDecodeError as exc:
        fail(errors, f"{path.name}: invalid JSON ({exc.msg})")
    except UnicodeDecodeError:
        fail(errors, f"{path.name}: expected UTF-8")
    return None


def require_keys(errors: list[str], obj: dict, keys: tuple[str, ...], where: str) -> None:
    for key in keys:
        if key not in obj:
            fail(errors, f"{where}: missing {key}")


def validate_index(errors: list[str], index) -> list[str]:
    if not isinstance(index, dict):
        fail(errors, "index.json: expected an object")
        return []
    require_keys(errors, index, ("updated", "snapshots", "products", "taxonomy_version", "method"), "index.json")
    check_timestamp(errors, index.get("updated"), "index.json updated")
    if "method" in index and not is_str(index["method"]):
        fail(errors, "index.json method: expected a string")
    version = index.get("taxonomy_version")
    if "taxonomy_version" in index and (isinstance(version, bool) or not isinstance(version, int)):
        fail(errors, "index.json taxonomy_version: expected an integer")
    products = index.get("products")
    product_ids: list[str] = []
    if not isinstance(products, list):
        fail(errors, "index.json products: expected a list")
    else:
        seen: set[str] = set()
        for i, pid in enumerate(products):
            if not is_str(pid) or not pid:
                fail(errors, f"index.json products[{i}]: expected a non-empty string")
                continue
            if pid in seen:
                fail(errors, f"index.json products: duplicate id {pid!r}")
            seen.add(pid)
            product_ids.append(pid)
    snapshots = index.get("snapshots")
    dates: list[str] = []
    if not isinstance(snapshots, list):
        fail(errors, "index.json snapshots: expected a list")
    else:
        seen_dates: set[str] = set()
        for i, day in enumerate(snapshots):
            if check_date(errors, day, f"index.json snapshots[{i}]"):
                if day in seen_dates:
                    fail(errors, f"index.json snapshots: duplicate date {day}")
                seen_dates.add(day)
                dates.append(day)
        if dates != sorted(dates):
            fail(errors, "index.json snapshots: dates must be ascending")
    return product_ids if isinstance(products, list) else []


def validate_products(errors: list[str], products, expected_ids: list[str]) -> None:
    if not isinstance(products, list):
        fail(errors, "products.json: expected a list")
        return
    found: list[str] = []
    seen: set[str] = set()
    for i, row in enumerate(products):
        where = f"products.json[{i}]"
        if not isinstance(row, dict):
            fail(errors, f"{where}: expected an object")
            continue
        require_keys(errors, row, ("id", "name", "maker", "launched", "source_url", "verified", "note"), where)
        pid = row.get("id")
        if not is_str(pid) or not pid:
            fail(errors, f"{where}.id: expected a non-empty string")
        else:
            if pid in seen:
                fail(errors, f"products.json: duplicate id {pid!r}")
            seen.add(pid)
            found.append(pid)
        for key in ("name", "maker", "launched", "note"):
            if key in row and not is_str(row[key]):
                fail(errors, f"{where}.{key}: expected a string")
        if "source_url" in row:
            url = row["source_url"]
            if not is_str(url):
                fail(errors, f"{where}.source_url: expected a string")
            elif url and not (url.startswith("https://") or url.startswith("http://")):
                fail(errors, f"{where}.source_url: expected an http(s) URL")
        if "verified" in row and not isinstance(row["verified"], bool):
            fail(errors, f"{where}.verified: expected a boolean")
    if expected_ids and set(found) != set(expected_ids):
        missing = sorted(set(expected_ids) - set(found))
        extra = sorted(set(found) - set(expected_ids))
        if missing:
            fail(errors, "products.json: missing ids " + ", ".join(missing))
        if extra:
            fail(errors, "products.json: unexpected ids " + ", ".join(extra))


def validate_taxonomy(errors: list[str], taxonomy, version) -> set[str]:
    codes: set[str] = set()
    if not isinstance(taxonomy, dict):
        fail(errors, "taxonomy.json: expected an object")
        return codes
    require_keys(errors, taxonomy, ("version", "categories", "changelog"), "taxonomy.json")
    tax_version = taxonomy.get("version")
    if "version" in taxonomy and (isinstance(tax_version, bool) or not isinstance(tax_version, int)):
        fail(errors, "taxonomy.json version: expected an integer")
    elif isinstance(version, int) and not isinstance(version, bool) and tax_version != version:
        fail(errors, f"taxonomy.json version {tax_version} does not match index taxonomy_version {version}")
    categories = taxonomy.get("categories")
    if not isinstance(categories, list):
        fail(errors, "taxonomy.json categories: expected a list")
    else:
        for i, cat in enumerate(categories):
            where = f"taxonomy.json categories[{i}]"
            if not isinstance(cat, dict):
                fail(errors, f"{where}: expected an object")
                continue
            require_keys(errors, cat, ("code", "label", "definition", "added"), where)
            code = cat.get("code")
            if not is_str(code) or not code:
                fail(errors, f"{where}.code: expected a non-empty string")
            else:
                if code in codes:
                    fail(errors, f"taxonomy.json: duplicate code {code!r}")
                codes.add(code)
            for key in ("label", "definition"):
                if key in cat and (not is_str(cat[key]) or not cat[key].strip()):
                    fail(errors, f"{where}.{key}: expected a non-empty string")
            if "added" in cat:
                check_date(errors, cat.get("added"), f"{where}.added")
    changelog = taxonomy.get("changelog")
    if not isinstance(changelog, list):
        fail(errors, "taxonomy.json changelog: expected a list")
    else:
        for i, change in enumerate(changelog):
            where = f"taxonomy.json changelog[{i}]"
            if not isinstance(change, dict):
                fail(errors, f"{where}: expected an object")
                continue
            require_keys(errors, change, ("date", "change"), where)
            if "date" in change:
                check_date(errors, change.get("date"), f"{where}.date")
            text = change.get("change")
            if "change" in change and (not is_str(text) or not text.strip()):
                fail(errors, f"{where}.change: expected a non-empty string")
    return codes


def validate_posts(errors: list[str], posts, product_ids: set[str], codes: set[str]) -> None:
    if not isinstance(posts, list):
        fail(errors, "posts.json: expected a list")
        return
    seen: set[str] = set()
    for i, post in enumerate(posts):
        where = f"posts.json[{i}]"
        if not isinstance(post, dict):
            fail(errors, f"{where}: expected an object")
            continue
        require_keys(
            errors,
            post,
            ("id", "url", "post_platform", "agent_product", "use_cases", "date", "first_seen", "author", "quote", "sentiment"),
            where,
        )
        pid = post.get("id")
        if not is_str(pid) or not pid:
            fail(errors, f"{where}.id: expected a non-empty string")
        elif pid in seen:
            fail(errors, f"posts.json: duplicate id {pid!r}")
        else:
            seen.add(pid)
        url = post.get("url")
        if "url" in post and (not is_str(url) or not (url.startswith("https://") or url.startswith("http://"))):
            fail(errors, f"{where}.url: expected an http(s) URL")
        platform = post.get("post_platform")
        if "post_platform" in post and (not is_str(platform) or not platform.strip()):
            fail(errors, f"{where}.post_platform: expected a non-empty string")
        agent = post.get("agent_product")
        if "agent_product" in post:
            if not is_str(agent) or not agent:
                fail(errors, f"{where}.agent_product: expected a product id")
            elif product_ids and agent not in product_ids:
                fail(errors, f"{where}.agent_product: unknown product id {agent!r}")
        uses = post.get("use_cases")
        if "use_cases" in post:
            if not isinstance(uses, list):
                fail(errors, f"{where}.use_cases: expected a list")
            else:
                for j, code in enumerate(uses):
                    if not is_str(code) or not code:
                        fail(errors, f"{where}.use_cases[{j}]: expected a code")
                    elif codes and code not in codes:
                        fail(errors, f"{where}.use_cases[{j}]: unknown code {code!r}")
        if "date" in post:
            check_date(errors, post.get("date"), f"{where}.date")
        for key in ("first_seen", "author", "quote", "sentiment"):
            if key in post and not is_str(post[key]):
                fail(errors, f"{where}.{key}: expected a string")
        if "first_seen" in post and is_str(post["first_seen"]) and not post["first_seen"].strip():
            fail(errors, f"{where}.first_seen: expected a non-empty string")


def validate_snapshot(errors: list[str], snap, path: Path, product_ids: list[str], codes: set[str]) -> None:
    where = f"snapshots/{path.name}"
    if not isinstance(snap, dict):
        fail(errors, f"{where}: expected an object")
        return
    require_keys(errors, snap, ("date", "cumulative", "basis", "totals", "top15"), where)
    stem = path.stem
    if "date" in snap:
        if check_date(errors, snap.get("date"), f"{where} date") and snap["date"] != stem:
            fail(errors, f"{where}: date {snap['date']!r} does not match filename")
    if "cumulative" in snap and not isinstance(snap["cumulative"], bool):
        fail(errors, f"{where} cumulative: expected a boolean")
    if "basis" in snap and not is_str(snap["basis"]):
        fail(errors, f"{where} basis: expected a string")
    keys = ["all", *product_ids]
    totals = snap.get("totals")
    top15 = snap.get("top15")
    if not isinstance(totals, dict):
        fail(errors, f"{where} totals: expected an object")
    else:
        unknown = sorted(set(totals) - set(keys))
        if unknown:
            fail(errors, f"{where} totals: unknown keys {', '.join(unknown)}")
        for key in keys:
            bucket = totals.get(key)
            if not isinstance(bucket, dict):
                fail(errors, f"{where} totals.{key}: expected an object")
                continue
            for field in ("posts", "use_case_posts"):
                if field not in bucket:
                    fail(errors, f"{where} totals.{key}: missing {field}")
                elif not is_whole(bucket[field]):
                    fail(errors, f"{where} totals.{key}.{field}: expected a non-negative integer")
    if not isinstance(top15, dict):
        fail(errors, f"{where} top15: expected an object")
        return
    unknown = sorted(set(top15) - set(keys))
    if unknown:
        fail(errors, f"{where} top15: unknown keys {', '.join(unknown)}")
    for key in keys:
        rows = top15.get(key)
        if not isinstance(rows, list):
            fail(errors, f"{where} top15.{key}: expected a list")
            continue
        if len(rows) > 15:
            fail(errors, f"{where} top15.{key}: {len(rows)} rows exceeds 15")
        seen_codes: set[str] = set()
        counts: list[float] = []
        for i, row in enumerate(rows):
            slot = f"{where} top15.{key}[{i}]"
            if not isinstance(row, dict):
                fail(errors, f"{slot}: expected an object")
                continue
            require_keys(errors, row, ("code", "label", "count", "share"), slot)
            code = row.get("code")
            if not is_str(code) or not code:
                fail(errors, f"{slot}.code: expected a non-empty string")
            else:
                if code in seen_codes:
                    fail(errors, f"{slot}.code: duplicate {code!r}")
                seen_codes.add(code)
                if codes and code not in codes:
                    fail(errors, f"{slot}.code: unknown code {code!r}")
            label = row.get("label")
            if "label" in row and (not is_str(label) or not label.strip()):
                fail(errors, f"{slot}.label: expected a non-empty string")
            count = row.get("count")
            if "count" in row:
                if not is_whole(count):
                    fail(errors, f"{slot}.count: expected a non-negative integer")
                else:
                    counts.append(float(count))
            share = row.get("share")
            if "share" in row and (not is_number(share) or float(share) < 0):
                fail(errors, f"{slot}.share: expected a non-negative number")
        if counts != sorted(counts, reverse=True):
            fail(errors, f"{where} top15.{key}: counts must be non-increasing")


def validate_dir(data_dir: Path) -> tuple[bool, list[str]]:
    """Return (empty, errors). empty is True when there is no JSON to check."""
    if not data_dir.exists():
        return True, []
    json_files = sorted(p for p in data_dir.rglob("*.json") if p.is_file())
    if not json_files:
        return True, []
    errors: list[str] = []
    index_path = data_dir / "index.json"
    index = load_json(errors, index_path) if index_path.is_file() else None
    if index is None and not index_path.is_file():
        fail(errors, "index.json: missing")
    product_ids = validate_index(errors, index) if isinstance(index, dict) else []
    version = index.get("taxonomy_version") if isinstance(index, dict) else None

    products_path = data_dir / "products.json"
    products = load_json(errors, products_path) if products_path.is_file() else None
    if products is None and not products_path.is_file():
        fail(errors, "products.json: missing")
    else:
        validate_products(errors, products, product_ids)

    taxonomy_path = data_dir / "taxonomy.json"
    taxonomy = load_json(errors, taxonomy_path) if taxonomy_path.is_file() else None
    codes: set[str] = set()
    if taxonomy is None and not taxonomy_path.is_file():
        fail(errors, "taxonomy.json: missing")
    else:
        codes = validate_taxonomy(errors, taxonomy, version)

    posts_path = data_dir / "posts.json"
    posts = load_json(errors, posts_path) if posts_path.is_file() else None
    if posts is None and not posts_path.is_file():
        fail(errors, "posts.json: missing")
    else:
        validate_posts(errors, posts, set(product_ids), codes)

    dates = []
    if isinstance(index, dict) and isinstance(index.get("snapshots"), list):
        dates = [d for d in index["snapshots"] if isinstance(d, str)]
    snap_dir = data_dir / "snapshots"
    present = set()
    if snap_dir.is_dir():
        for path in sorted(snap_dir.glob("*.json")):
            present.add(path.stem)
            check_date(errors, path.stem, f"snapshots/{path.name} filename")
            snap = load_json(errors, path)
            if snap is not None:
                validate_snapshot(errors, snap, path, product_ids, codes)
    for day in dates:
        if day not in present:
            fail(errors, f"snapshots/{day}.json: missing")
    return False, errors


def minimal_dataset(root: Path) -> None:
    (root / "snapshots").mkdir(parents=True, exist_ok=True)
    (root / "index.json").write_text(
        json.dumps(
            {
                "updated": "2026-03-02T18:00:00Z",
                "snapshots": ["2026-03-01", "2026-03-02"],
                "products": ["agent-a"],
                "taxonomy_version": 1,
                "method": "Self-test method.",
            }
        ),
        encoding="utf-8",
    )
    (root / "products.json").write_text(
        json.dumps(
            [
                {
                    "id": "agent-a",
                    "name": "Agent A",
                    "maker": "Self-test",
                    "launched": "2026",
                    "source_url": "https://example.com/self-test",
                    "verified": False,
                    "note": "Self-test record.",
                }
            ]
        ),
        encoding="utf-8",
    )
    (root / "taxonomy.json").write_text(
        json.dumps(
            {
                "version": 1,
                "categories": [
                    {
                        "code": "inbox",
                        "label": "Inbox",
                        "definition": "Self-test definition.",
                        "added": "2026-03-01",
                    }
                ],
                "changelog": [{"date": "2026-03-01", "change": "Self-test changelog."}],
            }
        ),
        encoding="utf-8",
    )
    (root / "posts.json").write_text(
        json.dumps(
            [
                {
                    "id": "self-test-1",
                    "url": "https://example.com/self-test/1",
                    "post_platform": "Example",
                    "agent_product": "agent-a",
                    "use_cases": ["inbox"],
                    "date": "2026-03-02",
                    "first_seen": "2026-03-02T00:00:00Z",
                    "author": "self_test",
                    "quote": "Self-test quote.",
                    "sentiment": "neutral",
                }
            ]
        ),
        encoding="utf-8",
    )
    snap = {
        "date": "2026-03-02",
        "cumulative": True,
        "basis": "self-test",
        "totals": {"all": {"posts": 1, "use_case_posts": 1}, "agent-a": {"posts": 1, "use_case_posts": 1}},
        "top15": {
            "all": [{"code": "inbox", "label": "Inbox", "count": 1, "share": 1}],
            "agent-a": [{"code": "inbox", "label": "Inbox", "count": 1, "share": 1}],
        },
    }
    earlier = json.loads(json.dumps(snap))
    earlier["date"] = "2026-03-01"
    earlier["totals"]["all"]["posts"] = 0
    earlier["totals"]["all"]["use_case_posts"] = 0
    earlier["totals"]["agent-a"]["posts"] = 0
    earlier["totals"]["agent-a"]["use_case_posts"] = 0
    earlier["top15"]["all"] = []
    earlier["top15"]["agent-a"] = []
    (root / "snapshots" / "2026-03-01.json").write_text(json.dumps(earlier), encoding="utf-8")
    (root / "snapshots" / "2026-03-02.json").write_text(json.dumps(snap), encoding="utf-8")


def self_test() -> int:
    problems: list[str] = []

    def expect_ok(path: Path, label: str) -> None:
        empty, errors = validate_dir(path)
        if errors:
            problems.append(f"{label}: expected success, got {errors[:3]}")
        return empty

    def expect_fail(path: Path, label: str, needle: str) -> None:
        _empty, errors = validate_dir(path)
        if not errors:
            problems.append(f"{label}: expected failure")
        elif needle not in "\n".join(errors):
            problems.append(f"{label}: expected {needle!r} in {errors[:4]}")

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        empty_dir = root / "empty"
        empty_dir.mkdir()
        if expect_ok(empty_dir, "empty") is not True:
            problems.append("empty: expected the no-data result")
        if expect_ok(root / "missing", "missing") is not True:
            problems.append("missing: expected the no-data result")

        good = root / "good"
        minimal_dataset(good)
        expect_ok(good, "minimal")

        bad_order = root / "order"
        minimal_dataset(bad_order)
        index = json.loads((bad_order / "index.json").read_text(encoding="utf-8"))
        index["snapshots"] = ["2026-03-02", "2026-03-01"]
        (bad_order / "index.json").write_text(json.dumps(index), encoding="utf-8")
        expect_fail(bad_order, "order", "ascending")

        bad_product = root / "product"
        minimal_dataset(bad_product)
        posts = json.loads((bad_product / "posts.json").read_text(encoding="utf-8"))
        posts[0]["agent_product"] = "missing"
        (bad_product / "posts.json").write_text(json.dumps(posts), encoding="utf-8")
        expect_fail(bad_product, "product", "unknown product")

        bad_top = root / "top"
        minimal_dataset(bad_top)
        snap = json.loads((bad_top / "snapshots" / "2026-03-02.json").read_text(encoding="utf-8"))
        snap["top15"]["all"] = [
            {"code": "inbox", "label": "Inbox", "count": i, "share": 0.1} for i in range(16)
        ]
        (bad_top / "snapshots" / "2026-03-02.json").write_text(json.dumps(snap), encoding="utf-8")
        expect_fail(bad_top, "top", "exceeds 15")

        bad_version = root / "version"
        minimal_dataset(bad_version)
        tax = json.loads((bad_version / "taxonomy.json").read_text(encoding="utf-8"))
        tax["version"] = 2
        (bad_version / "taxonomy.json").write_text(json.dumps(tax), encoding="utf-8")
        expect_fail(bad_version, "version", "does not match")

        bad_file = root / "nosnap"
        minimal_dataset(bad_file)
        (bad_file / "snapshots" / "2026-03-02.json").unlink()
        expect_fail(bad_file, "nosnap", "missing")

    if problems:
        for problem in problems:
            print(problem, file=sys.stderr)
        return 1
    print("self-test OK")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate data JSON against the site contract.")
    parser.add_argument("--data-dir", type=Path, default=ROOT / "data", help="Directory of JSON files")
    parser.add_argument("--self-test", action="store_true", help="Run built-in contract checks")
    args = parser.parse_args(argv)
    if args.self_test:
        code = self_test()
        if code != 0:
            return code
        if argv is not None and "--data-dir" not in argv:
            return 0
    data_dir = args.data_dir
    empty, errors = validate_dir(data_dir)
    if empty:
        print("No data yet.")
        return 0
    if errors:
        shown = errors[:40]
        for error in shown:
            print(error, file=sys.stderr)
        if len(errors) > len(shown):
            print(f"... and {len(errors) - len(shown)} more", file=sys.stderr)
        print(f"{len(errors)} error(s)", file=sys.stderr)
        return 1
    print(f"OK {data_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
