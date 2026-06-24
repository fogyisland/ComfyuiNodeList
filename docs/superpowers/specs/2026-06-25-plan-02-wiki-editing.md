# Plan 2: Wiki 编辑流程与管理员审核 — 设计规格

**Date:** 2026-06-25
**Status:** Draft
**Parent spec:** [`2026-06-21-comfyui-node-wiki-design.md`](2026-06-21-comfyui-node-wiki-design.md)

## 1. 目标与背景

Plan 1 已交付只读公开站点(节点列表、详情、版本详情、API)。本计划实现 Wiki 编辑流程:

1. 任何已登录用户可对任意 version 创建 wiki 修订(pending),提交 Python 范围、依赖表、节点类映射、互斥列表、Markdown 备注
2. 管理员可审核 pending 修订(approve / reject),批准后该修订成为 published 视图来源
3. 任何已登录用户可提交新节点收录请求(submission)
4. 管理员可审核 submissions(approve / reject)
5. 管理员可调整用户角色(admin ↔ user)
6. 提供修订间的字段级 diff 视图
7. 编辑页提供 `<ConflictPreview>` 占位组件,Plan 3 替换为真实冲突检测

## 2. 范围

**In scope:**
- 6 个 Wiki API 端点(§5.1):5 个主端点 + 1 个 `POST /revisions/{id}/withdraw`(作者撤回自己的 pending)
- 8 个 Admin API 端点(§5.3):修订审核 3 个 + submissions 审核 3 个 + 用户角色 2 个
- 1 个 conflict-check API 占位接口(§5.2,Plan 3 替换)
- 3 个 Wiki 编辑页面(§7.1)
- 4 个 Admin 页面(§7.2)
- 6 个关键组件(§8)
- Wiki revision 提交/撤回/批准事务逻辑
- 字段级 diff 算法
- zod 输入验证(全部 POST/PATCH endpoint)

**Out of scope(留后续计划):**
- 冲突检测引擎完整算法(Plan 3)
- Python Celery 扫描器(Plan 4)
- 生产部署(Plan 5)
- 自动提交(由 submissions API + 审核页面人工处理,无定时任务)
- 邮件通知(管理员批准后不通知作者)
- 修订编辑/重提(已 approved 修订不可改;pending 修订只能整体撤回后重提)

## 3. 角色与权限

| 角色 | 能做什么 |
|---|---|
| 匿名 | 浏览 Plan 1 公开内容;不能访问任何 wiki/admin API 或页面 |
| 已登录用户 (role=user) | 创建 wiki revision(pending)、撤回自己的 pending、提交 node submission |
| 已登录管理员 (role=admin) | 所有上述 + 审核修订/审核 submissions/调整用户角色 |

权限边界:
- Wiki API(`/api/v1/wiki/*`):登录即可,但 `POST revisions` 自动绑定当前用户为 author_id;`POST /revisions/{id}/withdraw` 仅作者本人或 admin
- Admin API(`/api/v1/admin/*`):必须 role=admin,否则 403
- Wiki 页(`/wiki/*`):登录即可,渲染"提交"按钮需登录;页面在 GET 期间调用 `getCurrentUser()` 决定是否显示
- Admin 页(`/admin/*`):必须 role=admin,未登录 → 重定向 `/login`,非 admin → 渲染 403

## 4. 数据模型增量

Plan 1 已定义全部所需表(`users` / `nodes` / `node_versions` / `node_raw_requirements` / `wiki_revisions` / `node_submissions`)。Plan 2 不引入新表,只新增 `wiki_revisions.status` 的取值 `archived` 和 `withdrawn`:

```
wiki_revisions.status: enum ['pending', 'approved', 'rejected', 'archived', 'withdrawn']
  - pending: 刚创建,待审核
  - approved: 当前 published 来源(同 version_id 同时只能 1 条)
  - rejected: 审核驳回,终态
  - archived: 曾 approved 但被新 approved 取代,保留历史
  - withdrawn: 作者撤回,终态
```

`node_submissions.status`:Plan 1 schema 已定义 `pending | approved | rejected`,本计划不加新值。

## 5. API 设计

### 5.1 Wiki API(需登录)

