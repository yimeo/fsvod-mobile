# 首页广告位 `index_ad` 接入规范

将 `api.json.index-ad.template.json` 中的 `index_ad` 节复制到官方 `api.json` 顶层。`data_url` 可以指向 `.php`、`.json`、或扩展名为 `.js` 但内容为 JSON 的地址；建议使用 HTTPS。广告默认关闭，只有把 `enabled` 改为严格的布尔值 `true` 才会请求广告数据。

应用只获取和解析 JSON 数据，**不会执行远程 JavaScript**。这样可避免远程脚本改变应用行为、读取本地数据或导致首页崩溃。部署时可以直接使用 `index_ad.php.template`，或使用 `index_ad.js.template` 的纯 JSON 内容。

| 字段 | 必填 | 规则 |
|---|---:|---|
| `index_ad.enabled` | 是 | 必须为 JSON 布尔值 `true` 才会后台请求并显示广告；`false`、缺失、字符串 `"true"` 或旧式 URL 字符串均不会请求广告数据。 |
| `index_ad.data_url` | 是 | 广告 JSON 接口地址；请求超时默认 8 秒。 |
| `index_ad.rotation_seconds` | 否 | 默认 5 秒，建议范围 3–15 秒。 |
| `items[].id` | 是 | 唯一广告 ID。 |
| `items[].title` | 是 | 主标题，建议不超过 32 个汉字。 |
| `items[].image_url` | 是 | 广告图片 HTTPS 地址。 |
| `items[].target` | 否 | `web` 使用 `url` 打开网页；`vod` 使用 `vod_id` 打开影视详情。 |
| `items[].duration_seconds` | 否 | 单条广告展示秒数，优先于全局轮播秒数。 |
| `items[].active` | 否 | `false` 的广告不会显示。 |

应用会过滤字段不完整、图片地址无效、`active: false` 的项目；剩余广告按 `items` 数组顺序轮播。`data_url` 超时、请求失败、JSON 格式错误、无有效广告或图片加载失败时，首页将继续显示现在的 hero 卡片作为兜底，不影响影视列表和数据源功能。
