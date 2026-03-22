# Troubleshooting 排查记录

这里存放问题排查和踩坑记录，方便以后查阅和吸取教训。

## 目录

| 文件 | 日期 | 问题 | 关键发现 |
|------|------|------|----------|
| [vue-watch-duplicate-requests](./vue-watch-duplicate-requests.md) | 2026-03-22 | Vue watch 导致重复请求 | `watch` + `immediate: true` + `onMounted` 组合导致重复触发 |
| [feishu-footer-debug](./feishu-footer-debug.md) | 2026-03-17 | 飞书卡片 footer 不显示 | 需要执行 `/usage full` 命令，而非配置文件 |

---

## 排查记录模板

```markdown
# 问题标题

> 一句话描述问题

## 问题背景

期望的功能和实际表现的差异。

## 排查过程

### 第一层：xxx

### 第二层：xxx

...

## 真正的答案

最终发现的关键原因。

## 经验教训

1. ...
2. ...

## 附录

相关配置、命令等。
```

---

*最后更新：2026-03-17*