```
GET  /api/v1/wiki/{version_id}
  → 200 { versionId, published: PublishedRequirements, latestPending?: RevisionSummary }
  → 401 未登录
  用途:编辑页加载初始 published 视图与"当前作者最新 pending"

GET  /api/v1/wiki/{version_id}/history?page=1&page_size=20
  → 200 { items: RevisionSummary[], total, page, pageSize }
  RevisionSummary: { id, author: { username, avatarUrl }, editSummary, status, createdAt, reviewedAt? }
  用途:历史列表页

GET  /api/v1/wiki/revisions/{revision_id}
  → 200 { id, versionId, status, author, reviewer?, fields: RevisionFields, editSummary, reviewNote?, createdAt, reviewedAt? }
  → 404 不存在
  用途:详情/对比

POST /api/v1/wiki/{version_id}/revisions
  Body (zod validated): {
    python_min?: string | null,
    python_max?: string | null,
    dependencies: PublishedDependency[],         // 不能空数组(必须至少 0 项但语义上鼓励填)
    node_class_mappings: string[],
    incompatibilities: string[],
    notes_md: string,                            // 可空字符串但不超过 64KB
    edit_summary: string                         // 1-200 字符
  }
  → 201 { revisionId, status: "pending" }
  → 400 zod 校验失败
  → 401 未登录
  → 404 version 不存在

POST /api/v1/wiki/revisions/{revision_id}/withdraw
  → 204
  → 401 未登录
  → 403 不是作者本人且非 admin
  → 404 revision 不存在
  → 409 revision 不在 pending 状态

GET  /api/v1/wiki/diff?from={revision_id}&to={revision_id}
  → 200 {
       from: { id, status, fields, author, createdAt },
       to:   { id, status, fields, author, createdAt },
       diff: FieldDiff[]
     }
  FieldDiff: {
     field: 'python_min' | 'python_max' | 'dependencies' | 'node_class_mappings'
          | 'incompatibilities' | 'notes_md',
     kind: 'changed' | 'added-only' | 'removed-only',
     before?: unknown,
     after?: unknown,
     // dependencies 数组的特殊处理:按 name 做 key,row-level added/removed/changed
     dependencyRows?: Array<
       | { kind: 'added', row: PublishedDependency }
       | { kind: 'removed', row: PublishedDependency }
       | { kind: 'changed', before: PublishedDependency, after: PublishedDependency }
     >
  }
  → 401 未登录
  → 404 任一 revision 不存在
```

### 5.2 Conflict-check stub

```
POST /api/v1/conflicts/check
  Body: { installed: Array<{ owner: string, repo: string, version_tag: string }> }
  → 200 { conflicts: [] }            // Plan 2 stub:始终返回空数组
  → 401 未登录
  Plan 3 替换为真实算法(见 §6)
```

### 5.3 Admin API(需 role=admin)

```
GET   /api/v1/admin/revisions/pending?page=1&page_size=20
  → 200 { items: RevisionSummary[], total, page, pageSize }
  → 401/403 未登录/非 admin

POST  /api/v1/admin/revisions/{id}/approve
  Body: { review_note?: string }
  → 200 { approvedRevisionId, archivedRevisionIds: number[] }
  → 401/403
  → 404 revision 不存在
  → 409 revision 不在 pending 状态
  事务逻辑:
    1) SELECT 当前 version_id 下的 approved revision
    2) UPDATE 原 approved.status = 'archived'
    3) UPDATE 目标 status='approved', reviewer_id=current_user, reviewed_at=NOW, review_note

POST  /api/v1/admin/revisions/{id}/reject
  Body: { review_note: string }      // 必填,1-1000 字符
  → 204
  → 400 review_note 缺失或超长
  → 401/403
  → 404 / 409 同上

GET   /api/v1/admin/submissions/pending
  → 200 { items: SubmissionSummary[] }
  SubmissionSummary: { id, submitter: { username, avatarUrl }, githubUrl, createdAt }

POST  /api/v1/admin/submissions/{id}/approve
  Body: { review_note?: string }
  → 200 { submissionId, nodeId }                  // 创建对应 Node(status='active')并返回
  → 401/403/404/409
  事务逻辑:
    1) UPDATE submission.status='approved', reviewer_id, reviewed_at
    2) INSERT INTO nodes (github_owner, github_repo, status='active',
                          name=repo, author='', description='')
       基于 github_url 解析 owner/repo
       (name/author/description 用 placeholder;Plan 4 扫描器完善这些字段)
    3) 返回 nodeId

POST  /api/v1/admin/submissions/{id}/reject
  Body: { review_note: string }                    // 必填
  → 204
  → 401/403/404/409

GET   /api/v1/admin/users
  → 200 { items: Array<{ id, username, avatarUrl, role, createdAt }> }
  → 401/403

POST  /api/v1/admin/users/{id}/role
  Body: { role: 'admin' | 'user' }
  → 200 { userId, role }
  → 400 role 不合法
  → 401/403/404
  保护:不能将自己从 admin 降级(返回 409)
```

