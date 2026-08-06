# ComfyUI Node Wiki — 商务风格视觉重设计 + 提交节点功能

## Context

当前网站(Plan 1-5 已落地)在 Tailwind 起步页的视觉语言上跑了一年,用户反馈"商务风格优化,当前有些简单"。具体观察:
- 单色 accent `#2563eb` + 通用灰阶,缺品牌色阶
- 默认 system sans-serif,字重梯度单一
- 平面化卡片(`border + bg-white`),无阴影/渐变/层级
- 节奏:`max-w-5xl p-8` 通用 spacing,无 8pt 网格感
- 像 v0 起步页,缺品牌识别

同时,ComfyUI Manager 同步功能(2026-08-06 落地)虽然让 admin 可以批量收录节点,**普通用户没有提交自己节点的入口**。`node_submissions` 表已存在,但只有 admin 审核 UI(`/admin/submissions`),缺 `/submit` 用户表单和 `/my-submissions` 用户追踪页。

## Goals

1. 把视觉语言从「Tailwind 起步页」升级到「Stripe 形式商务化」:渐变 hero、品牌色阶、字重梯度、暗色模式、品牌 Logo。
2. 新增「用户提交节点」端到端流程:表单页 + 我的提交页 + Header 入口。
3. 不破坏现有功能(wiki 编辑、admin 审核、Manager sync、auth)。

## Non-Goals

- 不引入 Tailwind 之外的 UI 框架(不引 shadcn / radix / MUI)
- 不引入外部图片 / icon CDN(图标用内联 SVG + Heroicons 风格的 SVG)
- 不引入 Tailwind 之外的字体加载器(用 `next/font/google`)
- 不做 A/B 测试 / analytics
- **Manager sync 任务的更新**(从 upstream 填 name/description)— 列 Followups
- **邮件通知** — 列 Followups
- **GitHub OAuth 自动取仓库元数据** — 列 Followups
- **favicon 重新设计** — 列 Followups(本期先用同一个 SVG)

---

## Design — Token 体系

### 字体

| Role | 字体 | 加载方式 |
|---|---|---|
| `font-sans` / `font-display` | Inter Variable | `next/font/google`,weight 100-900,subset latin |
| `font-mono` | JetBrains Mono Variable | `next/font/google`,weight 100-800 |
| Feature settings | `cv11, ss01, ss03` | Inter stylistic sets:数字等宽 + 圆润 a/g |

通过 `next/font` 把字体变量挂到 `<html>` 上,CSS 变量 `--font-inter` / `--font-jbmono`,Tailwind config `fontFamily.sans = ['var(--font-inter)']`。

### 字号梯度(rem,基于 16px)

| Token | size / lh / weight / tracking |
|---|---|
| `text-display-2xl` | 4.5 / 1.05 / 700 / -0.03em |
| `text-display-xl` | 3.5 / 1.1 / 700 / -0.025em |
| `text-display-lg` | 2.5 / 1.15 / 700 / -0.02em |
| `text-display-md` | 2 / 1.2 / 600 / -0.015em |
| `text-display-sm` | 1.5 / 1.3 / 600 / -0.01em |
| `text-lg` | 1.125 / 1.55 / 500 |
| `text-base` | 1 / 1.6 / 400 |
| `text-sm` | 0.875 / 1.5 / 400 |
| `text-xs` | 0.75 / 1.45 / 500 |
| `text-2xs` | 0.6875 / 1.4 / 600 |

### 间距(4pt 网格)

| Token | 值 |
|---|---|
| `space-1` | 4px |
| `space-2` | 8px |
| `space-3` | 12px |
| `space-4` | 16px |
| `space-6` | 24px |
| `space-8` | 32px |
| `space-12` | 48px |
| `space-16` | 64px |
| `space-24` | 96px |

容器:`max-w-6xl`(1152px);移动端 `max-w-screen-sm` + `p-4`。

### 圆角

