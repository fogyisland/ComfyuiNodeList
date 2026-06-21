# ComfyUI 节点元数据 Wiki 系统 — 设计规格

**日期**：2026-06-21
**状态**：已批准，待实现规划
**作者**：与 Claude 协作完成

## 1. 目标与背景

### 1.1 背景
ComfyUI 生态有数千个自定义节点，每个节点由不同作者维护。当用户在本地 ComfyUI 中同时安装多个节点时，常出现以下冲突：
- Python 包版本冲突（如 A 要 `torch>=2.0`，B 要 `torch<2.0`）
- Python 版本不兼容
- 同名节点类冲突（多个节点注册了相同的 `NODE_CLASS_MAPPINGS` 键）
- 节点作者声明的互斥

这些冲突往往要在用户实际运行工作流时才暴露，调试成本高。

### 1.2 目标
构建一个公开的 **节点元数据 Wiki 服务**，提供：
1. **公开网站**：浏览每个节点在各版本的要求，Wiki 风格
2. **协作编辑**：任何注册用户可提交修订，管理员审核后发布
3. **公共 API**：供本地 ComfyUI 程序调用，预先评估冲突
4. **自动扫描**：从 GitHub 抓取节点仓库最近 5 个 Release，解析依赖作为初始数据

### 1.3 非目标（明确不做）
- 不管理 ComfyUI 主程序本身
- 不做节点自动安装/卸载（终端 ComfyUI 自己处理）
- 不做评分/评论
- 第一版仅中文
- 不做实时协作编辑（提交审核即可）

## 2. 用户角色与权限

| 角色 | 权限 |
|---|---|
| **匿名用户** | 浏览节点、查询公开 API |
| **注册用户（submitter）** | 提交 Wiki 修订（进入 pending 状态）、查看历史 |
| **管理员（admin）** | 审核 pending 修订、批准/驳回、管理节点列表 |

注册方式：GitHub OAuth 登录。第一个注册用户自动成为管理员（启动期），后续可通过管理面板或 SQL 手动提升。

## 3. 系统架构

### 3.1 部署形态
采用 **Next.js 单体 + Python 扫描 worker** 的轻量架构：

```
┌──────────────────────────────────────────────────────────┐
│              Next.js 15 (TypeScript) - 单体应用            │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────┐  │
│  │  Wiki UI       │  │  Public Site   │  │  Admin     │  │
│  │  (浏览/编辑)   │  │  (SEO 友好)    │  │  Dashboard │  │
│  └────────────────┘  └────────────────┘  └────────────┘  │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Route Handlers (/api/v1/...)                       │  │
│  └────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Auth.js (NextAuth) - GitHub OAuth                  │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
                  │                       │
                  ▼                       ▼
          ┌──────────────┐         ┌──────────────┐
          │   MySQL 8.0  │         │   Redis      │
          └──────────────┘         └──────────────┘
                                           ▲
                  ┌────────────────────────┘
                  │
          ┌───────┴──────────┐
          │ Python Scanner   │  Celery beat 每周触发
          └──────────────────┘
```

### 3.2 三层数据流

```
GitHub 扫描 (Python)          Wiki 编辑 (用户)            发布 API (终端)
       │                          │                          │
       ▼                          ▼                          ▼
  raw_requirements         wiki_revisions             published_requirements
  (机器解析、只读)          (提交/审核/版本化)          (API 返回的实际数据)
       │                          │                          ▲
       └────── 初始化/打底 ────────┴──── 合并/覆盖 ──────────┘
```

- **raw_requirements**：Python 扫描器从 GitHub 自动写入，作为默认值
- **wiki_revisions**：用户每次编辑保存一条新记录，状态为 pending / approved / rejected
- **published_requirements**：`raw_requirements` 字段 + 最新 approved `wiki_revisions` 覆盖合并后的视图

## 4. 数据模型（MySQL 8.0）

### 4.1 用户表 `users`

| 列 | 类型 | 说明 |
|---|---|---|
| id | BIGINT PK AUTO_INCREMENT | |
| github_id | BIGINT UNIQUE | GitHub 用户 ID |
| username | VARCHAR(64) | GitHub 用户名 |
| email | VARCHAR(255) NULL | |
| avatar_url | VARCHAR(512) | |
| role | ENUM('user','admin') DEFAULT 'user' | |
| created_at | DATETIME DEFAULT CURRENT_TIMESTAMP | |

