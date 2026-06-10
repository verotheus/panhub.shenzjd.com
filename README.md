# PanHub · 全网最全的网盘搜索

> 一个搜索框，搜遍全网网盘资源 —— 即搜即得、聚合去重、免费开源、零广告、轻量部署

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fwu529778790%2Fpanhub.shenzjd.com&project-name=panhub&repository-name=panhub.shenzjd.com)
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/wu529778790/panhub.shenzjd.com)
[![Docker Hub](https://img.shields.io/badge/docker-ghcr.io-blue?logo=docker)](https://github.com/wu529778790/panhub.shenzjd.com/pkgs/container/panhub)

**在线体验**：<https://panhub.shenzjd.com>

---

## ✨ 核心特性

### 🔍 智能搜索

- **多源聚合**：同时搜索 Telegram 80+ 频道 + 10+ 第三方插件
- **优先级调度**：高优先级频道优先返回，首屏结果提速 50%+
- **批量并发**：独立配置优先/普通频道并发数，充分利用网络带宽
- **暂停/继续**：搜索过程可随时暂停，找到目标立即停止
- **自动重试**：网络请求失败自动重试（指数退避策略）
- **智能缓存**：LRU 淘汰 + 内存监控 + 过期清理

### 📊 豆瓣影视榜单

- **四大榜单**：Top250、新片榜、口碑榜、北美票房
- **无限滚动**：滚动到底部自动加载更多内容
- **骨架屏加载**：流畅的视觉反馈，分类切换立即响应
- **一键搜索**：点击任意影视名称，自动发起网盘搜索
- **智能封面**：自动过滤UI标记图标，展示真实电影海报

### 🔥 热门搜索

- **实时热搜**：展示其他用户搜索词，点击即可搜索
- **数据持久化**：JSON 文件本地存储（Vercel/CF 自动降级内存）
- **搜索统计**：实时展示热搜榜使用次数

### 🎨 用户体验

- **深色模式**：完整支持深色主题，自动跟随系统偏好
- **响应式设计**：完美适配桌面、平板、手机
- **密码门**：可配置 `SEARCH_PASSWORD`，搜索时输入密码解锁（Cookie 30 天有效）
- **优雅降级**：单个插件/频道失败不影响整体

### 🛡️ 稳定性

- **超时控制**：可配置超时，避免无限等待
- **图片代理**：内置图片代理，解决跨域问题
- **60+ 测试用例**：核心逻辑 >90% 覆盖率

---

## 🚀 快速开始

### 方式一：Vercel 一键部署（推荐）

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fwu529778790%2Fpanhub.shenzjd.com&project-name=panhub&repository-name=panhub.shenzjd.com)

### 方式二：Cloudflare Workers 一键部署

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/wu529778790/panhub.shenzjd.com)

### 方式三：Docker 部署

```bash
# 快速启动
docker run --name panhub -p 4000:4000 -d ghcr.io/wu529778790/panhub.shenzjd.com:latest

# 数据持久化（推荐）
mkdir -p /root/panhub/data
docker run -d --name panhub -p 4000:4000 \
  -v /root/panhub/data:/app/data \
  ghcr.io/wu529778790/panhub.shenzjd.com:latest
```

### 方式四：本地开发

```bash
# 安装依赖
npm install

# 开发服务器
npm dev

# 运行测试
npm test

# 构建生产版本
npm build
```

---

## 📖 使用指南

### 搜索流程

1. **输入关键词并回车**开始搜索
2. **快速结果**：优先频道先返回（~50ms）
3. **深度结果**：剩余频道继续加载
4. **自动合并**：结果去重、按时间排序、分类型展示

### 操作按钮

| 按钮 | 功能 |
|------|------|
| **暂停/继续** | 随时控制搜索过程 |
| **重置** | 取消所有请求，清空结果和输入框 |
| **热搜词** | 点击直接搜索 |

### 设置面板

右上角设置按钮可配置：

