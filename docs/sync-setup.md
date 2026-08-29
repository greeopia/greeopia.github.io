# 博客同步设置文档

## 概述

本博客通过 GitHub Actions 每天自动从外部平台拉取文章，生成 Hexo Markdown 文件并部署到 GitHub Pages。

- **博客地址**: https://greeopia.github.io/
- **同步时间**: 每天 UTC 20:00（北京时间次日凌晨 4:00），也可在 Actions 页面手动触发 `Sync External Posts`

---

## 同步源

### 博客园（已启用）

| 项目 | 值 |
|---|---|
| 用户名 | greenpia |
| RSS 地址 | `https://feed.cnblogs.com/blog/u/871804/rss/` |
| 同步方式 | RSS 获取文章列表 → 逐篇抓取全文（`#cnblogs_post_body`） |
| 支持内容 | 随笔（RSS 自动发现） |
| 不支持 | 文章区（无 RSS，无公开列表页） |

发文章：在 `i.cnblogs.com/posts` 写**随笔**，设为公开。标签自动带入 Hexo。

### 简书（已禁用）

简书页面加了阿里云验证码，无法程序化访问。

---

## 同步脚本

`tools/sync-posts.js`

- 博客园 RSS → 逐篇抓取全文 → 生成 `.md`
- 去重：frontmatter 中的 `cnblogs_url` 字段匹配已有文件
- 更新：已有文章缺全文时自动补全
- **图片本地化**：正文里的远程图片会自动下载到 `source/images/cnblogs/`，
  并把 `<img src>` 改写为本地路径 `/images/cnblogs/<postId>-<原文件名>`

图片处理规则：

- 文件名 = `<postId>-<URL 文件名>`，同名即复用，重复运行不会重复下载
- 已同步的老文章如果正文还残留博客园远程图片，会在下次同步时自动回填本地图片
- 某张图片下载失败时保留原远程地址，不影响整篇同步

---

## GitHub Actions 自动化

- `sync-posts.yml`：定时拉取 → 检测变更 → 提交并推送 → 触发部署
- 变更检测使用 `git status --porcelain`（而非 `git diff`），
  这样**新建的未跟踪文章和图片也能被检测到**并提交
- 提交内容：`source/_posts/` + `source/images/`

---

## 本地测试

```bash
node tools/sync-posts.js
```