### 4.2 节点主表 `nodes`

| 列 | 类型 | 说明 |
|---|---|---|
| id | BIGINT PK | |
| github_owner | VARCHAR(128) | |
| github_repo | VARCHAR(128) | |
| name | VARCHAR(255) | 显示名（来自 pyproject 或 README） |
| author | VARCHAR(128) | |
| description | TEXT | |
| status | ENUM('active','deprecated','hidden') DEFAULT 'active' | |
| created_at, updated_at | DATETIME | |
| UNIQUE (github_owner, github_repo) | | |

### 4.3 节点版本表 `node_versions`

每个节点只保留最近 5 个 Release。

| 列 | 类型 | 说明 |
|---|---|---|
| id | BIGINT PK | |
| node_id | BIGINT FK → nodes(id) | |
| version_tag | VARCHAR(64) | 如 `v1.2.3` |
| git_sha | CHAR(40) | 提交 SHA |
| release_date | DATETIME | |
| scanned_at | DATETIME DEFAULT CURRENT_TIMESTAMP | |
| UNIQUE (node_id, version_tag) | | |

### 4.4 原始扫描数据 `node_raw_requirements`

| 列 | 类型 | 说明 |
|---|---|---|
| version_id | BIGINT PK FK → node_versions(id) | 一对一 |
| python_min | VARCHAR(16) NULL | 如 `3.10` |
| python_max | VARCHAR(16) NULL | 如 `3.12`，NULL 表示无上限 |
| dependencies | JSON | 标准化依赖数组：`[{name, spec, min_version, max_version, is_pinned}]`，`min_version`/`max_version` 由 Python 端 `packaging` 预解析，便于 TS 端直接做集合运算 |
| node_class_mappings | JSON | 节点类名数组 |
| incompatibilities | JSON | 作者声明的互斥节点 `["comfyui-impact-pack"]` |
| scan_warnings | JSON | 解析过程中的告警 |
| raw_files | JSON | 抓取的原始文件片段（用于调试） |

### 4.5 Wiki 修订表 `wiki_revisions`

| 列 | 类型 | 说明 |
|---|---|---|
| id | BIGINT PK | |
| version_id | BIGINT FK → node_versions(id) | |
| author_id | BIGINT FK → users(id) | 提交者 |
| python_min, python_max | VARCHAR(16) NULL | 可覆盖原始扫描 |
| dependencies | JSON | 可覆盖/补充 |
| node_class_mappings | JSON | 可覆盖/补充 |
| incompatibilities | JSON | 可覆盖/补充 |
| notes_md | MEDIUMTEXT | 用户 Markdown 备注 |
| edit_summary | VARCHAR(500) | 编辑说明 |
| status | ENUM('pending','approved','rejected') DEFAULT 'pending' | |
| reviewer_id | BIGINT FK → users(id) NULL | |
| review_note | TEXT NULL | 审核意见 |
| reviewed_at | DATETIME NULL | |
| created_at | DATETIME DEFAULT CURRENT_TIMESTAMP | |
| INDEX (version_id, status, created_at DESC) | | |

约束：每个 `version_id` 同时只能有一条 `status='approved'` 记录。MySQL 8 不支持部分唯一索引，采用应用层事务保证。

### 4.6 节点收录任务表 `node_submissions`

用于管理"我要登记一个新节点"的请求。

| 列 | 类型 | 说明 |
|---|---|---|
| id | BIGINT PK | |
| submitter_id | BIGINT FK → users(id) | |
| github_url | VARCHAR(512) | |
| status | ENUM('pending','approved','rejected') DEFAULT 'pending' | |
| reviewer_id | BIGINT FK → users(id) NULL | |
| review_note | TEXT NULL | |
| created_at, reviewed_at | DATETIME | |

## 5. API 设计

### 5.1 公开 API（无需认证，供终端 ComfyUI 调用）

