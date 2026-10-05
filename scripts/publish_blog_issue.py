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
SECTION_RE = re.compile(r"(?m)^### (摘要|标签|文章正文|图片上传区|发布设置)\s*$")
PUBLISH_RE = re.compile(r"(?m)^- \[[xX]\] 同步到个人博客\s*$")
IMAGE_PLACEHOLDER_RE = re.compile(r"<!-- BLOG_IMAGE_(\d+)(?:[ \t]*\|[ \t]*([^\n]*?))?[ \t]*-->")
UPLOADED_IMAGE_RE = re.compile(
    r"!\[[^\]\n]*\]\((https?://[^\s)]+)\)|<img\b[^>]*?\bsrc=[\"'](https?://[^\"'\s>]+)[\"'][^>]*>",
    re.IGNORECASE,
)


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
    uploads = next((item for item in reversed(matches) if cursor <= item.start() < final.start() and item.group(1) == "图片上传区"), None)
    if uploads is not None:
        selected.append(uploads)
    selected.append(final)
    sections = {}
    for index, match in enumerate(selected):
        end = selected[index + 1].start() if index + 1 < len(selected) else len(issue_body)
        sections[match.group(1)] = issue_body[match.end() : end].strip()
    return sections


def image_markdown(number: str, url: str, caption: str | None) -> str:
    caption = re.sub(r"\s+", " ", caption or "").strip()
    if not caption:
        return f"![配图 {number}]({url})"
    alt = re.sub(r"([\\\[\]])", r"\\\1", caption)
    title = caption.replace('"', "&quot;")
    return f'![{alt}]({url} "{title}")'


# Typora/GitHub-style syntax that kramdown lacks, rewritten outside code and math:
# $x$ and $`x`$ become kramdown inline math $$x$$, ```math fences become $$ blocks,
# and ==text== becomes <mark>.
FENCE_RE = re.compile(r"^[ \t]{0,3}(`{3,}|~{3,})[ \t]*([\w+-]*)")
PROTECTED_INLINE_RE = re.compile(
    r"(`+)[\s\S]*?\1|\$\$[\s\S]+?\$\$|\\\$|<!--[\s\S]*?-->|</?[A-Za-z][\w-]*(?:\s[^<>\n]*)?/?>|https?://\S+"
)
INLINE_MATH_RE = re.compile(r"\$(?=[^\s$])((?:\\.|[^$\\\n])*?[^\s\\$])\$(?!\d)")
MARK_RE = re.compile(r"(?<![=\\])==(?=[^\s=])(.+?)(?<=[^\s=])==(?!=)")


def convert_inline(text: str) -> str:
    text = re.sub(r"\$`([^`\n]+)`\$", r"$$\1$$", text)
    parts = []
    cursor = 0
    for match in PROTECTED_INLINE_RE.finditer(text):
        parts.append(convert_plain(text[cursor : match.start()]))
        parts.append(match.group(0))
        cursor = match.end()
    parts.append(convert_plain(text[cursor:]))
    return "".join(parts)


def convert_plain(text: str) -> str:
    text = INLINE_MATH_RE.sub(r"$$\1$$", text)
    return MARK_RE.sub(r'<mark markdown="span">\1</mark>', text)


def convert_typora_syntax(article: str) -> str:
    output = []
    fence = None
    math_fence = False
    in_display_math = False
    for line in article.splitlines(keepends=True):
        body = line.rstrip("\r\n")
        ending = line[len(body) :]
        match = FENCE_RE.match(body)
        if fence:
            if match and match.group(1)[0] == fence[0] and len(match.group(1)) >= len(fence) and not match.group(2):
                fence = None
                output.append("$$" + ending if math_fence else line)
                math_fence = False
            else:
                output.append(line)
        elif in_display_math:
            output.append(line)
            if body.strip() == "$$" or (body.rstrip().endswith("$$") and body.strip() != "$$"):
                in_display_math = False
        elif match:
            fence = match.group(1)
            math_fence = match.group(2).lower() == "math"
            output.append("$$" + ending if math_fence else line)
        elif body.strip().startswith("$$") and body.strip().count("$$") == 1:
            in_display_math = True
            output.append(line)
        else:
            output.append(convert_inline(body) + ending)
    return "".join(output)


def optional_value(value: str) -> str:
    return "" if value.strip().casefold() in {"_no response_", "no response"} else value.strip()


def render_post(issue: dict) -> tuple[Path, str] | None:
    sections = get_sections(issue.get("body") or "")
    if not sections:
        return None

    title = re.sub(r"^\[Blog\]\s*", "", issue.get("title", ""), flags=re.IGNORECASE).strip()
    article = optional_value(sections["文章正文"])
    article = re.sub(r"\A>\s*Junxiao Yang[ \t]*(?:\r?\n){1,2}", "", article)
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

    if published and IMAGE_PLACEHOLDER_RE.search(article):
        uploaded = [match.group(1) or match.group(2) for match in UPLOADED_IMAGE_RE.finditer(sections.get("图片上传区", ""))]
        needed = max(int(match.group(1)) for match in IMAGE_PLACEHOLDER_RE.finditer(article))
        if len(uploaded) < needed:
            raise ValueError(f"Article has {needed} image placeholders but only {len(uploaded)} uploaded images")
        article = IMAGE_PLACEHOLDER_RE.sub(
            lambda match: image_markdown(match.group(1), uploaded[int(match.group(1)) - 1], match.group(2)),
            article,
        )
    article = convert_typora_syntax(article)

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
