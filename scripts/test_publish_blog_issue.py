import tempfile
import unittest
from pathlib import Path

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
            "### 文章正文\n\n正文。\n\n![图](https://github.com/user-attachments/assets/example)\n\n"
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

    def test_published_issue_keeps_image_and_front_matter(self):
        path, content = writer.render_post(issue(True))
        self.assertEqual(path.name, "2026-09-25-post-123.md")
        self.assertIn('title: "标题: \\"测试\\""', content)
        self.assertIn("published: true", content)
        self.assertIn("lang: zh-CN", content)
        self.assertIn('  - "研究"\n  - "随笔"', content)
        self.assertIn("![图](https://github.com/user-attachments/assets/example)", content)
        self.assertIn("### 发布设置\n\n这只是正文中的标题。", content)

    def test_unchecked_new_issue_does_not_create_article(self):
        self.assertIsNone(writer.render_post(issue(False)))

    def test_unchecking_existing_issue_unpublishes_article(self):
        path = writer.ROOT / "_posts" / "2026-09-25-post-123.md"
        path.parent.mkdir()
        path.write_text("previous article")
        result_path, content = writer.render_post(issue(False))
        self.assertEqual(result_path, path)
        self.assertIn("published: false", content)


if __name__ == "__main__":
    unittest.main()
