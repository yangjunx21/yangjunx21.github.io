# 写博客

公开博客在 [yangjunx21.github.io/blog/](https://yangjunx21.github.io/blog/)。从 [写文章](https://yangjunx21.github.io/write/) 打开 GitHub 文章表单。

## 写一篇文章

1. 在 GitHub 表单里填写标题、正文；摘要和标签可选。正文框有格式工具栏和 **Preview**。
2. 截图可以直接粘贴到正文框，图片也可以拖入。等 GitHub 完成上传，正文里出现图片链接后再提交。
3. 准备发布时勾选“同步到个人博客”，然后提交 Issue。GitHub Actions 会自动生成 `_posts/` 中的文章，并请求 GitHub Pages 更新网站。
4. 之后直接编辑这条 Issue，就能更新文章。取消勾选“同步到个人博客”后，文章会从博客撤下。

文章网址使用 Issue 编号，例如 `/blog/2026/09/25/post-123/`，修改标题不会破坏旧链接。若同步失败，打开仓库的 **Actions → Publish blog issue** 查看原因。

## 公开范围

这个仓库是公开的。Issue、粘贴上传的图片和已生成的文章文件都可以被他人查看；不勾选“同步到个人博客”只会阻止文章显示在个人主页，并不会把 Issue 变为私密。私密草稿请先保存在自己设备上的编辑器里。

订阅地址：[feed.xml](https://yangjunx21.github.io/feed.xml)。
