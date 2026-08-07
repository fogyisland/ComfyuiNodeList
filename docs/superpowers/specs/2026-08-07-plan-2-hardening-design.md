# Plan 2 后端 hardening — TOCTOU + page-level gate

> 范围：关闭 Plan 2 spec 遗留的 2 个 Important finding。本 spec 不引入新功能。

**Context 来源**：
- `docs/superpowers/specs/2026-06-25-plan-02-wiki-editing.md` §9 / §10 / §13.4
- 实际代码：`web/lib/wiki.ts`、`web/app/wiki/[versionId]/submit/page.tsx`

**Github baseline**：`origin/main` = `aace0be`，工作从 main 直接推进（沿用本仓库习惯）。

---

## 1. 背景与问题

Plan 2 spec 包含 2 个被明确标注为 deferred 的 Important finding，至今未关闭：

### Finding A — TOCTOU in reject/withdraw

**位置**：`web/lib/wiki.ts`
- `withdrawRevision` (现 44-58 行)
- `rejectRevision` (现 120-138 行)

**模式**：两步非原子操作 ——
1. `findUnique` 读 revision
2. 判定 `status === pending`
3. `update` 写新 status

**Race window**：步骤 2 与 3 之间。如果两个 actor（admin reject + author withdraw）并发执行，都可能通过步骤 2 的 pending 判定、都执行步骤 3 的 update，最坏情况下 row 状态被错误翻转（rejected 后的 row 被下一步 withdraw 改成 withdrawn，丢失 reject 语义）。

**对比**：`approveRevision` (现 79-110 行) 已用 `prisma.$transaction` 包裹状态判定与 archive/finalize 操作，是安全的。

**Spec 自身已承认**：`2026-06-25-plan-02-wiki-editing.md` 第 10 节"错误处理"表列出

> 乐观更新冲突（同一 revision 已被并发批准） | 409 | 列表自动刷新，toast 提示"已被其他人处理"

但代码未实现此 race protection。

### Finding B — submit page 缺少 page-level gate

**位置**：`web/app/wiki/[versionId]/submit/page.tsx` 全文

**当前状态**：页面渲染确认表单，但没有 `requireUser()` 调用。对比同目录：
- `/wiki/[versionId]/page.tsx`（13-17 行）：有 `try { await requireUser() } catch { redirect }`
- `/wiki/[versionId]/history/page.tsx`（10-14 行）：同样有

**后果**：未登录用户访问 `/wiki/<id>/submit?d=...` 仍能看到确认页（虽然 `confirmSubmit` server action 内部有 auth 校验，page-level 缺失违反最小暴露原则）。

---

## 2. 目标

1. `withdrawRevision` 与 `rejectRevision` 在并发场景下行为正确：两个 actor 只有一个能成功，另一个拿到 `not-pending` + 最新状态。
2. `/wiki/[versionId]/submit` 未登录访问 → 307 redirect 到 `/login?callbackUrl=...`。
3. 既有 API 路由签名、HTTP 状态码、响应 body schema 全部保持不变。
4. 既有测试全部通过；新增 6 个并发测试覆盖典型 race 场景。

## 3. 非目标

- 不动 `approveRevision`（已正确）
- 不引入 schema migration（不加乐观锁 column）
- 不重构 `wiki.ts` 整体结构
- 不修改其他 wiki page（edit / history 已 gate）
- 不清理 Plan 2 之外的 followup（如 BOOLEAN↔TINYINT(1)、FK drift、Manager sync followups）

---

## 4. 设计

### 4.1 TOCTOU 修复 — `updateMany` 原子条件更新

**核心**：用 `prisma.wikiRevision.updateMany({ where: { id, status: pending }, data: ... })` 替换 `findUnique` + 判定 + `update` 三步。MySQL 单语句 `UPDATE ... WHERE id = ? AND status = 'pending'` 是原子的：count=1 表示成功，count=0 表示状态已被其他 actor 翻转。

**`withdrawRevision` 改后骨架**：

```ts
export async function withdrawRevision(input: WithdrawRevisionInput): Promise<WithdrawResult> {
  const row = await prisma.wikiRevision.findUnique({ where: { id: BigInt(input.revisionId) } });
  if (!row) return { ok: false, reason: 'not-found' };
  if (row.author_id !== input.currentUserId && !input.isAdmin) {
    return { ok: false, reason: 'forbidden' };
  }
  const updated = await prisma.wikiRevision.updateMany({
    where: { id: row.id, status: RevisionStatus.pending },
    data: { status: RevisionStatus.withdrawn },
  });
  if (updated.count === 0) {
    const fresh = await prisma.wikiRevision.findUnique({ where: { id: row.id } });
    return { ok: false, reason: 'not-pending', status: fresh?.status };
  }
  return { ok: true };
}
```