```
GET  /api/v1/nodes
  ?page=1&page_size=20&search=xxx
  → 节点列表（分页、按名称/作者搜索）

GET  /api/v1/nodes/{owner}/{repo}
  → 单个节点详情 + 版本列表

GET  /api/v1/nodes/{owner}/{repo}/versions/{tag}
  → 单版本完整 published 数据（终端主要调这个）
  → 返回 raw_requirements 与最新 approved wiki_revisions 合并结果

POST /api/v1/conflicts/check
  Body: {
    "installed": [
      {"owner": "foo", "repo": "bar", "version_tag": "v1.0.0"},
      ...
    ]
  }
  → {
    "conflicts": [
      {
        "type": "python_version" | "package_version" | "node_class" | "incompatibility",
        "severity": "error" | "warning",
        "nodes": [...],
        "detail": "..."
      }
    ],
    "checked_at": "..."
  }
```

### 5.2 Wiki API（需登录）

```
GET   /api/v1/wiki/{version_id}
  → 当前 published 版本（raw + 最新 approved 合并视图）

GET   /api/v1/wiki/{version_id}/history?page=1
  → 修订历史列表（含 diff 元数据）

GET   /api/v1/wiki/revisions/{revision_id}
  → 单条修订详情

POST  /api/v1/wiki/{version_id}/revisions
  Body: { python_min, python_max, dependencies, ..., notes_md, edit_summary }
  → 创建新修订，status=pending，返回 revision_id

GET   /api/v1/wiki/diff?from={rev_id}&to={rev_id}
  → 两版本之间的字段级 diff（用于历史页展示）
```

### 5.3 节点收录 API

```
POST /api/v1/submissions
  Body: { github_url }
  → 创建收录请求

GET  /api/v1/submissions/mine
  → 当前用户提交的收录请求列表
```

### 5.4 管理员 API

```
GET   /api/v1/admin/revisions/pending?page=1
  → 待审核修订列表

POST  /api/v1/admin/revisions/{id}/approve
  Body: { review_note? }
  → 批准（事务：标记该修订 approved，同时将同 version_id 下其他 approved 改为空，或改为历史归档）

POST  /api/v1/admin/revisions/{id}/reject
  Body: { review_note }
  → 驳回

GET   /api/v1/admin/submissions/pending
POST  /api/v1/admin/submissions/{id}/approve
POST  /api/v1/admin/submissions/{id}/reject

GET   /api/v1/admin/users
POST  /api/v1/admin/users/{id}/role   Body: { role: "admin" | "user" }
```

## 6. 冲突检测引擎

### 6.1 输入
一组 `(owner, repo, version_tag)` 三元组。

### 6.2 输出
冲突数组，每项包含：
- `type`：四种之一
- `severity`：`error` 或 `warning`
- `nodes`：涉及的节点列表
- `detail`：人类可读说明

### 6.3 算法

```
输入 installed = [NodeVersionRef, ...]

1) 加载所有 NodeVersionRef 的 published_requirements（含合并后数据）

2) Python 版本冲突：
   - 收集所有 (python_min, python_max)
   - 计算交集：max(python_min) <= min(python_max) ?
   - 若无交集，生成一个 error 冲突
   - 警告：若交集为空集但允许低于 max（比如全部都不要 Python 3.12）也算 error

3) 包依赖冲突：
   - 按包名分组，收集所有 spec 字符串
   - 调用 Node.js 库 `pep440`（`npm i pep440`）解析每个 spec 为 `min_version`、`max_version`、`is_pinned`
   - 求所有 spec 的交集：max(各 min) <= min(各 max) 才可满足
   - 若 `is_pinned` 为 true（即 `==x.y.z`）与其他 spec 不兼容 → error
   - 若交集为空 → error 冲突（列出涉及节点和冲突的包）

4) 同名节点冲突：
   - 收集所有 node_class_mappings
   - 同名 class 出现 ≥2 次 → error 冲突

5) 互斥节点：
   - 对每对节点，检查 incompatibilities 列表中是否包含对方
   - 双向声明或单向声明均可 → warning 冲突
```

实现位置：`web/lib/conflict-engine.ts`，纯 TypeScript，依赖 `pep440` npm 包做 PEP 440 解析；扫描阶段 Python 端仅做"提取原始 spec 字符串"的轻量工作，复杂的约束求解在 TS 端完成（无运行时 Python 依赖）。

