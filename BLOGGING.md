# 写博客

公开博客位于 [yangjunx21.github.io/blog/](https://yangjunx21.github.io/blog/)。写作入口是 [yangjunx21.github.io/write/](https://yangjunx21.github.io/write/)，不需要 Pages CMS。

## 写作与发布

1. 在写作页填写标题和正文。日期、网址名称会自动准备好；摘要和标签可选。正文使用 Markdown，顶部工具栏能插入常用格式。
2. 草稿会自动保存在当前浏览器。需要备份时点击“下载 Markdown 备份”；换浏览器或清除网站数据前也请先下载。
3. 想让读者在博客看到文章，勾选“公开发布”。未完成的文章可先留在浏览器中，或下载到本机备份。本仓库公开，提交到 GitHub 的文件即使设置 `published: false` 也可被他人看到。
4. 点击“复制文章内容”，再点击“在 GitHub 新建文件”。把写作页显示的文件名填在 GitHub 顶部，将文章内容粘贴到编辑框。
5. 点击 **Commit changes**，提交到 `master`。公开文章稍后会出现在 `/blog/`。

文章文件保存在 `_posts/`，文件名为 `YYYY-MM-DD-slug.md`。博客地址形如 `/blog/年/月/日/slug/`。发布后尽量不改文件名中的 slug，以免旧链接失效。

## 修改文章或发布草稿

打开 GitHub 仓库的 [`_posts/` 目录](https://github.com/yangjunx21/yangjunx21.github.io/tree/master/_posts)，选择文章，点击铅笔图标编辑并提交。要发布草稿，将文件顶部的 `published: false` 改成 `published: true`。

## 图片

在 [`images/blog/`](https://github.com/yangjunx21/yangjunx21.github.io/tree/master/images/blog) 中通过 GitHub 的 **Add file → Upload files** 上传图片，然后在文章中写 `![图片描述](/images/blog/图片名.png)`。也可以在写作页使用“图片”按钮，再将示例网址替换为图片网址。

订阅地址：[feed.xml](https://yangjunx21.github.io/feed.xml)。