- **插件管理**：启用/禁用第三方搜索插件
- **TG 频道**：配置优先/普通频道列表
- **性能参数**：并发数、超时时间、缓存时长

---

## ⚙️ 环境变量

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `LOG_LEVEL` | `info` | 日志级别（debug/info/warn/error） |
| `NITRO_PRESET` | auto-detect | 部署预设（vercel/cloudflare/docker） |
| `PORT` | `4000` | 服务端口 |
| `SEARCH_PASSWORD` | 空 | 非空时启用密码门，搜索时需输入正确密码（Cookie 30 天有效） |

### 部署差异说明

| 特性 | Docker/Node | CF Workers / Vercel |
|------|-------------|---------------------|
| 进程内缓存 | ✅ 持久（进程生命周期） | ❌ 每个 isolate 独立，不跨请求共享 |
| 热搜数据持久化 | ✅ JSON 文件（/app/data） | ❌ 仅内存（重启丢失） |
| 插件健康状态 | ✅ 持久 | ❌ 每次冷启动重置 |
| 推荐用途 | 自建服务器、NAS | 低流量个人使用 |

---

## 🏗️ 技术架构

### 前端技术栈

- **框架**：Nuxt.js 4 + Vue 3
- **样式**：原生 CSS（无框架依赖）
- **状态管理**：Vue Composition API
- **类型安全**：TypeScript

### 后端技术栈

- **运行时**：Nitro（Nuxt 内置）
- **HTML 解析**：Cheerio
- **HTTP 客户端**：ofetch
- **测试框架**：Vitest

### 核心模块

```
server/core/
├── services/
│   ├── searchService.ts    # 搜索编排器
│   ├── tg.ts               # TG 频道抓取
│   ├── doubanHotService.ts # 豆瓣榜单抓取
│   └── plugins/
│       ├── manager.ts      # 插件管理器
│       ├── pansearch.ts    # 盘搜
│       ├── qupansou.ts     # 去盘搜
│       └── ...
├── cache/
│   └── memoryCache.ts      # LRU 缓存
└── utils/
    └── fetch.ts            # 网络请求封装
```

---

## 📦 支持的网盘平台

| 平台 | 图标 | 说明 |
|------|------|------|
| 阿里云盘 | ☁️ | 支持分享链接解析 |
| 夸克网盘 | 🔎 | 支持分享链接解析 |
| 百度网盘 | 🧰 | 支持分享链接解析 |
| 115网盘 | 📦 | 支持分享链接解析 |
| 迅雷云盘 | ⚡ | 支持分享链接解析 |
| UC网盘 | 🧭 | 支持分享链接解析 |
| 天翼云盘 | ☁️ | 支持分享链接解析 |
| 123网盘 | # | 支持分享链接解析 |
| 移动云盘 | 📱 | 支持分享链接解析 |

---

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！

### 开发规范

- 使用 TypeScript 编写
- 核心功能必须包含单元测试
- 提交前运行 `npm test`
- 遵循 [Conventional Commits](https://www.conventionalcommits.org/)

### 测试

```bash
# 运行所有测试
npm test

# 监听模式
npm test:watch

# 生成覆盖率报告
npm test:coverage
```

---

## 🛡️ 免责声明

- 本项目仅用于技术学习与搜索聚合演示
- 不存储、不传播任何受版权保护的内容
- 所有资源链接来自公开网络（Telegram 频道、第三方网站）
- 请遵守当地法律法规与平台使用条款
- 侵权问题请联系源站处理

---

## 📄 许可证

[MIT License](LICENSE)

---

## 🙏 鸣谢

- [Nuxt.js](https://nuxt.com/) - 渐进式 Vue 框架
- [Nitro](https://nitro.unjs.io/) - Web 服务器工具包
- [Cheerio](https://cheerio.js.org/) - 快速、灵活的 HTML 解析器
- [Vitest](https://vitest.dev/) - 下一代测试框架

---

**⭐ 如果觉得有用，请给个 Star 支持一下！**

**在线体验**：<https://panhub.shenzjd.com>
