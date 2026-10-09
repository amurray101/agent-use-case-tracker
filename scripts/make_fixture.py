#!/usr/bin/env python3
"""Write an obviously fake UI fixture to fixtures/.

This is for local preview only. It does not write data/ and must not be committed.
"""

from __future__ import annotations

import json
import math
import random
from collections import Counter
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "fixtures"
DATA = ROOT / "data"

CATEGORIES = [
    ("inbox", "Inbox", "Reading, sorting, and replying to email."),
    ("calendar", "Calendar", "Scheduling events and resolving conflicts."),
    ("research", "Research", "Gathering sources and summarizing a topic."),
    ("shopping", "Shopping", "Comparing products and placing an order."),
    ("travel", "Travel", "Planning trips, routes, and reservations."),
    ("coding", "Coding", "Writing, running, and fixing software."),
    ("writing", "Writing", "Drafting and editing text."),
    ("reminders", "Reminders", "Setting and following up on reminders."),
    ("files", "Files", "Finding, moving, and summarizing files."),
    ("messages", "Messages", "Reading and sending chat messages."),
    ("home", "Home", "Controlling devices around the house."),
    ("finance", "Finance", "Reviewing spending and moving money."),
    ("learning", "Learning", "Studying a subject or practicing a skill."),
    ("cooking", "Cooking", "Choosing a meal and walking through a recipe."),
    ("meetings", "Meetings", "Preparing for or recapping a meeting."),
    ("news", "News", "Following current events."),
    ("photos", "Photos", "Finding, editing, or sharing photos."),
    ("support", "Support", "Resolving an account or product problem."),
]

PRODUCTS = [
    ("instinct", "Instinct", "2025"),
    ("muse", "Meta Muse", "2025"),
    ("grok-bot", "Grok Bot", "2025"),
    ("manus-cue", "Manus Cue", "2026"),
    ("chatgpt-dots", "ChatGPT Dots", "2026"),
]

PLATFORMS = ["X", "Reddit", "Hacker News", "App Store", "YouTube", "TikTok", "Instagram"]
SENTIMENTS = ["positive", "neutral", "negative"]
POSTS = 5000
WEEKS = 12


