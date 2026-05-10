#!/usr/bin/env python3
"""Fetch AI blog/news feed items into Jekyll data.

The site remains static: this script runs locally or in GitHub Actions, writes
_data/daily_news.yml, and the Daily News page renders those links.
"""

from __future__ import annotations

import argparse
import email.utils
import html
import re
import sys
import time
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable
from urllib.parse import urljoin, urlparse

import requests
import yaml
from bs4 import BeautifulSoup


ROOT = Path(__file__).resolve().parents[1]
SOURCE_PATH = ROOT / "_data" / "ai_blog_sources.yml"
OUTPUT_PATH = ROOT / "_data" / "daily_news.yml"

USER_AGENT = "yangjunx21.github.io daily news fetcher"
TIMEOUT = 8
MAX_SOURCES = 160
MAX_WORKERS = 12

TONE_BY_GROUP = {
    "Frontier Labs": "frontier",
    "AI Safety and Governance": "safety",
    "AI Companies and Research Labs": "industry",
    "Academic Labs": "community",
    "Personal Blogs and Newsletters": "community",
}

COMMON_FEED_PATHS = (
    "feed",
    "feed.xml",
    "rss",
    "rss.xml",
    "atom.xml",
)

KNOWN_FEEDS = {
    "https://ai-alignment.com": "https://ai-alignment.com/feed",
    "https://importai.substack.com": "https://importai.substack.com/feed",
    "https://www.interconnects.ai": "https://www.interconnects.ai/feed",
    "https://www.latent.space": "https://www.latent.space/feed",
    "https://karpathy.bearblog.dev/blog": "https://karpathy.bearblog.dev/feed/",
    "https://lilianweng.github.io": "https://lilianweng.github.io/index.xml",
    "https://jalammar.github.io": "https://jalammar.github.io/feed.xml",
    "https://karpathy.github.io": "https://karpathy.github.io/feed.xml",
    "https://www.ruder.io": "https://www.ruder.io/rss",
    "https://bair.berkeley.edu/blog": "https://bair.berkeley.edu/blog/feed.xml",
    "https://distill.pub": "https://distill.pub/rss.xml",
}


@dataclass
class FeedItem:
    title: str
    url: str
    source: str
    source_url: str
    source_group: str
    source_tone: str
    published_at: str | None
    timestamp: float
    summary: str


def load_sources() -> list[dict]:
    data = yaml.safe_load(SOURCE_PATH.read_text(encoding="utf-8")) or {}
    sources: list[dict] = []
    for group in data.get("groups", []):
        for source in group.get("sources", []):
            if not source.get("url"):
                continue
            item = dict(source)
            item["group"] = group.get("name", "")
            sources.append(item)
    return sources[:MAX_SOURCES]


def normalize_url(url: str) -> str:
    url = url.strip()
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    return url.rstrip("/")


def request_url(session: requests.Session, url: str) -> requests.Response | None:
    try:
        response = session.get(url, timeout=TIMEOUT, allow_redirects=True)
        if response.status_code >= 400:
            return None
        return response
    except requests.RequestException:
        return None


def looks_like_feed(content: bytes) -> bool:
    head = content[:300].lstrip().lower()
    return head.startswith(b"<?xml") or b"<rss" in head[:200] or b"<feed" in head[:200]


def discover_feed(session: requests.Session, url: str) -> str | None:
    url = normalize_url(url)
    if url in KNOWN_FEEDS:
        return KNOWN_FEEDS[url]

    response = request_url(session, url)
    if response is None:
        return None

    content_type = response.headers.get("content-type", "").lower()
    if "xml" in content_type or looks_like_feed(response.content):
        return response.url

    soup = BeautifulSoup(response.text, "html.parser")
    candidates: list[str] = []
    for link in soup.find_all("link"):
        rel = " ".join(link.get("rel", [])).lower()
        typ = (link.get("type") or "").lower()
        href = link.get("href")
        if not href:
            continue
        if "alternate" in rel and ("rss" in typ or "atom" in typ or "feed" in typ or "json" in typ):
            candidates.append(urljoin(response.url, href))

    parsed = urlparse(response.url)
    base = f"{parsed.scheme}://{parsed.netloc}/"
    for path in COMMON_FEED_PATHS:
        candidates.append(urljoin(response.url + "/", path))
        candidates.append(urljoin(base, path))

    seen = set()
    for candidate in candidates[:12]:
        if candidate in seen:
            continue
        seen.add(candidate)
        feed_response = request_url(session, candidate)
        if feed_response is None:
            continue
        feed_type = feed_response.headers.get("content-type", "").lower()
        if "xml" in feed_type or "rss" in feed_type or "atom" in feed_type or looks_like_feed(feed_response.content):
            return feed_response.url
    return None


def first_text(element: ET.Element, names: Iterable[str]) -> str:
    for name in names:
        found = element.find(name)
        if found is not None and found.text:
            return found.text.strip()
    return ""


def child_text_any_ns(element: ET.Element, local_names: Iterable[str]) -> str:
    wanted = set(local_names)
    for child in list(element):
        local = child.tag.rsplit("}", 1)[-1]
        if local in wanted and child.text:
            return child.text.strip()
    return ""


def child_link(element: ET.Element) -> str:
    for child in list(element):
        local = child.tag.rsplit("}", 1)[-1]
        if local != "link":
            continue
        href = child.attrib.get("href")
        rel = child.attrib.get("rel", "alternate")
        if href and rel == "alternate":
            return href.strip()
        if child.text:
            return child.text.strip()
    return ""