## 7. Python 扫描 Worker

### 7.1 技术
- Python 3.11+
- Celery 5 + Redis broker
- 库：`httpx`（GitHub API）、`packaging`（解析 spec 字符串为标准化格式，便于 TS 端读取）、`tomli`（pyproject.toml 解析）

### 7.2 任务流（每周触发一次 + 手动触发）

```
celery beat schedule: every Monday 03:00 UTC
     │
     ▼
[Task 1] fetch_pending_nodes
     - 从 nodes 表取所有 active 节点
     - 产出 [(node_id, owner, repo), ...]
     │
     ▼
[Task 2] fetch_releases (并行，per-node)
     - GitHub API GET /repos/{owner}/{repo}/releases
     - 取前 5 个 release（按 published_at 倒序）
     - upsert 到 node_versions 表
     │
     ▼
[Task 3] fetch_and_parse_version (并行，per-version)
     - 下载 tarball / zipball（按 git_sha）
     - 解析以下文件：
       - pyproject.toml → dependencies, python_requires
       - requirements.txt → dependencies
       - install.py → 特殊处理（提取 os.system / subprocess / pip install 等）
       - __init__.py 或 nodes.py → NODE_CLASS_MAPPINGS 提取
       - README.md → incompatibilities 声明（grep 关键字）
     - 标准化依赖为 [{name, spec}, ...]
     - upsert 到 node_raw_requirements
     │
     ▼
[Task 4] cleanup_old_versions
     - 每个节点若版本数 > 5，删除最旧的（保留最近 5）
     - 同步删除对应 raw_requirements
     - 注意：不删除 wiki_revisions（保留历史）
```

### 7.3 GitHub API 限流
- 未认证：60 req/h
- 使用 GitHub Token（环境变量 `GITHUB_TOKEN`）：5000 req/h
- Token 通过 PAT 配置，写入 `.env`

### 7.4 错误处理
- 单节点失败不影响其他节点（per-node 任务隔离）
- 失败重试 3 次，指数退避
- 失败记录到 `scan_failures` 表，管理员可见

## 8. 前端页面

### 8.1 公开浏览页（SEO 友好，SSR/ISR）

| 路由 | 功能 |
|---|---|
| `/` | 首页：节点总数、最近更新、热门节点 |
| `/nodes` | 节点列表（分页、搜索、过滤） |
| `/nodes/{owner}/{repo}` | 节点详情：元数据 + 版本列表 |
| `/nodes/{owner}/{repo}/versions/{tag}` | 单版本详情：完整 published 数据 + 冲突预览 |

### 8.2 Wiki 页（需登录）

| 路由 | 功能 |
|---|---|
| `/wiki/{version_id}` | 编辑页：表单（Python 范围、依赖表、互斥列表、Markdown 备注） |
| `/wiki/{version_id}/history` | 历史列表 + diff 视图 |
| `/wiki/{version_id}/submit` | 提交确认页（显示 edit_summary） |

### 8.3 管理后台

| 路由 | 功能 |
|---|---|
| `/admin` | Dashboard：待审核数、最近活动 |
| `/admin/revisions` | 待审核修订列表 + 一键批准/驳回 |
| `/admin/submissions` | 待审核节点收录 |
| `/admin/users` | 用户角色管理 |

### 8.4 关键组件

- `<NodeRequirementTable>`：依赖表格，支持增删改
- `<PythonVersionRange>`：Python 版本范围输入（双数值框）
- `<IncompatibilityEditor>`：互斥节点列表（带自动补全）
- `<MarkdownEditor>`：Tiptap 富文本（含代码块、表格）
- `<DiffViewer>`：基于 `react-diff-viewer`
- `<ConflictPreview>`：实时显示当前编辑内容若发布，会跟哪些已发布节点冲突

## 9. 认证

- NextAuth.js v5 (Auth.js)
- Provider：GitHub OAuth
- 环境变量：`GITHUB_CLIENT_ID`、`GITHUB_SECRET`、`NEXTAUTH_SECRET`
- 首次注册用户自动设为 admin（启动期特权），通过环境变量 `BOOTSTRAP_ADMIN_GITHUB_ID` 控制具体的人
- 之后所有新注册用户默认 `role='user'`