| Token | 值 |
|---|---|
| `rounded-xs` | 4px |
| `rounded-sm` | 6px |
| `rounded-md` | 10px |
| `rounded-lg` | 14px |
| `rounded-xl` | 20px |
| `rounded-pill` | 9999px |

### 颜色 token(完整)

#### 亮色 (`:root`)

| Token | 值 | 用途 |
|---|---|---|
| `--bg-canvas` | `#FAFBFC` | 页面底色,极轻冷调 |
| `--bg-surface` | `#FFFFFF` | 卡片 / 表单 |
| `--bg-subtle` | `#F4F6FA` | 表头 / hover 区 |
| `--border-default` | `#E5E9F0` | 默认描边 |
| `--border-strong` | `#CDD3DF` | hover/聚焦 |
| `--fg-primary` | `#0B0F1A` | H1-H2 |
| `--fg-secondary` | `#4A5266` | 正文 |
| `--fg-tertiary` | `#8B92A6` | meta |
| `--brand-50` | `#EEF2FF` | 极淡背景 |
| `--brand-100` | `#E0E7FF` | 浅 hover |
| `--brand-500` | `#4F46E5` | 主品牌色 |
| `--brand-600` | `#4338CA` | active |
| `--brand-400` | `#818CF8` | 暗模式品牌 |
| `--accent-cyan` | `#06B6D4` | 渐变副色 |
| `--success` | `#16A34A` | |
| `--warning` | `#D97706` | |
| `--danger` | `#DC2626` | |
| `--gradient-brand` | `linear-gradient(135deg, #4F46E5 0%, #06B6D4 100%)` | |
| `--shadow-sm` | `0 1px 2px rgb(11 15 26 / 0.04), 0 1px 3px rgb(11 15 26 / 0.06)` | 卡片默认 |
| `--shadow-md` | `0 4px 12px rgb(11 15 26 / 0.08), 0 1px 3px rgb(11 15 26 / 0.04)` | hover 抬起 |
| `--shadow-lg` | `0 12px 32px rgb(11 15 26 / 0.10), 0 4px 8px rgb(11 15 26 / 0.06)` | modal/toast |

#### 暗色 (`.dark` 类挂在 `<html>`)

| Token | 值 |
|---|---|
| `--bg-canvas` | `#0A0E1A` |
| `--bg-surface` | `#121826` |
| `--bg-subtle` | `#1A2030` |
| `--border-default` | `#1F2937` |
| `--border-strong` | `#374151` |
| `--fg-primary` | `#F4F6FA` |
| `--fg-secondary` | `#C2C9D6` |
| `--fg-tertiary` | `#6B7388` |
| `--brand-500` | `#818CF8`(降饱和) |
| 其它 brand / semantic | 保持同色,降饱和 10% |
| `--shadow-sm/md/lg` | 全部 `rgb(0 0 0 / 0.3+)` 提高不透明度 |

### Tailwind 配置(`web/tailwind.config.ts`)

```ts
theme.extend.colors: {
  canvas: 'var(--bg-canvas)',
  surface: 'var(--bg-surface)',
  subtle: 'var(--bg-subtle)',
  border: { default: 'var(--border-default)', strong: 'var(--border-strong)' },
  fg: { primary: 'var(--fg-primary)', secondary: 'var(--fg-secondary)', tertiary: 'var(--fg-tertiary)' },
  brand: { 50: 'var(--brand-50)', 100: 'var(--brand-100)', 400: 'var(--brand-400)',
           500: 'var(--brand-500)', 600: 'var(--brand-600)' },
  accent: 'var(--accent-cyan)',
  success: 'var(--success)', warning: 'var(--warning)', danger: 'var(--danger)',
}
theme.extend.boxShadow: { sm: 'var(--shadow-sm)', md: 'var(--shadow-md)', lg: 'var(--shadow-lg)' }
theme.extend.fontFamily: { sans: ['var(--font-inter)'], mono: ['var(--font-jbmono)'] }
theme.extend.borderRadius: { xs: '4px', sm: '6px', md: '10px', lg: '14px', xl: '20px', pill: '9999px' }
theme.extend.backgroundImage: { 'gradient-brand': 'var(--gradient-brand)' }
```