def clean_summary(value: str, limit: int = 220) -> str:
    value = html.unescape(value or "")
    value = re.sub(r"<[^>]+>", " ", value)
    value = re.sub(r"\s+", " ", value).strip()
    if len(value) > limit:
        value = value[: limit - 1].rstrip() + "..."
    return value


def parse_date(value: str) -> tuple[str | None, float]:
    if not value:
        return None, 0.0
    value = value.strip()
    try:
        parsed = email.utils.parsedate_to_datetime(value)
    except (TypeError, ValueError, IndexError):
        parsed = None
    if parsed is None:
        for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%d"):
            try:
                parsed = datetime.strptime(value, fmt)
                break
            except ValueError:
                continue
    if parsed is None:
        return value, 0.0
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    parsed = parsed.astimezone(timezone.utc)
    return parsed.isoformat().replace("+00:00", "Z"), parsed.timestamp()


def parse_feed(xml_text: str, source: dict, feed_url: str) -> list[FeedItem]:
    try:
        root = ET.fromstring(xml_text.encode("utf-8"))
    except ET.ParseError:
        return []

    root_local = root.tag.rsplit("}", 1)[-1].lower()
    nodes = []
    if root_local == "rss":
        channel = root.find("channel")
        if channel is not None:
            nodes = channel.findall("item")
    elif root_local == "feed":
        nodes = [node for node in list(root) if node.tag.rsplit("}", 1)[-1] == "entry"]

    items: list[FeedItem] = []
    for node in nodes[:15]:
        title = child_text_any_ns(node, ("title",))
        link = child_text_any_ns(node, ("link",)) or child_link(node)
        if not title or not link:
            continue
        link = urljoin(feed_url, link)
        date_text = child_text_any_ns(node, ("pubDate", "published", "updated", "date"))
        published_at, timestamp = parse_date(date_text)
        summary = child_text_any_ns(node, ("description", "summary", "content", "encoded"))
        items.append(
            FeedItem(
                title=clean_summary(title, 180),
                url=link,
                source=source["name"],
                source_url=normalize_url(source["url"]),
                source_group=source.get("group", ""),
                source_tone=TONE_BY_GROUP.get(source.get("group", ""), "default"),
                published_at=published_at,
                timestamp=timestamp,
                summary=clean_summary(summary),
            )
        )
    return items


def fetch_source_items(source: dict) -> tuple[list[FeedItem], str | None]:
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})
    feed_url = source.get("feed") or discover_feed(session, source["url"])
    if not feed_url:
        return [], source["name"]
    response = request_url(session, feed_url)
    if response is None:
        return [], source["name"]
    parsed = parse_feed(response.text, source, response.url)
    if not parsed:
        return [], source["name"]
    return parsed, None


def fetch_items(limit: int, per_source: int, days: int) -> tuple[list[FeedItem], list[str]]:
    all_items: list[FeedItem] = []
    failures: list[str] = []

    sources = load_sources()
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        future_to_source = {executor.submit(fetch_source_items, source): source for source in sources}
        for future in as_completed(future_to_source):
            source = future_to_source[future]
            try:
                parsed, failure = future.result()
            except Exception:
                parsed, failure = [], source["name"]
            if failure:
                failures.append(failure)
            all_items.extend(parsed)
            time.sleep(0.02)

    deduped: dict[str, FeedItem] = {}
    for item in all_items:
        key = item.url.split("?")[0].rstrip("/")
        existing = deduped.get(key)
        if existing is None or item.timestamp > existing.timestamp:
            deduped[key] = item

    now = datetime.now(timezone.utc)
    cutoff = (now - timedelta(days=days)).timestamp() if days > 0 else 0.0
    future_grace = (now + timedelta(days=1)).timestamp()
    recent_items = [
        item
        for item in deduped.values()
        if item.timestamp > 0 and item.timestamp >= cutoff and item.timestamp <= future_grace
    ]

    sorted_items = sorted(
        recent_items,
        key=lambda item: (item.timestamp, item.source, item.title),
        reverse=True,
    )
    balanced: list[FeedItem] = []
    source_counts: dict[str, int] = {}
    for item in sorted_items:
        count = source_counts.get(item.source, 0)
        if count >= per_source:
            continue
        balanced.append(item)
        source_counts[item.source] = count + 1
        if len(balanced) >= limit:
            break
    return balanced, failures


def write_output(items: list[FeedItem], failures: list[str], days: int) -> None:
    data = {
        "updated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "window_days": days,
        "items": [
            {
                "title": item.title,
                "url": item.url,
                "source": item.source,
                "source_url": item.source_url,
                "source_group": item.source_group,
                "source_tone": item.source_tone,
                "published_at": item.published_at,
                "summary": item.summary,
            }
            for item in items
        ],
        "unavailable_sources": failures[:30],
    }
    OUTPUT_PATH.write_text(
        yaml.safe_dump(data, allow_unicode=True, sort_keys=False, width=1000),
        encoding="utf-8",
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch daily AI news into _data/daily_news.yml")
    parser.add_argument("--limit", type=int, default=80, help="Maximum feed items to keep")
    parser.add_argument("--per-source", type=int, default=10, help="Maximum items to keep from one source")
    parser.add_argument("--days", type=int, default=14, help="Only keep posts published in the last N days")
    args = parser.parse_args()

    items, failures = fetch_items(args.limit, args.per_source, args.days)
    write_output(items, failures, args.days)
    print(f"wrote {len(items)} items to {OUTPUT_PATH}")
    if failures:
        print(f"{len(failures)} sources unavailable or without discoverable feeds", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