## 6. 冲突检测引擎(Plan 2 stub)

`web/lib/conflict-engine.ts` 文件创建但 Plan 2 仅导出空函数:

```ts
export type ConflictCheckRequest = { installed: Array<{ owner: string; repo: string; version_tag: string }> };
export type Conflict = { type: string; severity: 'error' | 'warning'; nodes: string[]; detail: string };
export async function checkConflicts(req: ConflictCheckRequest): Promise<Conflict[]> {
  // Plan 2 stub — always returns empty array
  return [];
}
```

Plan 3 替换为完整 PEP 440 算法。

## 7. 前端页面

### 7.1 Wiki 页(§8.2,需登录)

| 路由 | 用途 | 主要组件 |
|---|---|---|
| `/wiki/[versionId]` | 编辑页:加载 published → 编辑表单 → 实时 ConflictPreview | `<PythonVersionRange>` `<NodeRequirementTable>` `<IncompatibilityEditor>` `<MarkdownEditor>` `<ConflictPreview>` |
| `/wiki/[versionId]/history` | 历史列表 + 选中两个修订对比 diff | `<DiffViewer>` |
| `/wiki/[versionId]/submit` | 提交确认:展示 edit_summary + "提交" / "返回编辑" | (无复杂组件) |

### 7.2 Admin 页(§8.3,需 admin)

| 路由 | 用途 |
|---|---|
| `/admin` | Dashboard:待审核数(修订 + submissions)、最近 10 条活动 |
| `/admin/revisions` | 待审核修订列表:每行 `[节点|版本|作者|edit_summary|提交时间|批准|驳回]` + 一键 modal 输入 review_note |
| `/admin/submissions` | 待审核节点收录列表,每行 `[submitter|github_url|approve|reject]` |
| `/admin/users` | 用户角色表,每行 `[username|role 下拉|最后登录]` |

## 8. 关键组件(§8.4)

### 8.1 `<NodeRequirementTable>`
- Props: `{ value: PublishedDependency[], onChange: (v) => void }`
- 表格列:包名 / 规范 / 最低 / 最高 / 移除按钮
- "添加行"按钮:append `{ name: '', spec: '', min_version: null, max_version: null, is_pinned: false }`
- 行内编辑,无 dialog

### 8.2 `<PythonVersionRange>`
- Props: `{ min: string | null, max: string | null, onChange: (min, max) => void }`
- 两个 input:min(允许空 = 无下限)、max(允许空 = 无上限)
- 占位符:`3.10` / `（无上限）`

### 8.3 `<IncompatibilityEditor>`
- Props: `{ value: string[], onChange: (v) => void }`
- 简单 chips + "添加"输入框(纯字符串,格式 `{owner}/{repo}`)

### 8.4 `<MarkdownEditor>`
- Tiptap 富文本编辑器(StarterKit + Link + CodeBlock)
- Props: `{ value: string, onChange: (v: string) => void, maxLength?: number }`
- 输出 markdown(经 Tiptap 自带 serializer)
- 工具栏:粗体 / 斜体 / 链接 / 代码块 / 列表 / 标题

### 8.5 `<DiffViewer>`
- Props: `{ diff: FieldDiff[] }`
- 字段级别对比,每字段一个折叠面板:
  - `python_min` / `python_max`:展示 before → after
  - `dependencies`:依赖 `dependencyRows` 数组,分三段列表(added/removed/changed),changed 行内字段级 diff
  - `node_class_mappings` / `incompatibilities`:added/removed 字符串列表
  - `notes_md`:渲染 before/after 为 markdown(用 markdown-it)
- 无依赖 react-diff-viewer