---

## Design — 组件样式

### Button

| Variant | Spec |
|---|---|
| Primary | `bg-gradient-brand text-white shadow-sm hover:shadow-md hover:brightness-105 px-5 py-3 rounded-sm text-sm font-semibold tracking-tight` |
| Secondary | `bg-surface border border-border-default hover:border-border-strong text-fg-primary` |
| Ghost | `text-fg-secondary hover:text-fg-primary hover:underline-offset-4 hover:underline` |
| Destructive | `bg-danger text-white shadow-sm hover:bg-red-700` |
| Icon | `36×36 rounded-md hover:bg-subtle text-fg-secondary hover:text-fg-primary` |

### Card

| Variant | Spec |
|---|---|
| `default` | `bg-surface border border-border-default rounded-md p-6 shadow-sm hover:border-border-strong hover:shadow-md transition` |
| `elevated` | `bg-surface rounded-md p-6 shadow-md` |
| `feature` (Hero 子卡片) | `bg-white/5 backdrop-blur border border-white/10 text-white rounded-md p-6`(暗底) |
| `flat` | `bg-subtle rounded-md p-6` |

卡片标题 `text-display-sm`;meta `text-xs text-fg-tertiary`(右上)。

### Badge / Pill

```
default: bg-subtle text-fg-secondary rounded-xs px-2 py-0.5
brand:   bg-brand-50 text-brand-600
success: bg-green-50 text-success
warning: bg-amber-50 text-warning
danger:  bg-red-50 text-danger
info:    bg-cyan-50 text-accent-cyan
mono:    bg-transparent border border-border-default font-mono text-xs
```

### Input / Textarea

```
bg-surface border border-border-default rounded-sm
px-3.5 py-2.5 text-base
focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none
label: text-sm font-medium text-fg-secondary mb-1.5
helper: text-xs text-fg-tertiary mt-1.5
error state: border-danger + helper text-danger
```

### Table

```
容器: bg-surface border border-border-default rounded-md overflow-hidden
表头: bg-subtle text-2xs font-semibold uppercase tracking-wider text-fg-tertiary py-3 px-4
行:  divide-y divide-border-default hover:bg-subtle,py-3.5 px-4
cell对齐 baseline,行内 badge 居中
```

---

## Design — Logo + 暗色模式切换

### Logo SVG(`web/app/_components/Logo.tsx`)

24×24 viewBox,六边形外框 + 中心节点 + 三条放射线 + 三个端点节点,全部用 `url(#brand)` 渐变填充。同一 SVG 在亮 / 暗背景下都对比足够,不需要两套。

文字 logo 用 `bg-clip-text text-transparent bg-gradient-brand`,只显示渐变。

### 暗色模式切换(`web/app/_components/ThemeToggle.tsx`)

- 三个选项 dropdown:`亮 / 暗 / 系统`
- 状态保存:localStorage `cnw-theme` + cookie `cnw-theme`(SSR 用 cookie 避免 hydration mismatch)
- 应用:在 `<html>` 上 toggle `.dark` class
- 系统模式:监听 `matchMedia('(prefers-color-scheme: dark)')`,变化时自动 re-apply
- 首次访问默认 `system`

### SSR 策略

```tsx
// RootLayout (server)
const cookieStore = await cookies()
const theme = cookieStore.get('cnw-theme')?.value ?? 'system'
const initialClass = theme === 'dark' ? 'dark' :
                     theme === 'light' ? '' :
                     // system: 不加 class,在 client mount 时决定
                     ''

<html lang="zh" className={initialClass} suppressHydrationWarning>
```

`suppressHydrationWarning` 是因为 client mount 后根据系统偏好可能加 `.dark`,这是预期不一致。

---

## Design — 页面级布局

### Homepage `/`

