import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import publish_blog_issue as writer


def issue(checked: bool) -> dict:
    box = "x" if checked else " "
    return {
        "number": 123,
        "title": '[Blog] 标题: "测试"',
        "created_at": "2026-09-25T08:00:00Z",
        "html_url": "https://github.com/yangjunx21/yangjunx21.github.io/issues/123",
        "body": (
            "### 摘要\n\n一句话摘要。\n\n"
            "### 标签\n\n研究，随笔, 研究\n\n"
            "### 文章正文\n\n> Junxiao Yang\n\n正文。\n\n![图](https://github.com/user-attachments/assets/example)\n\n"
            "### 发布设置\n\n这只是正文中的标题。\n\n"
            f"### 发布设置\n\n- [{box}] 同步到个人博客\n"
        ),
    }


class BlogIssueTest(unittest.TestCase):
    def setUp(self):
        self.old_root = writer.ROOT
        self.temp = tempfile.TemporaryDirectory()
        writer.ROOT = Path(self.temp.name)

    def tearDown(self):
        writer.ROOT = self.old_root
        self.temp.cleanup()

    def owner_event(self, checked=True, action="opened"):
        source = issue(checked)
        source["user"] = {"login": "yangjunx21", "id": 111237196}
        return {
            "action": action,
            "repository": {"full_name": "yangjunx21/yangjunx21.github.io"},
            "sender": dict(source["user"]),
            "issue": source,
        }

    def run_event(self, event):
        event_path = writer.ROOT / "event.json"
        event_path.write_text(json.dumps(event), encoding="utf-8")
        with patch("sys.argv", ["publish_blog_issue.py", str(event_path)]):
            writer.main()

    def test_owner_can_publish_update_and_unpublish_through_entrypoint(self):
        event = self.owner_event()
        self.run_event(event)
        path = writer.ROOT / "_posts" / "2026-09-25-post-123.md"
        self.assertIn("published: true", path.read_text(encoding="utf-8"))

        event["action"] = "edited"
        event["issue"]["body"] = event["issue"]["body"].replace("正文。", "更新后的正文。")
        self.run_event(event)
        self.assertIn("更新后的正文。", path.read_text(encoding="utf-8"))

        event["issue"]["body"] = event["issue"]["body"].replace("[x] 同步", "[ ] 同步")
        self.run_event(event)
        self.assertIn("published: false", path.read_text(encoding="utf-8"))

    def test_unauthorized_events_cannot_create_overwrite_or_unpublish(self):
        reader = {"login": "reader", "id": 42}
        variants = {}

        event = self.owner_event()
        event["issue"]["user"] = reader
        event["sender"] = reader
        event["issue"]["author_association"] = "COLLABORATOR"
        variants["reader submits with publish checkbox"] = event

        event = self.owner_event(action="edited")
        event["issue"]["user"] = reader
        variants["owner edits reader issue"] = event

        event = self.owner_event(action="edited")
        event["sender"] = reader
        variants["reader edits owner issue"] = event

        for field in ("sender", "author"):
            for key, value in (("login", "reader"), ("id", 42)):
                event = self.owner_event()
                user = event["sender"] if field == "sender" else event["issue"]["user"]
                user[key] = value
                variants[f"wrong {field} {key}"] = event

        for key in ("sender", "repository", "action"):
            event = self.owner_event()
            del event[key]
            variants[f"missing {key}"] = event
        event = self.owner_event()
        del event["issue"]["user"]
        variants["missing author"] = event

        event = self.owner_event()
        event["repository"]["full_name"] = "reader/fork"
        variants["different repository"] = event
        event = self.owner_event()
        event["issue"]["pull_request"] = {"url": "https://api.github.com/repos/example/pulls/123"}
        variants["pull request"] = event
        variants["unsupported action"] = self.owner_event(action="closed")

        path = writer.ROOT / "_posts" / "2026-09-25-post-123.md"
        for name, source in variants.items():
            for operation in ("create", "update", "unpublish"):
                with self.subTest(event=name, operation=operation):
                    event = copy.deepcopy(source)
                    if operation == "create":
                        path.unlink(missing_ok=True)
                    else:
                        path.parent.mkdir(exist_ok=True)
                        path.write_text("existing article", encoding="utf-8")
                    if operation == "unpublish":
                        event["issue"]["body"] = event["issue"]["body"].replace("[x] 同步", "[ ] 同步")
                    with self.assertRaises(PermissionError):
                        self.run_event(event)
                    if operation == "create":
                        self.assertFalse(path.exists())
                    else:
                        self.assertEqual(path.read_text(encoding="utf-8"), "existing article")

    def test_published_issue_keeps_image_and_front_matter(self):
        path, content = writer.render_post(issue(True))
        self.assertEqual(path.name, "2026-09-25-post-123.md")
        self.assertIn('title: "标题: \\"测试\\""', content)
        self.assertIn("published: true", content)
        self.assertIn("lang: zh-CN", content)
        self.assertIn('  - "研究"\n  - "随笔"', content)
        self.assertIn("![图](https://github.com/user-attachments/assets/example)", content)
        self.assertNotIn("> Junxiao Yang", content)
        self.assertIn("### 发布设置\n\n这只是正文中的标题。", content)

    def test_unchecked_new_issue_does_not_create_article(self):
        self.assertIsNone(writer.render_post(issue(False)))

    def test_editor_images_are_placed_in_article_order(self):
        source = issue(True)
        source["body"] = source["body"].replace(
            "正文。",
            "第一张 <!-- BLOG_IMAGE_1 -->\n\n第二张 <!-- BLOG_IMAGE_2 -->",
        ).replace(
            "### 发布设置\n\n- [x] 同步到个人博客",
            "### 图片上传区\n\n![一](https://github.com/user-attachments/assets/one)\n"
            "![二](https://github.com/user-attachments/assets/two)\n\n"
            "### 发布设置\n\n- [x] 同步到个人博客",
        )
        _, content = writer.render_post(source)
        self.assertIn("第一张 ![配图 1](https://github.com/user-attachments/assets/one)", content)
        self.assertIn("第二张 ![配图 2](https://github.com/user-attachments/assets/two)", content)
        self.assertNotIn("BLOG_IMAGE", content)

    def test_editor_image_captions_and_html_uploads(self):
        source = issue(True)
        source["body"] = source["body"].replace(
            "正文。",
            '<!-- BLOG_IMAGE_1 | 流程图 [v2] "草案" -->\n\n<!-- BLOG_IMAGE_2 -->',
        ).replace(
            "### 发布设置\n\n- [x] 同步到个人博客",
            "### 图片上传区\n\n"
            '<img width="888" height="688" alt="Image" src="https://github.com/user-attachments/assets/one" />\n'
            "![二](https://github.com/user-attachments/assets/two)\n\n"
            "### 发布设置\n\n- [x] 同步到个人博客",
        )
        _, content = writer.render_post(source)
        self.assertIn(
            '![流程图 \\[v2\\] "草案"](https://github.com/user-attachments/assets/one "流程图 [v2] &quot;草案&quot;")',
            content,
        )
        self.assertIn("![配图 2](https://github.com/user-attachments/assets/two)", content)

    def test_typora_math_and_highlight_become_kramdown(self):
        source = (
            "行内 $a_1 + b^*_2$ 与 $x$，价格 $5 and $10，转义 \\$y$。\n"
            "GitHub 写法 $`\\sqrt{2}`$，已有 $$c_1$$，==重点== 和 a == b。\n"
            "代码 `$not_math$ ==no==` 保持原样，链接 https://x.test/?a==b。\n\n"
            "$$\n\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}\n$$\n\n"
            "```math\nE = mc^2\n```\n\n"
            "```python\nprice = '$5' if a == b else '$x$'\n```\n"
        )
        converted = writer.convert_typora_syntax(source)
        self.assertIn("行内 $$a_1 + b^*_2$$ 与 $$x$$，价格 $5 and $10，转义 \\$y$。", converted)
        self.assertIn("GitHub 写法 $$\\sqrt{2}$$，已有 $$c_1$$，<mark markdown=\"span\">重点</mark> 和 a == b。", converted)
        self.assertIn("代码 `$not_math$ ==no==` 保持原样，链接 https://x.test/?a==b。", converted)
        self.assertIn("$$\n\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}\n$$", converted)
        self.assertIn("$$\nE = mc^2\n$$", converted)
        self.assertIn("```python\nprice = '$5' if a == b else '$x$'\n```", converted)

    def test_missing_editor_image_prevents_broken_publication(self):
        source = issue(True)
        source["body"] = source["body"].replace("正文。", "正文 <!-- BLOG_IMAGE_1 -->")
        with self.assertRaisesRegex(ValueError, "only 0 uploaded images"):
            writer.render_post(source)

    def test_unchecking_existing_issue_unpublishes_article(self):
        path = writer.ROOT / "_posts" / "2026-09-25-post-123.md"
        path.parent.mkdir()
        path.write_text("previous article")
        result_path, content = writer.render_post(issue(False))
        self.assertEqual(result_path, path)
        self.assertIn("published: false", content)


if __name__ == "__main__":
    unittest.main()