### 8.6 `<ConflictPreview>`
- Props: `{ versionId: string }`
- 内部:监听表单当前状态 → debounce 500ms → POST /api/v1/conflicts/check → 渲染结果列表
- Plan 2 stub 行为:始终显示"暂未启用冲突检测(Plan 3 即将上线)"

## 9. 数据流

### 9.1 提交修订流程(用户视角)

```
1) GET /wiki/[versionId]
   server component:
     const user = await requireUser()                              // 未登录 → 重定向 /login
     const pub = await getPublishedRequirements(Number(versionId))
     const latestPending = await prisma.wikiRevision.findFirst({
       where: { version_id: versionId, author_id: user.id, status: 'pending' }
     })
   渲染 <WikiEditForm initialPublished={pub} initialPending={latestPending} />

2) <WikiEditForm>(client component, RHF)
   - 默认值 = pub 字段(用户基于最新 published 编辑)
   - 用户编辑 → 本地 RHF state 变更 → <ConflictPreview> 自动调用 check API
   - 提交:点击"下一步" → server action 'prepare-submit' → 把表单数据存到 cookie 或 query → 重定向 /wiki/[versionId]/submit
   - 也可直接点击"撤回"按钮(若已有 pending):server action 'withdraw-revision' → POST /api/v1/wiki/revisions/[id]/withdraw

3) GET /wiki/[versionId]/submit
   server component:
     const draft = await readDraftFromCookie()                     // 上一步存的草稿
     if (!draft) redirect(`/wiki/${versionId}`)
   渲染 <SubmitConfirmPage draft={draft} />
   用户点"确认提交":server action 'create-revision' → POST /api/v1/wiki/[versionId]/revisions
   成功后 redirect `/wiki/[versionId]/history`

4) 管理员审批流程另见 §9.2
```

### 9.2 管理员审批流程

```
1) GET /admin/revisions
   server component:
     await requireAdmin()                                          // 非 admin → 403 页面
     const pending = await fetch('/api/v1/admin/revisions/pending?page=1')
   渲染 <RevisionsReviewList items={pending.items} />

2) 管理员点"批准":modal 输入 review_note → server action 'approve-revision' → POST /api/v1/admin/revisions/[id]/approve
   成功后刷新列表

3) 管理员点"驳回":modal 输入 review_note(必填)→ server action 'reject-revision' → POST /api/v1/admin/revisions/[id]/reject
```

### 9.3 字段级 diff 算法

```ts
// web/lib/diff.ts
export function diffRevisions(
  from: RevisionFields,
  to: RevisionFields,
): FieldDiff[] {
  const fields: Array<keyof RevisionFields> = [
    'python_min', 'python_max', 'dependencies',
    'node_class_mappings', 'incompatibilities', 'notes_md',
  ];
  return fields
    .map((field) => diffField(field, from[field], to[field]))
    .filter((d): d is FieldDiff => d !== null);
}

function diffField(field, before, after): FieldDiff | null {
  if (field === 'dependencies') {
    // 按 name 做 key,row-level diff
    const beforeByName = keyBy(before, d => d.name);
    const afterByName = keyBy(after, d => d.name);
    const rows: DependencyDiffRow[] = [];
    for (const name of new Set([...Object.keys(beforeByName), ...Object.keys(afterByName)])) {
      const b = beforeByName[name], a = afterByName[name];
      if (!b) rows.push({ kind: 'added', row: a });
      else if (!a) rows.push({ kind: 'removed', row: b });
      else if (!deepEqual(b, a)) rows.push({ kind: 'changed', before: b, after: a });
    }
    if (rows.length === 0) return null;
    return { field, kind: 'changed', dependencyRows: rows };
  }
  // 标量字段(数组 / 字符串 / null)
  if (deepEqual(before, after)) return null;
  return { field, kind: 'changed', before, after };
}
```

## 10. 错误处理

| 场景 | HTTP | UI 行为 |
|---|---|---|
| 未登录访问 wiki/admin 端点 | 401 | server action:重定向 `/login?callbackUrl=...` |
| 非 admin 访问 admin 端点 | 403 | 渲染 admin 403 页面 |
| zod 校验失败 | 400 | 表单红色边框 + zod issue 路径文案 |
| revision 不存在 | 404 | 404 页面 |
| revision 状态不允许操作(approve pending 之外 / withdraw 非 pending) | 409 | 通用错误 toast "操作不允许,当前状态: {status}" |
| 乐观更新冲突(同一 revision 已被并发批准) | 409 | 列表自动刷新,toast 提示"已被其他人处理" |
| Tiptap 输出 markdown 超 64KB | 400 | 编辑器下方提示"内容超长" |