- Sticky Header(blur bg,border-b 1px)
- Hero(高度 ~480px,渐变 mesh bg + 噪点)
  - 标题 `text-display-2xl` 偏左 max-w-2xl:`ComfyUI Node Wiki` + slogan `Build with confidence.`
  - 搜索 input + Sync CTA(右侧用户可见)
  - meta 行:`3 nodes · 4 versions · 2 contributors`
- 最近更新 3 列 grid(用新版 NodeCard 组件,default variant)
- 价值主张三栏(收录 / 可信 / 协作)
- Footer(版权 + GitHub link)

### `/nodes`

- Page header:`All nodes` + meta
- Sticky filter bar:search / status / author / sort
  - 选中 chip:brand-50 bg
- Node list(card stack,divide-y 风格或 grid)
- Pagination

### `/admin`

- Header + 左侧 sidebar(240px sticky)
  - Sidebar item active:左边 2px brand-500 边线
- ManagerSyncButton(顶部)
- 4 个 stat card(原 2 个扩 4:今日扫描 / 本周同步可空)
- 最近活动改 dense table

### `/wiki/[versionId]`

- Breadcrumb
- Title row:展示名 + meta(by / date / sha mono)
- Tabs(underline-style,active 下边 2px brand-500):Overview / Dependencies / Incompat. / History
- Tab content + 右侧 sidebar(actions / status)

### `/login` / `/register`

- 简化 Header(仅 logo)
- 卡片 `max-w-md` 居中,`shadow-lg rounded-lg`
- 背景:浅 gradient mesh(极淡)

### `/submit`(新增)

见 §New Feature。

### `/my-submissions`(新增)

见 §New Feature。

---

## New Feature — 用户提交节点

### Schema 变更

```prisma
// web/prisma/schema.prisma
model NodeSubmission {
  id           BigInt           @id @default(autoincrement())
  submitter_id BigInt
  github_url   String           @db.VarChar(512)
  name         String?          @db.VarChar(128)   // NEW
  description  String?          @db.Text           // NEW
  status       SubmissionStatus @default(pending)
  reviewer_id  BigInt?
  review_note  String?          @db.Text
  created_at   DateTime         @default(now())
  reviewed_at  DateTime?

  submitter User  @relation("SubmissionSubmitter", fields: [submitter_id], references: [id])
  reviewer  User? @relation("SubmissionReviewer", fields: [reviewer_id], references: [id])

  @@index([status, created_at])
  @@map("node_submissions")
}
```

migration:`pnpm prisma migrate dev --name add_submission_name_description`

两列可空,不破坏 Manager sync 已有 pending 行(它们 name/description 为 null)。新提交要求三字段全填。

### `/submit` 页面布局

- Breadcrumb:`/ submit`
- 标题 + 副标(说明审核流程)
- 表单 `max-w-2xl` 居中,卡片 `rounded-lg shadow-md`,字段间距 `space-6`:
  - GitHub URL *(必填)* + 实时解析预览(显示 owner/repo + 链接图标;已存在 → error "已收录";已有 pending → warning "已有待审")
  - 展示名 *(必填)* — text input,maxLength 128
  - 简短描述 *(必填)* — textarea,maxLength 500,3 行
  - `[取消] [提交审核]`(Primary)
- 提交后:替换表单为「提交成功」卡片:`已加入待审队列,ID: #123` + `[查看我的提交]` 按钮 → `/my-submissions`

### 状态机

```
idle → validating(debounce 300ms) → preview_shown → submitting → success | error
  - error: inline 显示(invalid-url / missing-field / already-exists / duplicate-pending / server)
```

### API 契约

```
POST /api/v1/submissions
  auth: required(NextAuth session)
  body: { github_url: string, name: string, description: string }
  201 → { id: number, status: 'pending', created_at: ISO }
  400 → { error: 'invalid-url' | 'missing-field' | 'description-too-long' }
  401 → { error: 'unauthenticated' }
  409 → { error: 'already-exists' | 'duplicate-pending' }

GET /api/v1/submissions/mine
  auth: required
  200 → Array<{
    id, github_url, name, description,
    status: 'pending' | 'approved' | 'rejected',
    review_note: string | null,
    created_at, reviewed_at: ISO | null
  }>
```