**`rejectRevision` 改后骨架**（对称）：

```ts
export async function rejectRevision(
  input: ReviewActionInput & { reviewNote: string },
): Promise<RejectResult> {
  const target = await prisma.wikiRevision.findUnique({ where: { id: BigInt(input.revisionId) } });
  if (!target) return { ok: false, reason: 'not-found' };
  const updated = await prisma.wikiRevision.updateMany({
    where: { id: target.id, status: RevisionStatus.pending },
    data: {
      status: RevisionStatus.rejected,
      reviewer_id: input.reviewerId,
      review_note: input.reviewNote,
      reviewed_at: new Date(),
    },
  });
  if (updated.count === 0) {
    const fresh = await prisma.wikiRevision.findUnique({ where: { id: target.id } });
    return { ok: false, reason: 'not-pending', status: fresh?.status };
  }
  return { ok: true };
}
```

**为什么不选 `$transaction` 包**：MySQL 默认隔离级别 REPEATABLE READ 下，`$transaction` 内的非锁定 SELECT 仍可能读到旧版本；要做真正的条件 write 仍需 `SELECT ... FOR UPDATE` 或 where-clause 条件 update。`updateMany` 自带 SQL 原子性，代码更短。

**为什么不需要 `updateMany` 返回 updated row**：`withdrawRevision` / `rejectRevision` 调用方都不依赖返回行数据，只看 `ok` 与 `count=0/1` 即可。

### 4.2 page-level gate — `/wiki/[versionId]/submit/page.tsx`

**改动**：在 `export default async function SubmitConfirmPage({ params, searchParams }: Props)` 顶部插入 4 行 auth guard，与 history page 模板一致：

```ts
let user;
try {
  user = await requireUser();
} catch {
  redirect(`/login?callbackUrl=/wiki/${versionId}/submit`);
}
```

`user` 在本页面仅用于触发 redirect 副作用（变量实际未使用，可加 `// eslint-disable-next-line @typescript-eslint/no-unused-vars` 注释或仅 `await requireUser()`）。生产代码采用后者更简洁：

```ts
try {
  await requireUser();
} catch {
  redirect(`/login?callbackUrl=/wiki/${versionId}/submit`);
}
```

`searchParams.d` 的解析与 JSON 校验保持现有顺序（先解码失败 redirect，无 edit_summary 也 redirect）。

### 4.3 接口 / 错误映射

**`WithdrawalResult` / `RejectResult` 类型不变**：

```ts
type WithdrawResult =
  | { ok: true }
  | { ok: false; reason: 'not-found' | 'forbidden' | 'not-pending'; status?: RevisionStatus };

type RejectResult =
  | { ok: true }
  | { ok: false; reason: 'not-found' | 'not-pending'; status?: RevisionStatus };
```

**API 路由不变**：
- `POST /api/v1/wiki/revisions/{id}/withdraw` （`web/app/api/v1/wiki/revisions/[id]/withdraw/route.ts`）
  - 204 / 404 / 403 / 409 状态码与响应 body 全部保持
- `POST /api/v1/admin/revisions/{id}/reject` （`web/app/api/v1/admin/revisions/[id]/reject/route.ts`）
  - 204 / 404 / 409 状态码与 body 全部保持

**`/wiki/[versionId]/submit` 路由签名不变**；未登录访问时改为 307 redirect 到 `/login?callbackUrl=/wiki/{versionId}/submit`（与 history page redirect 行为对齐）。

---

## 5. 测试

### 5.1 新增 `web/tests/lib/wiki-concurrent.test.ts`

6 个 vitest case，全部使用真实 `comfyui_nodes_test` DB（`web/tests/setup.ts` 自动 reset），无 mock：

| # | 场景 | 期望 |
|---|---|---|
| 1 | 2 个 admin 并发 reject 同一条 pending revision | 1 个返回 `{ ok: true }`，1 个返回 `{ ok: false, reason: 'not-pending', status: 'rejected' }`；DB 中 `status='rejected'`，`reviewer_id` 是成功那个 |
| 2 | 1 admin reject + 1 author withdraw 并发 | 1 成功，1 not-pending；DB 状态由赢家决定（`rejected` 或 `withdrawn`） |
| 3 | 1 admin reject + 1 admin approve 并发 | 1 成功，1 not-pending；DB 状态由赢家决定 |
| 4 | 已 withdrawn 的 revision 再 withdraw（顺序） | 第 2 次返回 `not-pending`，`status: 'withdrawn'` |
| 5 | reject 已 archived 的 revision | 返回 `not-pending`，`status: 'archived'` |
| 6 | 未登录访问 `/wiki/<id>/submit` | 307 redirect 到 `/login?callbackUrl=/wiki/<id>/submit` |

