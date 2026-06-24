# ComfyUI Node Wiki

公开的 ComfyUI 节点元数据 Wiki 服务。本仓库目前包含 **Plan 1：Foundation + Public Read-Only Wiki Site** 的实现。

完整设计规格：[`docs/superpowers/specs/2026-06-21-comfyui-node-wiki-design.md`](docs/superpowers/specs/2026-06-21-comfyui-node-wiki-design.md)。

## 先决条件

- Node.js 20 LTS
- pnpm 9
- 一个可连接的 MySQL 5.7+ / 8.0+ 实例（本地安装或远程均可，需具备 `CREATE DATABASE` 权限）
- `mysql` 命令行客户端（仅用于一次性创建数据库，可选用 Workbench / DBeaver 等 GUI 替代）

## 首次启动

```bash
# 1. 安装依赖
cd web && pnpm install

# 2. 复制环境变量并填入你的 MySQL 连接信息
cp web/.env.example web/.env
# 编辑 web/.env，把 DATABASE_URL 改为 mysql://USER:PASSWORD@HOST:3306/comfyui_nodes

# 3. 创建数据库（仅首次需要）
mysql -h HOST -u USER -pPASSWORD -e \
  "CREATE DATABASE IF NOT EXISTS comfyui_nodes CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   CREATE DATABASE IF NOT EXISTS comfyui_nodes_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# 4. 应用数据库迁移（开发库）
cd web && pnpm prisma migrate dev

# 5. 灌入示例数据（3 个节点 / 4 个版本）
pnpm prisma:seed

# 6. 启动开发服务器
pnpm dev
```

打开 http://localhost:9999 应能看到首页（含 3 个种子节点）。

## 测试

```bash
cd web
pnpm test          # 单次运行所有 Vitest 套件
pnpm test:watch    # 开发期间监听模式
```

集成测试使用独立数据库 `comfyui_nodes_test`（配置在 `web/.env.test`）。`tests/setup.ts` 在每个测试运行前会自动 `prisma db push` 并清空表。

## 项目结构

```
.
├── .env.example                # 环境变量样例（DATABASE_URL、GitHub OAuth）→ 实际位于 web/.env.example
├── docs/superpowers/
│   ├── specs/                  # 设计规格
│   └── plans/                  # 实现计划（本文件所在目录）
└── web/                        # Next.js 15 应用
    ├── prisma/                 # schema + seed
    ├── app/                    # App Router 页面 + API 路由
    ├── lib/                    # 业务逻辑（db、auth、published 等）
    └── tests/                  # Vitest 单测 + 集成测试
```

## 下一步

- Plan 2：Wiki 编辑流程（提交修订、审核、Diff 查看）
- Plan 3：冲突检测引擎 + `POST /api/v1/conflicts/check`
- Plan 4：Python Celery 扫描器
- Plan 5：生产部署