server-side 校验(在 `web/lib/submissions-user.ts`):
- `github_url` 命中 `parseGithubUrl`(复用 `lib/submissions.ts` 已有函数)
- `name` 1-128 chars,trim
- `description` 1-500 chars,trim
- 重复检查:`tx.node.findUnique({ where: { github_owner_github_repo } })` 已存在 → `already-exists`
- 自己/他人的 pending:`tx.nodeSubmission.findFirst({ where: { github_url, status: 'pending' } })` → `duplicate-pending`

### `/my-submissions` 页面布局

- Header + 标题 + `[+ 提交新节点]` 按钮
- 筛选 tab:`全部 / 待审核 / 已通过 / 已拒绝`(URL query `?status=`)
- 列表项卡片:
  - pending:`#id name [pending badge] / github url / 提交时间`
  - approved:`#id name [approved badge] / 审核人 + 时间 / [查看 →]` 跳 `/nodes/owner/repo`
  - rejected:`#id name [rejected badge] / 审核备注(折叠)` 

### Header 改动(`web/app/(public)/_components/Header.tsx`)

登录用户 nav(新增):
```
[节点] [我的提交] [提交节点 +]
                                          ┌─ role=admin 才显示 ─┐
                                          │ Dashboard           │
                                          │ 待审修订 (N)        │
                                          │ 待审节点 (N)        │
                                          │ 退出                │
                                          └─────────────────────┘
```
「我的提交」直接链 `/my-submissions`;「提交节点」链 `/submit`;admin 下拉保留原 admin 子菜单。

未登录用户不变(显示 登录 / 注册)。

### 范围边界

本期 spec 不包含:
- Manager sync 任务从 upstream 填 name/description(Followup)
- 邮件通知(Followup)
- GitHub OAuth 自动取仓库元数据(Followup)

---

## Files Touched(估算)

新增:
- `web/app/_components/Logo.tsx`
- `web/app/_components/ThemeToggle.tsx`
- `web/app/_components/ThemeScript.tsx` — inline script 防 FOUC
- `web/app/_components/Button.tsx`(可选,直接写 class 也行)
- `web/app/(public)/_components/NodeCard.v2.tsx` 或替换原 NodeCard
- `web/app/(public)/submit/page.tsx`
- `web/app/(public)/submit/SubmitForm.tsx`
- `web/app/(public)/my-submissions/page.tsx`
- `web/app/(public)/my-submissions/MySubmissionsList.tsx`
- `web/app/api/v1/submissions/route.ts`
- `web/app/api/v1/submissions/mine/route.ts`
- `web/lib/submissions-user.ts`
- `web/prisma/migrations/<ts>_add_submission_name_description/migration.sql`

修改:
- `web/tailwind.config.ts`(完整 token)
- `web/app/globals.css`(CSS 变量 + .dark)
- `web/app/layout.tsx`(字体加载 + dark class + ThemeToggle 挂载)
- `web/app/(public)/_components/Header.tsx`(logo + nav + theme toggle + 登录用户菜单)
- `web/app/page.tsx`(hero 重做)
- `web/app/(public)/_components/NodeCard.tsx`(新样式)
- `web/app/(admin)/_components/AdminDashboard.tsx`(sidebar 布局 + stat 4 个)
- `web/app/(admin)/_components/ManagerSyncButton.tsx`(新按钮样式)
- `web/app/admin/layout.tsx`(sidebar 容器)
- `web/app/(public)/_components/Pagination.tsx`(新样式)
- `web/app/(public)/login/page.tsx` + `register/page.tsx`(卡片重做)
- `web/app/(public)/nodes/page.tsx` + `[owner]/[repo]/page.tsx` + `versions/[tag]/page.tsx`(新样式)
- `web/app/wiki/[versionId]/{page,submit/page}.tsx` 等 wiki 页面

---

## Testing

### 视觉