## 11. 测试策略

- **单元测试**(Vitest):
  - `web/lib/diff.ts` 完整覆盖(添加/删除/修改/空数组/复杂组合)
  - `web/lib/wiki.ts` 提交/撤回/批准事务(用真实 DB)
  - zod schemas 输入校验
- **集成测试**(Vitest,真实 Prisma):
  - 5 个 Wiki API 端点(GET/POST/withdraw/diff)
  - 5 个 Admin API 端点(approve/reject/submissions/users/role)
  - 批准事务的回滚测试(故意失败,确认 archived 状态正确)
- **E2E 不引入**(保持 Plan 1 风格:用 curl + dev server 烟测)
- **覆盖率目标**:核心 helper 100%,API 100%,UI 组件以集成 + 烟测为主(单测不强制)

## 12. 关键技术决策汇总

| 决策 | 选择 | 理由 |
|---|---|---|
| Markdown 编辑器 | Tiptap | spec 8.4 指定;WYSIWYG,所见即所得 |
| Diff 视图 | 自实现字段级 | 业务语义需要(字段级不是文本行级);react-diff-viewer 不适用 |
| 表单状态 | React Hook Form + useFieldArray | 动态数组(依赖、互斥)需要 useFieldArray;提交状态、错误处理开箱即用 |
| ConflictPreview 归属 | Plan 2 完整实现 + stub | spec 8.4 列出;留 API 占位,Plan 3 替换 |
| 权限边界 | 作者可撤回 pending + admin 全控 | 标准 Wiki 工作流;简单清晰 |
| 批准策略 | 同 version_id 同时只能 1 个 approved | 简单一致,旧 approved 改 archived 保留历史 |
| 输入验证 | zod | Plan 1 已有 zod 依赖;Plan 1 whole-branch review 建议补;Plan 2 落地 |
| 表单提交方式 | Next.js 15 server actions | RHF 表单提交 → server action → API 调用,内部表单 + 外部 API 共存 |
| 客户端渲染范围 | 仅 Wiki 编辑页与 ConflictPreview 需 'use client';其他页面继续 server component | Tiptap/RHF 必须 client;admin 页面交互简单,server 即可 |

## 13. 验收标准

### 13.1 功能验收
- [ ] 已登录用户可创建 wiki 修订,status=pending
- [ ] 已登录用户可撤回自己的 pending 修订
- [ ] 已登录用户不可撤回他人修订(返回 403)
- [ ] 管理员可批准 pending 修订,事务内将同 version_id 旧 approved 改 archived
- [ ] 管理员可驳回 pending 修订,review_note 必填
- [ ] 管理员可批准/驳回 submissions,批准后自动创建对应 nodes 行
- [ ] 管理员可调整用户角色(自己不可降级)
- [ ] 历史页可查看任意两个修订的字段级 diff
- [ ] 编辑页的 ConflictPreview 占位显示(Plan 3 替换前)
- [ ] 所有 POST/PATCH endpoint 经 zod 验证
- [ ] 匿名访问 wiki/admin 页面 → 重定向 /login
- [ ] 非 admin 访问 admin 页面 → 403 页面

### 13.2 测试验收
- [ ] 核心 helper(diff / wiki / zod schemas)单测 100%
- [ ] 12 个新 API 端点每个至少 3 个集成测试
- [ ] `pnpm test` 全绿,无回归
- [ ] `pnpm exec tsc --noEmit` 0 错
- [ ] `pnpm lint` 0 警告

### 13.3 性能验收
- [ ] `/wiki/[versionId]` 编辑页 TTFB < 500ms(只加载 published,不渲染全 diff)
- [ ] `/wiki/[versionId]/history` 列表页支持分页 20
- [ ] `/api/v1/wiki/diff` 响应 < 100ms(纯计算,无 IO)

### 13.4 安全验收
- [ ] 所有 admin API 检查 `requireAdmin()`
- [ ] 所有 wiki POST API 检查 `requireUser()`
- [ ] 提交修订时 zod 拒绝超大 payload(>1MB)
- [ ] author_id 强制绑定 session.user,禁止客户端覆盖