## 10. 部署

### 10.1 docker-compose 服务清单

```yaml
services:
  web:        # Next.js 应用，构建后 node 镜像运行
  scanner:    # Python Celery worker
  beat:       # Celery beat 调度器
  mysql:      # MySQL 8.0
  redis:      # Redis 7
```

### 10.2 环境变量（`.env`）

```
DATABASE_URL=mysql://user:pass@mysql:3306/comfyui_nodes
NEXTAUTH_SECRET=...
NEXTAUTH_URL=https://...
GITHUB_CLIENT_ID=...
GITHUB_SECRET=...
SCANNER_GITHUB_TOKEN=ghp_...
BOOTSTRAP_ADMIN_GITHUB_ID=12345
CELERY_BROKER_URL=redis://redis:6379/0
CELERY_RESULT_BACKEND=redis://redis:6379/1
```

## 11. 项目结构

```
D:\ToolDevelop\ComfyUINodeAnalysis\
├── docker-compose.yml
├── .env.example
├── README.md
├── docs/
│   └── superpowers/specs/
│       └── 2026-06-21-comfyui-node-wiki-design.md
├── web/                       # Next.js 15 应用
│   ├── app/
│   │   ├── (public)/          # 公开浏览页
│   │   ├── wiki/              # Wiki 编辑
│   │   ├── admin/             # 审核面板
│   │   ├── api/v1/            # API routes
│   │   ├── login/
│   │   └── layout.tsx
│   ├── components/
│   ├── lib/
│   │   ├── db.ts              # Prisma client
│   │   ├── auth.ts            # NextAuth 配置
│   │   └── conflict-engine.ts
│   ├── prisma/
│   │   └── schema.prisma
│   ├── package.json
│   └── Dockerfile
├── scanner/                   # Python 扫描 worker
│   ├── celery_app.py
│   ├── tasks/
│   │   ├── fetch_releases.py
│   │   └── parse_version.py
│   ├── parsers/
│   │   ├── requirements_txt.py
│   │   ├── pyproject_toml.py
│   │   └── install_py.py
│   ├── requirements.txt
│   └── Dockerfile
```

## 12. 验收标准

### 12.1 功能验收
- [ ] 用户可通过 GitHub OAuth 登录
- [ ] 用户可浏览节点列表和详情
- [ ] 用户可提交 Wiki 修订（pending 状态）
- [ ] 管理员可审核并发布修订
- [ ] 公开 API 返回合并后的 published 数据
- [ ] 冲突检测 API 正确识别四种冲突
- [ ] Python 扫描器每周自动更新最近 5 个版本
- [ ] Diff 视图能展示修订差异

### 12.2 性能验收
- 节点列表页首屏 TTFB < 500ms
- 单版本详情页 TTFB < 300ms
- 冲突检测 API（10 个节点）< 1s

### 12.3 安全验收
- 未认证用户无法访问 wiki/admin API
- 普通用户无法访问审核 API
- GitHub Token 仅在服务端使用，不暴露给前端

## 13. 风险与缓解

| 风险 | 缓解 |
|---|---|
| GitHub API 限流 | 使用 PAT（5000/h）；缓存 release 列表；per-node 失败隔离 |
| 节点作者格式混乱（requirements.txt/install.py/pyproject.toml 都可能用） | 解析器分别处理，按优先级合并；解析失败不阻断其他节点 |
| 单个 approved 唯一性约束无法用 DB 索引 | 应用层事务 + SELECT ... FOR UPDATE 保证 |
| 首次部署无节点 | 提供 "添加节点收录" 工作流，用户提交 GitHub URL，管理员批准后入库 |
| 扫描器与 Web 共享 MySQL 可能锁争用 | 扫描器在低峰期（凌晨 3 点）运行；只写自己的几张表 |

## 14. 后续可扩展（不在本版本范围）

- Webhook 接收 GitHub Release 通知，触发增量扫描
- 节点评分/标签系统
- 多语言 Wiki（i18n）
- 实时冲突矩阵视图（哪个节点跟哪个冲突的全网表）
- 集成到 ComfyUI-Manager，作为其依赖源