- 亮 / 暗模式对比截图(手测,记录到 spec §Followups)
- 5 个浏览器宽度:`375 / 640 / 1024 / 1280 / 1536`
- 关键页面截图:`/`, `/nodes`, `/admin`, `/wiki/[id]`, `/submit`, `/login`

### 功能

- vitest 组件测试(新增):
  - `<ThemeToggle>` 三选项切换 + localStorage + cookie 写
  - `<SubmitForm>` URL 实时解析 + 重复检测 + 提交后状态机
- API 集成测试(vitest + prisma test db):
  - POST `/api/v1/submissions`:
    - happy path 201 + DB row
    - 401 unauthenticated
    - 400 invalid-url / missing-field / description-too-long
    - 409 already-exists(已收录)
    - 409 duplicate-pending(自己已有)
    - 409 duplicate-pending(他人已有)
  - GET `/api/v1/submissions/mine`:只返回自己的
- 既有测试套件保持绿:`pnpm test`(vitest)+ `pytest`

---

## Risks & Open Questions

1. **暗色模式 + 暗色 Hero 的对比度**:Hero 在暗模式下是 `#0A0E1A` 底,白文字对比度 16+:1 通过 WCAG AAA。需要确认 svg logo 在暗背景下也清晰。
2. **CSS 变量切换的过渡**:切换亮/暗时全局颜色变化是瞬间的,可能闪烁。缓解:ThemeScript 在 `<head>` 注入 inline script,SSR HTML 渲染前就确定 class。
3. **`localStorage` 在跨标签同步**:用户在 tab A 切换主题,tab B 不会自动同步。本期不实现 `storage` 事件监听(简单优先)。
4. **`node_submissions.description` 列已有数据为 NULL**:旧 Manager sync 写入的行 description 为 null。admin 审核时这些行没有 description 可看。Followup 让 Manager sync 回填。
5. **Schema migration 顺序**:本次新增列,无破坏性。Manager sync 不需要改动即可继续工作。
6. **`max-w-6xl` 改动**:原 `max-w-5xl`(1024px)→ `max-w-6xl`(1152px)。表格行宽 +128px,需要确认 admin tables 不拥挤。

---

## Followups(本期不做,显式记录)

1. **Manager sync 回填 name/description**:从 upstream `custom-node-list.json` 提取,更新 `sync_manager_catalog` task + 迁移现有 pending 行的 NULL。
2. **GitHub OAuth 自动取仓库元数据**:用户在 `/submit` 表单粘 URL 后,server-side 拉 GitHub API 获取 description、stars、license 等。
3. **邮件通知**:用户提交被批/拒后收信(Plan 5 已有邮件基础设施雏形)。
4. **favicon 重新设计**:基于同一 Logo SVG,生成多尺寸 + apple-touch-icon。
5. **暗色模式持久化跨标签**:监听 `storage` 事件,tab 切换同步。
6. **Tailwind 暗色变体约定**:本 spec 把 `.dark` 挂在 `<html>`,Tailwind 暗色变体默认是 `dark:`。考虑是否切到 `darkMode: 'class'`(Tailwind 3.x 已默认支持)。
7. **CI 视觉回归测试**(Playwright screenshots):本期手动,后续 plan 加 Playwright。
8. **`/admin` 的 sidebar 在移动端折叠**:本 spec 不覆盖响应式 sidebar。

---

## Self-Review Checklist

- [x] Placeholder 扫描:无 TBD / TODO / 占位
- [x] 内部一致性:Schema、API、UI 三处描述一致;token 值在 globals.css、tailwind.config、组件三处一致
- [x] 范围:视觉刷新 + 提交节点功能,二者均各自可独立 ship
- [x] 二义性:每个组件 variant 有明确 spec;每个 API 状态码有明确含义;表单字段有 maxLength
- [x] 测试覆盖:视觉(手动)+ 功能(vitest + 集成)
- [x] Risks 已列出,包括 schema migration 兼容性、暗色对比度、跨标签同步
- [x] Followups 显式记录(8 项)