def main() -> None:
    if OUT.resolve() == DATA.resolve():
        raise SystemExit("refusing to write data/")
    rng = random.Random(1)
    start = date(2026, 1, 5)
    snapshots = [start + timedelta(days=7 * i) for i in range(WEEKS)]
    span = (snapshots[-1] - start).days
    labels = {code: label for code, label, _definition in CATEGORIES}
    posts = []
    for n in range(POSTS):
        day = start + timedelta(days=rng.randrange(span + 1))
        product_index = n % len(PRODUCTS)
        date_index = min(WEEKS - 1, (day - start).days // 7)
        codes = pick_codes(rng, date_index, product_index)
        quote = f"Fixture {n:04d}. Not a real post."
        if n == 17:
            quote = "Fixture 0017.\nNot a real post. <b>bold</b> & <script>alert(1)</script>"
        posts.append(
            {
                "id": f"fixture-{n:04d}",
                "url": f"https://example.com/fixture/{n:04d}",
                "post_platform": PLATFORMS[n % len(PLATFORMS)],
                "agent_product": PRODUCTS[product_index][0],
                "use_cases": codes,
                "date": day.isoformat(),
                "first_seen": day.isoformat() + "T15:04:05Z",
                "author": f"@fixture_{n:04d}",
                "quote": quote,
                "sentiment": SENTIMENTS[n % len(SENTIMENTS)],
            }
        )

    if OUT.exists():
        for path in OUT.rglob("*.json"):
            path.unlink()
    (OUT / "snapshots").mkdir(parents=True, exist_ok=True)

    index = {
        "updated": "2026-03-23T20:00:00Z",
        "snapshots": [day.isoformat() for day in snapshots],
        "products": [product[0] for product in PRODUCTS],
        "taxonomy_version": 1,
        "method": "Local fixture for preview only. Counts are invented and are not measurements of social media.",
    }
    products = [
        {
            "id": pid,
            "name": name,
            "maker": "Fixture",
            "launched": launched,
            "source_url": f"https://example.com/fixture/{pid}",
            "verified": pid in ("instinct", "grok-bot"),
            "note": "Local fixture. Not a real source.",
        }
        for pid, name, launched in PRODUCTS
    ]
    taxonomy = {
        "version": 1,
        "categories": [
            {"code": code, "label": label, "definition": definition, "added": "2026-01-05"}
            for code, label, definition in CATEGORIES
        ],
        "changelog": [{"date": "2026-01-05", "change": "Fixture taxonomy created for local preview."}],
    }
    (OUT / "index.json").write_text(json.dumps(index, indent=2) + "\n", encoding="utf-8")
    (OUT / "products.json").write_text(json.dumps(products, indent=2) + "\n", encoding="utf-8")
    (OUT / "taxonomy.json").write_text(json.dumps(taxonomy, indent=2) + "\n", encoding="utf-8")
    (OUT / "posts.json").write_text(json.dumps(posts, indent=2) + "\n", encoding="utf-8")

    product_ids = [product[0] for product in PRODUCTS]
    for snap_day in snapshots:
        cutoff = snap_day.isoformat()
        subset = [post for post in posts if post["date"] <= cutoff]
        totals = {}
        top15 = {}
        for key in ["all", *product_ids]:
            rows = subset if key == "all" else [post for post in subset if post["agent_product"] == key]
            use_rows = [post for post in rows if post["use_cases"]]
            counts = Counter()
            for post in use_rows:
                for code in post["use_cases"]:
                    counts[code] += 1
            ranked = counts.most_common(15)
            denominator = len(use_rows)
            top15[key] = [
                {
                    "code": code,
                    "label": labels[code],
                    "count": count,
                    "share": round(count / denominator, 4) if denominator else 0,
                }
                for code, count in ranked
            ]
            totals[key] = {"posts": len(rows), "use_case_posts": denominator}
        payload = {
            "date": cutoff,
            "cumulative": True,
            "basis": "fixture cumulative posts",
            "totals": totals,
            "top15": top15,
        }
        (OUT / "snapshots" / f"{cutoff}.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    first = json.loads((OUT / "snapshots" / f"{snapshots[0].isoformat()}.json").read_text(encoding="utf-8"))
    last = json.loads((OUT / "snapshots" / f"{snapshots[-1].isoformat()}.json").read_text(encoding="utf-8"))
    first_codes = [row["code"] for row in first["top15"]["all"]]
    last_codes = [row["code"] for row in last["top15"]["all"]]
    print(f"wrote {OUT}")
    print("first", first_codes)
    print("last", last_codes)
    print("entered", [code for code in last_codes if code not in first_codes])
    print("left", [code for code in first_codes if code not in last_codes])


def pick_codes(rng: random.Random, date_index: int, product_index: int) -> list[str]:
    progress = date_index / max(WEEKS - 1, 1)
    weights = []
    for i in range(len(CATEGORIES)):
        if i == 0:
            weights.append(6 * (1 - progress) + 0.05)
        elif i == 1:
            weights.append(6 * progress + 0.05)
        else:
            early = 0.35 + ((i * 3 + product_index) % 5) * 0.25
            late = 0.35 + ((i * 5 + product_index * 2) % 7) * 0.3
            wave = 1.2 + math.sin(progress * math.tau + i * 0.55 + product_index)
            weights.append(max(0.05, (early * (1 - progress) + late * progress) * wave))
    k = 1 if rng.random() < 0.72 else 2
    pool = list(range(len(CATEGORIES)))
    chosen = []
    for _ in range(k):
        total = sum(weights[i] for i in pool)
        mark = rng.random() * total
        acc = 0.0
        pick = pool[-1]
        for i in pool:
            acc += weights[i]
            if acc >= mark:
                pick = i
                break
        chosen.append(CATEGORIES[pick][0])
        pool.remove(pick)
    return chosen


if __name__ == "__main__":
    main()
