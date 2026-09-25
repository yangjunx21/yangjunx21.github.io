# 写博客

个人主页的公开博客位于 [yangjunx21.github.io/blog/](https://yangjunx21.github.io/blog/)。文章保存在本仓库的 `_posts/`，由 GitHub Pages 自动生成网页。

## 首次开启可视化编辑器

1. 打开 [Pages CMS](https://app.pagescms.org/)，用 GitHub 登录。
2. 按提示为 `yangjunx21/yangjunx21.github.io` 安装 Pages CMS GitHub App，并只授予这个仓库访问权限。仓库根目录的 `.pages.yml` 已配置好，不需要在编辑器里重新创建。
3. 在 Pages CMS 里选择这个仓库的 `master` 分支，进入 **Blog posts**。

Pages CMS 直接把文章和图片保存到这个 GitHub 仓库。网站仍由现有的 Jekyll 和 GitHub Pages 发布；不需要维护另一份文章。

## 写一篇文章

1. 在 **Blog posts** 中新建文章，填写标题和 `URL slug`。Slug 使用小写英文、数字和连字符，例如 `my-first-post`；中文标题照常写在标题栏。
2. 日期会自动填入今天。摘要、标签可以按需填写。正文支持富文本和 Markdown 源码切换，也可以插入图片。
3. 写作时保持 **Published** 关闭并保存。草稿会进入仓库，但不会出现在公开网站。
4. 准备发布时打开 **Published** 并保存。文章会出现在 `/blog/`，地址形式为 `/blog/年/月/日/slug/`。发布后尽量不要改 slug，以免旧链接失效。

不想使用 Pages CMS 时，也可以直接在 GitHub 中编辑 `_posts/` 下的 Markdown 文件。文件名格式是 `YYYY-MM-DD-slug.md`，开头至少写：

```yaml
---
title: "文章标题"
slug: my-first-post
date: 2026-09-25
published: true
---

从这里开始写正文。
```

旧模板的五篇示例文章已从博客中移除。订阅地址是 [feed.xml](https://yangjunx21.github.io/feed.xml)。
