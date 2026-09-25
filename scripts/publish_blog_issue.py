"""Turn an owner-authored GitHub blog issue into a Jekyll post.

Reads the trusted GitHub event file; issue title and body are treated only as data.
The workflow checks the actor and author before calling this script.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SECTION_RE = re.compile(r"(?m)^### (摘要|标签|文章正文|发布设置)\s*$")
PUBLISH_RE = re.compile(r"(?m)^- \[[xX]\] 同步到个人博客\s*$")


def get_sections(issue_body: str) -> dict[str, str]:
    matches = list(SECTION_RE.finditer(issue_body))
    labels = ["摘要", "标签", "文章正文"]
    selected = []
    cursor = 0
    for label in labels:
        match = next((item for item in matches if item.start() >= cursor and item.group(1) == label), None)
        if match is None:
            return {}
        selected.append(match)
        cursor = match.end()
    final = next((item for item in reversed(matches) if item.start() >= cursor and item.group(1) == "发布设置"), None)
    if final is None:
        return {}
    selected.append(final)
    sections = {}
    for index, match in enumerate(selected):
        end = selected[index + 1].start() if index + 1 < len(selected) else len(issue_body)
        sections[match.group(1)] = issue_body[match.end() : end].strip()
    return sections


def optional_value(value: str) -> str:
    return "" if value.strip().casefold() in {"_no response_", "no response"} else value.strip()


def render_post(issue: dict) -> tuple[Path, str] | None:
    sections = get_sections(issue.get("body") or "")
    if not sections:
        return None

    title = re.sub(r"^\[Blog\]\s*", "", issue.get("title", ""), flags=re.IGNORECASE).strip()
    article = optional_value(sections["文章正文"])
    if not title or not article:
        raise ValueError("Blog issue needs a title and article body")

    number = int(issue["number"])
    if number <= 0:
        raise ValueError("Invalid issue number")
    date = issue["created_at"][:10]
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
        raise ValueError("Invalid issue date")

    post_path = ROOT / "_posts" / f"{date}-post-{number}.md"
    published = bool(PUBLISH_RE.search(sections["发布设置"]))
    if not published and not post_path.exists():
        return None

    lines = [
        "---",
        f"title: {json.dumps(title, ensure_ascii=False)}",
        f"date: {date}",
        "lang: zh-CN",
        f"published: {str(published).lower()}",
    ]
    summary = optional_value(sections["摘要"])
    if summary:
        lines.append(f"excerpt: {json.dumps(summary, ensure_ascii=False)}")
    tags = list(dict.fromkeys(tag.strip() for tag in re.split(r"[,，]", optional_value(sections["标签"])) if tag.strip()))
    if tags:
        lines.append("tags:")
        lines.extend(f"  - {json.dumps(tag, ensure_ascii=False)}" for tag in tags)
    lines.extend([f"source_issue: {json.dumps(issue['html_url'])}", "---", "", article, ""])
    return post_path, "\n".join(lines)


def main() -> None:
    event_path = Path(sys.argv[1])
    event = json.loads(event_path.read_text(encoding="utf-8"))
    issue = event["issue"]
    result = render_post(issue)
    if result is None:
        return
    path, content = result
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    print(f"Prepared {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