**Case 1-3 实现细节**：
- 用 `Promise.all` 触发两个并发操作
- 全局 prisma client 单例（`web/tests/setup.ts` 已配置 `fileParallelism: false` 避免跨文件 race）
- 断言既检查单个返回结构，也最后 `findUnique` 验证 DB 终态

**Case 6 实现细节**：
- 走 `webRequest` helper（既有用过的）
- 验证返回 Response 的 `status === 307` 且 `headers.location` 包含 `/login?callbackUrl=...`

### 5.2 既有测试

- `web/tests/lib/wiki.test.ts` 中非并发场景全部继续通过
- `approveRevision` 既有事务测试不动
- `web/tests/api/admin-revisions.test.ts`、`web/tests/api/wiki-revisions.test.ts` 不动

### 5.3 验证命令

```bash
cd web
pnpm exec tsc --noEmit          # 0 error
pnpm test                       # 应显示 233/233 (227 既有 + 6 新增)
pnpm lint                       # 0 warning
```

---

## 6. 文件清单

**Create:**
- `web/tests/lib/wiki-concurrent.test.ts` — 6 个 vitest case

**Modify:**
- `web/lib/wiki.ts` — `withdrawRevision`、`rejectRevision` 内部重写（接口签名不变）
- `web/app/wiki/[versionId]/submit/page.tsx` — 顶部加 5 行 page-level guard
- `docs/superpowers/specs/2026-06-25-plan-02-wiki-editing.md` — §9、§10、§13.4 末尾追加"已实现"标记 + 指向本 spec

**No changes:**
- `web/lib/wiki-schema.ts`（zod 不动）
- `web/app/api/v1/wiki/revisions/[id]/withdraw/route.ts`（路由层不动）
- `web/app/api/v1/admin/revisions/[id]/reject/route.ts`（路由层不动）
- `web/app/wiki/[versionId]/page.tsx`（已 gate）
- `web/app/wiki/[versionId]/history/page.tsx`（已 gate）
- `web/prisma/schema.prisma`（无 migration）

---

## 7. 风险与缓解

| 风险 | 缓解 |
|---|---|
| `updateMany` 不返回 updated row，影响调用方 | 调用方仅依赖 `count=0/1`，已分析无影响 |
| 并发测试 DB 隔离 | 复用 `web/tests/setup.ts` 的 `prisma db push --force-reset` + `fileParallelism: false` |
| `withdrawRevision` 改动后 `/wiki/[versionId]/page.tsx` 的 `latest` 查询行为 | `latest` 查询条件是 `status: pending`，withdraw 后该 row 不再被读到，符合预期 |
| page-level gate 新增后与 server action 已有 auth 重复 | 无影响，server action 内部 `requireUser()` 仍执行，作为第二道防线 |
| Spec 文档 marker 改动 | 仅在 §9/§10/§13.4 末尾追加 1 行"已实现 (commit X)"，无结构性改动 |

---

## 8. 验收标准

- [ ] 2 个目标 finding 修复完成（功能 + page gate）
- [ ] `pnpm test` 显示 233/233 通过
- [ ] `pnpm exec tsc --noEmit` 0 错
- [ ] `pnpm lint` 0 警告
- [ ] 既有 API 路由签名、HTTP 状态码、响应 body 不变（无客户端破坏）
- [ ] `web/lib/wiki.ts` 既有 approve 事务测试不动
- [ ] Spec 文档 marker 准确反映本计划 commit hash
- [ ] 1 个 commit 包含所有代码改动，1 个 commit 写 spec 文档 marker

---

## 9. Self-Review

- [x] Placeholder 扫描：无 TBD / TODO
- [x] 内部一致性：API 签名、HTTP 状态码、测试用例与设计一致
- [x] 范围：仅修 2 个 Important finding + 文档 marker，无 scope creep
- [x] 二义性：每个接口类型、每个测试期望都有明确数值
- [x] 测试覆盖：6 个并发 case + 既有既有用例保留
- [x] Risks 已列出
- [x] 验收标准列出