## 14. 任务分解(25 任务)

### 批次 1:基础设施(5 任务)
1. **Revision status 扩展** — `wiki_revisions.status` 加 `archived` 和 `withdrawn`(enum 扩展,prisma migrate)
2. **zod schemas** — `web/lib/wiki-schema.ts`(PublishedDependency、RevisionFields、SubmitBody、ApproveBody、RejectBody、RoleChangeBody)
3. **wiki lib helpers** — `web/lib/wiki.ts`(createRevision, withdrawRevision, approveRevision, rejectRevision 事务封装)
4. **字段级 diff** — `web/lib/diff.ts` + 单测
5. **conflict-engine stub** — `web/lib/conflict-engine.ts` 空实现

### 批次 2:Wiki API(5 任务,6 端点)
6. `GET /api/v1/wiki/{versionId}`
7. `GET /api/v1/wiki/{versionId}/history`
8. `GET /api/v1/wiki/revisions/{id}`
9. `POST /api/v1/wiki/{versionId}/revisions`(zod 验证)
10. `GET /api/v1/wiki/diff?from=&to=` + `POST /api/v1/wiki/revisions/{id}/withdraw`

### 批次 3:Admin API(4 任务,9 端点 = 1 stub + 8 admin)
11. `POST /api/v1/conflicts/check`(stub)
12. `GET /api/v1/admin/revisions/pending` + `POST /api/v1/admin/revisions/{id}/approve`(含事务)+ `POST /api/v1/admin/revisions/{id}/reject`
13. `GET /api/v1/admin/submissions/pending` + `POST /api/v1/admin/submissions/{id}/approve`(含创建 Node)+ `POST /api/v1/admin/submissions/{id}/reject`
14. `GET /api/v1/admin/users` + `POST /api/v1/admin/users/{id}/role`(含自降级保护)

### 批次 4:用户 Wiki UI(5 任务)
15. 共享组件 1:`<PythonVersionRange>` `<IncompatibilityEditor>`
16. 共享组件 2:`<NodeRequirementTable>`(RHF useFieldArray)
17. 共享组件 3:`<MarkdownEditor>`(Tiptap)
18. 共享组件 4:`<DiffViewer>`(自实现字段级)+ `<ConflictPreview>`(stub)
19. Wiki 页面:`/wiki/[versionId]`(编辑页)、`/wiki/[versionId]/submit`、`/wiki/[versionId]/history`

### 批次 5:Admin UI(4 任务)
20. Admin layout + `/admin` Dashboard
21. `/admin/revisions` 审核页
22. `/admin/submissions` 审核页
23. `/admin/users` 角色管理页

### 批次 6:验收(2 任务)
24. 完整集成测试 + 端到端烟测(curl 15 个新端点 + 浏览器走完编辑-审批流程)
25. README 更新(新增 Wiki / Admin 章节 + 测试说明 + 已知限制)

## 15. 不在范围,但需文档化(留后续)

- 冲突检测算法实现(Plan 3:`web/lib/conflict-engine.ts` 替换 stub)
- 自动化扫描 + 收录建议(Plan 4)
- 富文本编辑器扩展(图片上传、表格等 — 当前 Tiptap StarterKit 不含,后续按需加扩展)
- 邮件通知
- 修订编辑/重提
- 修订撤回后的版本号 / 编辑历史多分支

## 16. 风险与缓解

| 风险 | 缓解 |
|---|---|
| Tiptap 输出 markdown 与后端 markdown-it 渲染不一致 | 单元测试覆盖:Tiptap 输出 → markdown-it 渲染 = 原始输入(round-trip) |
| 并发批准同一 pending revision | 事务 + `where: { status: 'pending' }` 条件 update,affected_rows=0 返回 409 |
| 用户角色变更后 JWT 缓存导致 admin 权限延迟 | 已在 Plan 1 whole-branch review 中标为 Important #3;Plan 2 顺手在 `jwt` 回调中加 role 字段以确保新鲜度 |
| `wiki_revisions` JSON 字段格式漂移 | zod schema 强制验证 + 测试 |
| Admin 误将自己降级导致无 admin | 自降级保护 + bootstrap admin 通过 env 保留至少一个 admin |