# Plan 1: Foundation + Public Read-Only Wiki Site

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bootstrap a working public ComfyUI node wiki: Next.js 15 monolith with Prisma/MySQL, GitHub OAuth login, seeded example data, public read-only pages and `/api/v1/...` read endpoints.

**Architecture:** Next.js 15 App Router (TypeScript strict) is the only runtime in this plan. Prisma 5 talks to MySQL 8 (via docker-compose). NextAuth.js v5 (Auth.js) provides GitHub OAuth. All public pages are React Server Components with `revalidate` caching. The "published" view of a node version is the merge of `node_raw_requirements` and the latest approved `wiki_revisions` (in Plan 1 there are no wiki revisions yet, so published == raw).

**Tech Stack:**
- Node.js 20 LTS, pnpm 9
- Next.js 15.x, React 19, TypeScript 5.x (strict)
- Prisma 5.x + MySQL 8.0
- NextAuth.js v5 (Auth.js) — GitHub OAuth provider
- Zod 3.x (API input validation)
- Tailwind CSS 3.x (styling)
- Vitest 1.x (unit + integration tests via in-process route handlers)

## Global Constraints

Verbatim from spec (`docs/superpowers/specs/2026-06-21-comfyui-node-wiki-design.md`):

- MySQL 8.0, default collation `utf8mb4_0900_ai_ci`. Database name `comfyui_nodes` in dev, `comfyui_nodes_test` in tests.
- All API responses: JSON, UTF-8, ISO-8601 timestamps.
- Public API base path: `/api/v1/...`. Never expose `scan_warnings`, `raw_files`, internal IDs, or `wiki_revisions` rows in public responses.
- Tables defined in this plan (per spec §4): `users`, `nodes`, `node_versions`, `node_raw_requirements`, `wiki_revisions`, `node_submissions`.
- `node_versions`: at most 5 most-recent releases per node (enforced by scanner in Plan 4; Plan 1 seeds ≤2 per node).
- `wiki_revisions.status='approved'` uniqueness per `version_id` — enforced by application transaction (implemented in Plan 2).
- First authenticated user whose `github_id == BOOTSTRAP_ADMIN_GITHUB_ID` (env var) is auto-promoted to `role='admin'`. All other users get `role='user'`.
- Required env vars: `DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `GITHUB_CLIENT_ID`, `GITHUB_SECRET`, `BOOTSTRAP_ADMIN_GITHUB_ID`.
- Repo root: `D:\ToolDevelop\ComfyUINodeAnalysis\`. All paths in this plan are relative to that root unless stated.

## Out of Scope for This Plan

- Wiki editing UI, revision submission, diff viewer (Plan 2).
- Admin review dashboard and submissions queue (Plan 2/3).
- Conflict detection engine + `POST /api/v1/conflicts/check` (Plan 3).
- Python Celery scanner worker (Plan 4).
- Production deployment hardening, CI, monitoring (Plan 5).

## File Structure (this plan creates)

```
.gitignore
.env.example
docker-compose.yml
README.md
web/
├── package.json
├── tsconfig.json
├── next.config.ts
├── tailwind.config.ts
├── postcss.config.mjs
├── vitest.config.ts
├── .eslintrc.json
├── prisma/
│   ├── schema.prisma
│   └── seed.ts
├── app/
│   ├── layout.tsx
│   ├── page.tsx                  # home
│   ├── globals.css
│   ├── (public)/
│   │   ├── _components/
│   │   │   ├── Header.tsx
│   │   │   ├── NodeCard.tsx
│   │   │   ├── Pagination.tsx
│   │   │   └── DependencyTable.tsx
│   │   ├── nodes/
│   │   │   ├── page.tsx          # list
│   │   │   └── [owner]/[repo]/
│   │   │       ├── page.tsx      # detail
│   │   │       └── versions/[tag]/page.tsx
│   └── api/
│       ├── auth/[...nextauth]/route.ts
│       └── v1/
│           └── nodes/
│               ├── route.ts
│               └── [owner]/[repo]/
│                   ├── route.ts
│                   └── versions/[tag]/route.ts
├── lib/
│   ├── db.ts                     # Prisma singleton
│   ├── auth.ts                   # NextAuth config
│   ├── session.ts                # getCurrentUser + role checks
│   ├── published.ts              # getPublishedRequirements(versionId)
│   ├── format.ts                 # date / dependency formatters
│   └── api-helpers.ts            # json(), error(), pagination parsing
└── tests/
    ├── setup.ts                  # vitest global setup: migrate + reset test DB
    ├── fixtures.ts               # minimal seed helpers used by tests
    ├── lib/
    │   └── published.test.ts
    └── api/
        ├── nodes-list.test.ts
        ├── node-detail.test.ts
        └── version-detail.test.ts
```

---

## Task 1: Project Scaffolding (Next.js 15 + TypeScript + Tailwind)

**Files:**
- Create: `.gitignore`
- Create: `web/package.json`
- Create: `web/tsconfig.json`
- Create: `web/next.config.ts`
- Create: `web/tailwind.config.ts`
- Create: `web/postcss.config.mjs`
- Create: `web/.eslintrc.json`
- Create: `web/app/globals.css`
- Create: `web/app/layout.tsx`
- Create: `web/app/page.tsx`

**Interfaces:**
- Produces: `cd web && pnpm dev` starts a Next.js dev server on port 3000 with a placeholder home page.

- [ ] **Step 1: Initialize `.gitignore`**

Create `.gitignore` at the repo root:

```
node_modules/
.next/
dist/
build/
coverage/
.env
.env.local
*.log
.DS_Store
web/prisma/migrations/dev.db*
.turbo/
.cache/
```

- [ ] **Step 2: Create `web/package.json`**

```json
{
  "name": "comfyui-node-wiki-web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev -p 3000",
    "build": "next build",
    "start": "next start -p 3000",
    "lint": "next lint",
    "test": "vitest run",
    "test:watch": "vitest",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev",
    "prisma:reset": "prisma migrate reset --force",
    "prisma:seed": "tsx prisma/seed.ts"
  },
  "dependencies": {
    "@auth/prisma-adapter": "^2.7.0",
    "@prisma/client": "^5.20.0",
    "next": "^15.0.0",
    "next-auth": "5.0.0-beta.22",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^20.16.10",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "autoprefixer": "^10.4.20",
    "eslint": "^9.12.0",
    "eslint-config-next": "^15.0.0",
    "postcss": "^8.4.47",
    "prisma": "^5.20.0",
    "tailwindcss": "^3.4.13",
    "tsx": "^4.19.1",
    "typescript": "^5.6.2",
    "vitest": "^1.6.0"
  },
  "prisma": {
    "seed": "tsx prisma/seed.ts"
  }
}
```

- [ ] **Step 3: Create `web/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["./*"]
    },
    "plugins": [{ "name": "next" }]
  },
  "include": [
    "next-env.d.ts",
    "**/*.ts",
    "**/*.tsx",
    ".next/types/**/*.ts"
  ],
  "exclude": ["node_modules", ".next"]
}
```

- [ ] **Step 4: Create `web/next.config.ts`**

```ts
import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: { bodySizeLimit: '1mb' },
  },
};

export default config;
```

- [ ] **Step 5: Create Tailwind + PostCSS configs**

`web/tailwind.config.ts`:

```ts
import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        accent: '#2563eb',
      },
    },
  },
  plugins: [],
};

export default config;
```

`web/postcss.config.mjs`:

```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 6: Create ESLint config**

`web/.eslintrc.json`:

```json
{
  "extends": ["next/core-web-vitals", "next/typescript"]
}
```

- [ ] **Step 7: Create `web/app/globals.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  color-scheme: light;
}

body {
  font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
}
```

- [ ] **Step 8: Create root layout**

`web/app/layout.tsx`:

```tsx
import './globals.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'ComfyUI Node Wiki',
  description: 'Community-maintained metadata for ComfyUI custom nodes.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh">
      <body className="min-h-screen bg-gray-50 text-gray-900">
        {children}
      </body>
    </html>
  );
}
```

- [ ] **Step 9: Create placeholder home page**

`web/app/page.tsx`:

```tsx
export default function HomePage() {
  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-3xl font-bold">ComfyUI Node Wiki</h1>
      <p className="mt-4 text-gray-600">Scaffolding placeholder.</p>
    </main>
  );
}
```

- [ ] **Step 10: Install dependencies and verify**

Run:
```bash
cd web && pnpm install
```
Expected: install completes, `node_modules/` populated, no errors.

Then run:
```bash
cd web && pnpm dev
```
Expected: server starts on http://localhost:3000, home page renders "ComfyUI Node Wiki / Scaffolding placeholder."

Stop the dev server (Ctrl+C) before continuing.

- [ ] **Step 11: Commit**

```bash
git add .gitignore web/
git commit -m "feat(web): scaffold Next.js 15 + TypeScript + Tailwind"
```

---

## Task 2: docker-compose for MySQL 8.0 + Redis 7

**Files:**
- Create: `docker-compose.yml`
- Create: `.env.example`

**Interfaces:**
- Produces: `docker compose up -d mysql redis` brings up MySQL 8 on port 3306 and Redis 7 on port 6379, with credentials matching `.env.example`.

- [ ] **Step 1: Create `docker-compose.yml`**

```yaml
services:
  mysql:
    image: mysql:8.0
    container_name: comfyui-wiki-mysql
    restart: unless-stopped
    environment:
      MYSQL_ROOT_PASSWORD: rootpw
      MYSQL_DATABASE: comfyui_nodes
      MYSQL_USER: comfyui
      MYSQL_PASSWORD: comfyuipw
    ports:
      - "3306:3306"
    volumes:
      - mysql_data:/var/lib/mysql
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost", "-uroot", "-prootpw"]
      interval: 5s
      timeout: 5s
      retries: 20

  redis:
    image: redis:7-alpine
    container_name: comfyui-wiki-redis
    restart: unless-stopped
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 10

volumes:
  mysql_data:
```

- [ ] **Step 2: Create `.env.example`**

```
DATABASE_URL="mysql://comfyui:comfyuipw@localhost:3306/comfyui_nodes"
NEXTAUTH_SECRET="dev-secret-replace-in-production-with-openssl-rand-base64-32"
NEXTAUTH_URL="http://localhost:3000"
GITHUB_CLIENT_ID="your-github-oauth-app-client-id"
GITHUB_SECRET="your-github-oauth-app-client-secret"
BOOTSTRAP_ADMIN_GITHUB_ID="0"
```

- [ ] **Step 3: Bring up MySQL + Redis**

Run:
```bash
cp .env.example .env
docker compose up -d mysql redis
```
Expected: both containers reach `healthy` status within 30 s. Verify:
```bash
docker compose ps
```
Both services should show `State: Up (healthy)`.

- [ ] **Step 4: Verify MySQL connectivity**

Run:
```bash
docker compose exec mysql mysqladmin ping -h localhost -uroot -prootpw
```
Expected: `mysqld is alive`.

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml .env.example
git commit -m "chore: add docker-compose for MySQL 8 + Redis 7"
```

---

## Task 3: Prisma Schema (all 6 tables)

**Files:**
- Create: `web/prisma/schema.prisma`

**Interfaces:**
- Produces: `prisma` client with the following models matching spec §4:
  - `User` (users)
  - `Node` (nodes)
  - `NodeVersion` (node_versions)
  - `NodeRawRequirement` (node_raw_requirements)
  - `WikiRevision` (wiki_revisions)
  - `NodeSubmission` (node_submissions)

- [ ] **Step 1: Create `web/prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
}

enum UserRole {
  user
  admin
}

enum NodeStatus {
  active
  deprecated
  hidden
}

enum RevisionStatus {
  pending
  approved
  rejected
}

enum SubmissionStatus {
  pending
  approved
  rejected
}

model User {
  id           BigInt   @id @default(autoincrement())
  github_id    BigInt   @unique
  username     String   @db.VarChar(64)
  email        String?  @db.VarChar(255)
  avatar_url   String   @db.VarChar(512)
  role         UserRole @default(user)
  created_at   DateTime @default(now())

  authored_revisions WikiRevision[] @relation("RevisionAuthor")
  reviewed_revisions WikiRevision[] @relation("RevisionReviewer")
  submissions        NodeSubmission[] @relation("SubmissionSubmitter")
  reviewed_submissions NodeSubmission[] @relation("SubmissionReviewer")

  @@map("users")
}

model Node {
  id            BigInt     @id @default(autoincrement())
  github_owner  String     @db.VarChar(128)
  github_repo   String     @db.VarChar(128)
  name          String     @db.VarChar(255)
  author        String     @db.VarChar(128)
  description   String?    @db.Text
  status        NodeStatus @default(active)
  created_at    DateTime   @default(now())
  updated_at    DateTime   @updatedAt

  versions NodeVersion[]

  @@unique([github_owner, github_repo])
  @@index([status, updated_at])
  @@map("nodes")
}

model NodeVersion {
  id           BigInt   @id @default(autoincrement())
  node_id      BigInt
  version_tag  String   @db.VarChar(64)
  git_sha      String   @db.Char(40)
  release_date DateTime
  scanned_at   DateTime @default(now())

  node             Node                  @relation(fields: [node_id], references: [id], onDelete: Cascade)
  raw_requirements NodeRawRequirement?
  wiki_revisions   WikiRevision[]

  @@unique([node_id, version_tag])
  @@index([node_id, release_date])
  @@map("node_versions")
}

model NodeRawRequirement {
  version_id          BigInt  @id
  python_min          String? @db.VarChar(16)
  python_max          String? @db.VarChar(16)
  dependencies        Json
  node_class_mappings Json
  incompatibilities   Json
  scan_warnings       Json
  raw_files           Json

  version NodeVersion @relation(fields: [version_id], references: [id], onDelete: Cascade)

  @@map("node_raw_requirements")
}

model WikiRevision {
  id                  BigInt         @id @default(autoincrement())
  version_id          BigInt
  author_id           BigInt
  python_min          String?        @db.VarChar(16)
  python_max          String?        @db.VarChar(16)
  dependencies        Json
  node_class_mappings Json
  incompatibilities   Json
  notes_md            String         @db.MediumText
  edit_summary        String         @db.VarChar(500)
  status              RevisionStatus @default(pending)
  reviewer_id         BigInt?
  review_note         String?        @db.Text
  reviewed_at         DateTime?
  created_at          DateTime       @default(now())

  version  NodeVersion @relation(fields: [version_id], references: [id], onDelete: Cascade)
  author   User        @relation("RevisionAuthor", fields: [author_id], references: [id])
  reviewer User?       @relation("RevisionReviewer", fields: [reviewer_id], references: [id])

  @@index([version_id, status, created_at(sort: Desc)])
  @@map("wiki_revisions")
}

model NodeSubmission {
  id            BigInt           @id @default(autoincrement())
  submitter_id  BigInt
  github_url    String           @db.VarChar(512)
  status        SubmissionStatus @default(pending)
  reviewer_id   BigInt?
  review_note   String?          @db.Text
  created_at    DateTime         @default(now())
  reviewed_at   DateTime?

  submitter User  @relation("SubmissionSubmitter", fields: [submitter_id], references: [id])
  reviewer  User? @relation("SubmissionReviewer", fields: [reviewer_id], references: [id])

  @@index([status, created_at])
  @@map("node_submissions")
}
```

- [ ] **Step 2: Generate Prisma client**

Run:
```bash
cd web && pnpm prisma:generate
```
Expected: `Generated Prisma Client (v5.x.x) to ./node_modules/@prisma/client`.

- [ ] **Step 3: Commit**

```bash
git add web/prisma/schema.prisma
git commit -m "feat(web): define Prisma schema for all 6 tables"
```

---

## Task 4: Initial Migration + Seed Data

**Files:**
- Create: `web/prisma/seed.ts`
- Create: `web/lib/db.ts`
- Create: `web/vitest.config.ts`

**Interfaces:**
- Produces:
  - `lib/db.ts` exports `prisma` (PrismaClient singleton).
  - `prisma migrate dev --name init` creates all tables in MySQL.
  - `pnpm prisma:seed` inserts 3 example nodes, each with 1–2 versions and raw requirements.

- [ ] **Step 1: Create `web/lib/db.ts` (Prisma singleton)**

```ts
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
```

- [ ] **Step 2: Run initial migration**

Run:
```bash
cd web && pnpm prisma migrate dev --name init
```
Expected: migration `init` is created and applied; Prisma prints "Your database is now in sync with your schema."

- [ ] **Step 3: Create `web/prisma/seed.ts`**

```ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const nodes = [
    {
      github_owner: 'ltdrdata',
      github_repo: 'ComfyUI-Impact-Pack',
      name: 'ComfyUI Impact Pack',
      author: 'ltdrdata',
      description: 'Detector, detailer, sampler and other impact nodes for ComfyUI.',
      versions: [
        {
          tag: 'v8.10',
          sha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
          release: '2026-01-15T00:00:00Z',
          raw: {
            python_min: '3.10',
            python_max: null,
            dependencies: [
              { name: 'torch', spec: '>=2.0,<3.0', min_version: '2.0', max_version: '3.0', is_pinned: false },
              { name: 'ultralytics', spec: '>=8.0.0', min_version: '8.0.0', max_version: null, is_pinned: false },
            ],
            node_class_mappings: ['SAMLoader', 'SAMDetectorCombined', 'FaceDetailer', 'DetailerForEach'],
            incompatibilities: [],
          },
        },
        {
          tag: 'v8.9',
          sha: 'b2c3d4e5f6071829a3b4c5d6e7f809123456789a',
          release: '2025-11-02T00:00:00Z',
          raw: {
            python_min: '3.10',
            python_max: null,
            dependencies: [
              { name: 'torch', spec: '>=2.0,<3.0', min_version: '2.0', max_version: '3.0', is_pinned: false },
            ],
            node_class_mappings: ['SAMLoader', 'FaceDetailer'],
            incompatibilities: [],
          },
        },
      ],
    },
    {
      github_owner: 'Fannovel16',
      github_repo: 'comfyui_controlnet_aux',
      name: 'ComfyUI ControlNet Aux',
      author: 'Fannovel16',
      description: 'Preprocessors for ControlNet (lineart, depth, canny, etc.).',
      versions: [
        {
          tag: 'v1.2.0',
          sha: 'c3d4e5f60718293a4b5c6d7e8f90123456789abcd',
          release: '2026-02-20T00:00:00Z',
          raw: {
            python_min: '3.9',
            python_max: null,
            dependencies: [
              { name: 'torch', spec: '>=1.13', min_version: '1.13', max_version: null, is_pinned: false },
              { name: 'opencv-python', spec: '>=4.5', min_version: '4.5', max_version: null, is_pinned: false },
            ],
            node_class_mappings: ['CannyEdge', 'LineartPreprocessor', 'DepthMapPreprocessor'],
            incompatibilities: [],
          },
        },
      ],
    },
    {
      github_owner: 'rgthree',
      github_repo: 'rgthree-comfy',
      name: 'rgthree-comfy',
      author: 'rgthree',
      description: 'Quality-of-life nodes: context, fast groups, power LoRA loader.',
      versions: [
        {
          tag: 'v1.0.3',
          sha: 'd4e5f6071829a3b4c5d6e7f809123456789abcdef',
          release: '2026-03-05T00:00:00Z',
          raw: {
            python_min: '3.10',
            python_max: null,
            dependencies: [
              { name: 'torch', spec: '>=2.0', min_version: '2.0', max_version: null, is_pinned: false },
            ],
            node_class_mappings: ['FastGroup', 'Context', 'PowerLoraLoader'],
            incompatibilities: [],
          },
        },
      ],
    },
  ];

  for (const n of nodes) {
    const node = await prisma.node.upsert({
      where: { github_owner_github_repo: { github_owner: n.github_owner, github_repo: n.github_repo } },
      update: { name: n.name, description: n.description, author: n.author },
      create: {
        github_owner: n.github_owner,
        github_repo: n.github_repo,
        name: n.name,
        author: n.author,
        description: n.description,
      },
    });

    for (const v of n.versions) {
      const version = await prisma.nodeVersion.upsert({
        where: { node_id_version_tag: { node_id: node.id, version_tag: v.tag } },
        update: {},
        create: {
          node_id: node.id,
          version_tag: v.tag,
          git_sha: v.sha,
          release_date: new Date(v.release),
        },
      });

      await prisma.nodeRawRequirement.upsert({
        where: { version_id: version.id },
        update: {},
        create: {
          version_id: version.id,
          python_min: v.raw.python_min,
          python_max: v.raw.python_max,
          dependencies: v.raw.dependencies,
          node_class_mappings: v.raw.node_class_mappings,
          incompatibilities: v.raw.incompatibilities,
          scan_warnings: [],
          raw_files: {},
        },
      });
    }
  }

  const counts = {
    nodes: await prisma.node.count(),
    versions: await prisma.nodeVersion.count(),
    raw: await prisma.nodeRawRequirement.count(),
  };
  console.log('Seed complete:', counts);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 4: Run seed**

Run:
```bash
cd web && pnpm prisma:seed
```
Expected log:
```
Seed complete: { nodes: 3, versions: 4, raw: 4 }
```

- [ ] **Step 5: Configure Vitest**

Create `web/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
});
```

- [ ] **Step 6: Commit**

```bash
git add web/prisma/seed.ts web/lib/db.ts web/vitest.config.ts
git commit -m "feat(web): initial migration, seed data, Prisma singleton, Vitest config"
```

---

## Task 5: NextAuth.js v5 — GitHub OAuth + User Upsert

**Files:**
- Create: `web/lib/auth.ts`
- Create: `web/app/api/auth/[...nextauth]/route.ts`

**Interfaces:**
- Produces:
  - `lib/auth.ts` exports `{ handlers, auth, signIn, signOut }` from NextAuth v5.
  - On every successful GitHub sign-in, a row is upserted in `users` keyed on `github_id`.
  - If `github_id == BOOTSTRAP_ADMIN_GITHUB_ID` (env var), role is forced to `'admin'`.
  - `app/api/auth/[...nextauth]/route.ts` re-exports `handlers.GET` and `handlers.POST`.

- [ ] **Step 1: Create `web/lib/auth.ts`**

```ts
import NextAuth from 'next-auth';
import GitHub from 'next-auth/providers/github';
import { prisma } from './db';

const bootstrapAdminId = BigInt(process.env.BOOTSTRAP_ADMIN_GITHUB_ID ?? '0');

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_SECRET,
    }),
  ],
  secret: process.env.NEXTAUTH_SECRET,
  callbacks: {
    async signIn({ profile }) {
      if (!profile?.id || !profile.login) return false;
      const githubId = BigInt(profile.id as string);
      await prisma.user.upsert({
        where: { github_id: githubId },
        update: {
          username: profile.login as string,
          avatar_url: (profile.avatar_url as string) ?? '',
          ...(githubId === bootstrapAdminId ? { role: 'admin' } : {}),
        },
        create: {
          github_id: githubId,
          username: profile.login as string,
          avatar_url: (profile.avatar_url as string) ?? '',
          email: (profile.email as string) ?? null,
          role: githubId === bootstrapAdminId ? 'admin' : 'user',
        },
      });
      return true;
    },
    async session({ session, token }) {
      if (token.sub) {
        const user = await prisma.user.findUnique({
          where: { github_id: BigInt(token.sub) },
        });
        if (user) {
          (session.user as { id?: string }).id = user.id.toString();
          (session.user as { role?: string }).role = user.role;
        }
      }
      return session;
    },
  },
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
});
```

- [ ] **Step 2: Create NextAuth route handler**

Create `web/app/api/auth/[...nextauth]/route.ts`:

```ts
import { handlers } from '@/lib/auth';
export const { GET, POST } = handlers;
```

- [ ] **Step 3: Verify TypeScript compiles**

Run:
```bash
cd web && pnpm exec tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add web/lib/auth.ts web/app/api/auth/
git commit -m "feat(web): NextAuth v5 with GitHub OAuth and user upsert"
```

> Note: GitHub OAuth cannot be exercised end-to-end without real OAuth credentials. This task is verified by TypeScript compilation and by manual smoke test in Task 17.

---

## Task 6: Session Helper (getCurrentUser + role checks)

**Files:**
- Create: `web/lib/session.ts`

**Interfaces:**
- Produces:
  - `getCurrentUser(): Promise<{ id: string; githubId: string; username: string; role: 'user' | 'admin' } | null>`
  - `requireUser(): Promise<NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>>` — throws if not authenticated.
  - `requireAdmin(): Promise<...>` — throws if not admin.

- [ ] **Step 1: Create `web/lib/session.ts`**

```ts
import { auth } from './auth';
import { prisma } from './db';

export type CurrentUser = {
  id: string;
  githubId: string;
  username: string;
  role: 'user' | 'admin';
};

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await auth();
  const sub = (session?.user as { id?: string } | undefined)?.id;
  if (!sub) return null;
  const user = await prisma.user.findUnique({ where: { id: BigInt(sub) } });
  if (!user) return null;
  return {
    id: user.id.toString(),
    githubId: user.github_id.toString(),
    username: user.username,
    role: user.role,
  };
}

export async function requireUser(): Promise<CurrentUser> {
  const u = await getCurrentUser();
  if (!u) throw new Error('UNAUTHENTICATED');
  return u;
}

export async function requireAdmin(): Promise<CurrentUser> {
  const u = await requireUser();
  if (u.role !== 'admin') throw new Error('FORBIDDEN');
  return u;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run:
```bash
cd web && pnpm exec tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add web/lib/session.ts
git commit -m "feat(web): session helpers (getCurrentUser, requireUser, requireAdmin)"
```

---

## Task 7: App Header with Login/Logout

**Files:**
- Create: `web/app/(public)/_components/Header.tsx`
- Modify: `web/app/layout.tsx`

**Interfaces:**
- Consumes: `getCurrentUser()` from `web/lib/session.ts`.
- Produces: top-of-page header rendered in root layout. Shows "登录" link when unauthenticated, username + "退出" when authenticated.

- [ ] **Step 1: Create `web/app/(public)/_components/Header.tsx`**

```tsx
import Link from 'next/link';
import { getCurrentUser } from '@/lib/session';
import { signIn, signOut } from '@/lib/auth';

export async function Header() {
  const user = await getCurrentUser();
  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between p-4">
        <Link href="/" className="text-lg font-bold text-accent">
          ComfyUI Node Wiki
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/nodes" className="text-gray-700 hover:text-accent">节点</Link>
          {user ? (
            <form action={async () => { 'use server'; await signOut({ redirectTo: '/' }); }}>
              <span className="text-gray-600">{user.username}</span>
              <button type="submit" className="ml-3 text-gray-700 hover:text-accent">退出</button>
            </form>
          ) : (
            <form action={async () => { 'use server'; await signIn('github', { redirectTo: '/' }); }}>
              <button type="submit" className="text-gray-700 hover:text-accent">用 GitHub 登录</button>
            </form>
          )}
        </nav>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Wire header into root layout**

Replace `web/app/layout.tsx`:

```tsx
import './globals.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Header } from './(public)/_components/Header';

export const metadata: Metadata = {
  title: 'ComfyUI Node Wiki',
  description: 'Community-maintained metadata for ComfyUI custom nodes.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh">
      <body className="min-h-screen bg-gray-50 text-gray-900">
        <Header />
        {children}
      </body>
    </html>
  );
}
```

- [ ] **Step 3: Verify build**

Run:
```bash
cd web && pnpm dev
```
Open http://localhost:3000. Expected: header shows "ComfyUI Node Wiki / 节点 / 用 GitHub 登录". Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add web/app/layout.tsx web/app/\(public\)/_components/Header.tsx
git commit -m "feat(web): header with GitHub sign-in/out"
```

---

## Task 8: Format Helpers

**Files:**
- Create: `web/lib/format.ts`

**Interfaces:**
- Produces:
  - `formatDate(d: Date | string): string` — ISO-8601 short form (`YYYY-MM-DD`).
  - `formatDateTime(d: Date | string): string` — ISO-8601 with time.
  - `shortenSpec(spec: string, max = 24): string` — truncates long PEP 440 specs for table display.

- [ ] **Step 1: Write failing tests**

Create `web/tests/lib/format.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { formatDate, formatDateTime, shortenSpec } from '@/lib/format';

describe('formatDate', () => {
  it('formats a Date as YYYY-MM-DD', () => {
    expect(formatDate(new Date('2026-03-05T12:34:56Z'))).toBe('2026-03-05');
  });
  it('accepts an ISO string', () => {
    expect(formatDate('2026-03-05T12:34:56Z')).toBe('2026-03-05');
  });
});

describe('formatDateTime', () => {
  it('formats a Date as ISO-8601 with seconds', () => {
    expect(formatDateTime(new Date('2026-03-05T12:34:56Z'))).toBe('2026-03-05T12:34:56Z');
  });
});

describe('shortenSpec', () => {
  it('truncates specs longer than max', () => {
    expect(shortenSpec('>=2.0.0,<3.0.0,!=2.5.0', 10)).toBe('>=2.0.0,...');
  });
  it('returns short specs unchanged', () => {
    expect(shortenSpec('>=2.0', 10)).toBe('>=2.0');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd web && pnpm test tests/lib/format.test.ts
```
Expected: FAIL — `Cannot find module '@/lib/format'`.

- [ ] **Step 3: Implement `web/lib/format.ts`**

```ts
export function formatDate(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toISOString().slice(0, 10);
}

export function formatDateTime(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toISOString().slice(0, 19) + 'Z';
}

export function shortenSpec(spec: string, max = 24): string {
  if (spec.length <= max) return spec;
  return spec.slice(0, max) + '...';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd web && pnpm test tests/lib/format.test.ts
```
Expected: PASS (5 tests passing).

- [ ] **Step 5: Commit**

```bash
git add web/lib/format.ts web/tests/lib/format.test.ts
git commit -m "feat(web): date and spec formatting helpers"
```

---

## Task 9: API Helper Utilities

**Files:**
- Create: `web/lib/api-helpers.ts`

**Interfaces:**
- Produces:
  - `json(data: unknown, init?: ResponseInit): Response` — JSON response with `Content-Type: application/json; charset=utf-8`.
  - `error(status: number, message: string, detail?: unknown): Response` — `{ error: { message, detail? } }`.
  - `parsePagination(url: URL): { page: number; pageSize: number }` — defaults `page=1`, `pageSize=20`, max `pageSize=100`.
  - `parseSearch(url: URL): { q: string | null }`.

- [ ] **Step 1: Write failing tests**

Create `web/tests/lib/api-helpers.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { json, error, parsePagination, parseSearch } from '@/lib/api-helpers';

describe('json', () => {
  it('sets Content-Type and serializes body', async () => {
    const r = json({ hello: 'world' });
    expect(r.headers.get('Content-Type')).toMatch(/application\/json/);
    expect(await r.json()).toEqual({ hello: 'world' });
  });
  it('respects init.status', () => {
    const r = json({}, { status: 201 });
    expect(r.status).toBe(201);
  });
});

describe('error', () => {
  it('wraps message in error object', async () => {
    const r = error(404, 'not found');
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: { message: 'not found', detail: undefined } });
  });
});

describe('parsePagination', () => {
  it('defaults to page 1 size 20', () => {
    expect(parsePagination(new URL('http://x/'))).toEqual({ page: 1, pageSize: 20 });
  });
  it('clamps pageSize to 100', () => {
    expect(parsePagination(new URL('http://x/?page_size=999')).pageSize).toBe(100);
  });
  it('rejects negative or zero values', () => {
    expect(parsePagination(new URL('http://x/?page=-1')).page).toBe(1);
    expect(parsePagination(new URL('http://x/?page_size=0')).pageSize).toBe(20);
  });
});

describe('parseSearch', () => {
  it('returns null q when absent', () => {
    expect(parseSearch(new URL('http://x/')).q).toBeNull();
  });
  it('returns trimmed q when present', () => {
    expect(parseSearch(new URL('http://x/?q=  foo  ')).q).toBe('foo');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd web && pnpm test tests/lib/api-helpers.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `web/lib/api-helpers.ts`**

```ts
export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function error(status: number, message: string, detail?: unknown): Response {
  return json({ error: { message, detail } }, { status });
}

export function parsePagination(url: URL): { page: number; pageSize: number } {
  const rawPage = Number(url.searchParams.get('page') ?? 1);
  const rawSize = Number(url.searchParams.get('page_size') ?? 20);
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
  const pageSize = Number.isFinite(rawSize) && rawSize >= 1 ? Math.min(100, Math.floor(rawSize)) : 20;
  return { page, pageSize };
}

export function parseSearch(url: URL): { q: string | null } {
  const raw = url.searchParams.get('q') ?? url.searchParams.get('search');
  if (!raw) return { q: null };
  const q = raw.trim();
  return { q: q.length === 0 ? null : q };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd web && pnpm test tests/lib/api-helpers.test.ts
```
Expected: PASS (9 tests passing).

- [ ] **Step 5: Commit**

```bash
git add web/lib/api-helpers.ts web/tests/lib/api-helpers.test.ts
git commit -m "feat(web): API helpers (json, error, pagination, search)"
```

---

## Task 10: Test Setup and Fixtures

**Files:**
- Create: `web/tests/setup.ts`
- Create: `web/tests/fixtures.ts`
- Create: `web/.env.test`

**Interfaces:**
- Produces:
  - `tests/setup.ts` runs before all Vitest suites: pushes schema to test DB, truncates all data tables.
  - `tests/fixtures.ts` exports `await seedFixture(prisma)` which inserts 3 nodes / 4 versions identical to the dev seed (idempotent on a fresh DB).
  - `.env.test` sets `DATABASE_URL` to the test DB.

- [ ] **Step 1: Create `web/.env.test`**

```
DATABASE_URL="mysql://comfyui:comfyuipw@localhost:3306/comfyui_nodes_test"
NEXTAUTH_SECRET="test-secret-not-used-in-handlers"
NEXTAUTH_URL="http://localhost:3000"
GITHUB_CLIENT_ID="test"
GITHUB_SECRET="test"
BOOTSTRAP_ADMIN_GITHUB_ID="0"
```

- [ ] **Step 2: Create test database**

Run:
```bash
docker compose exec mysql mysql -uroot -prootpw -e "CREATE DATABASE IF NOT EXISTS comfyui_nodes_test CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"
```
Expected: command exits 0, no output.

- [ ] **Step 3: Push schema to test DB**

Run:
```bash
cd web && DATABASE_URL="mysql://comfyui:comfyuipw@localhost:3306/comfyui_nodes_test" pnpm exec prisma db push
```
Expected: `Your database is now in sync with your Prisma schema.`

- [ ] **Step 4: Create `web/tests/setup.ts`**

```ts
import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

// Ensure env is loaded from .env.test for Prisma client init.
process.env.DATABASE_URL ??= 'mysql://comfyui:comfyuipw@localhost:3306/comfyui_nodes_test';

let pushed = false;

export async function setup(): Promise<void> {
  if (!pushed) {
    execSync('pnpm exec prisma db push --skip-generate --accept-data-loss', {
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
      stdio: 'inherit',
    });
    pushed = true;
  }
  const prisma = new PrismaClient();
  try {
    await prisma.$transaction([
      prisma.wikiRevision.deleteMany(),
      prisma.nodeRawRequirement.deleteMany(),
      prisma.nodeVersion.deleteMany(),
      prisma.node.deleteMany(),
      prisma.nodeSubmission.deleteMany(),
      prisma.user.deleteMany(),
    ]);
  } finally {
    await prisma.$disconnect();
  }
}
```

- [ ] **Step 5: Create `web/tests/fixtures.ts`**

```ts
import { PrismaClient } from '@prisma/client';

export async function seedFixture(prisma: PrismaClient): Promise<void> {
  const nodes = [
    {
      github_owner: 'ltdrdata',
      github_repo: 'ComfyUI-Impact-Pack',
      name: 'ComfyUI Impact Pack',
      author: 'ltdrdata',
      versions: [
        { tag: 'v8.10', sha: 'a'.repeat(40), release: new Date('2026-01-15T00:00:00Z') },
        { tag: 'v8.9', sha: 'b'.repeat(40), release: new Date('2025-11-02T00:00:00Z') },
      ],
    },
    {
      github_owner: 'Fannovel16',
      github_repo: 'comfyui_controlnet_aux',
      name: 'ComfyUI ControlNet Aux',
      author: 'Fannovel16',
      versions: [{ tag: 'v1.2.0', sha: 'c'.repeat(40), release: new Date('2026-02-20T00:00:00Z') }],
    },
    {
      github_owner: 'rgthree',
      github_repo: 'rgthree-comfy',
      name: 'rgthree-comfy',
      author: 'rgthree',
      versions: [{ tag: 'v1.0.3', sha: 'd'.repeat(40), release: new Date('2026-03-05T00:00:00Z') }],
    },
  ];

  for (const n of nodes) {
    const node = await prisma.node.create({
      data: {
        github_owner: n.github_owner,
        github_repo: n.github_repo,
        name: n.name,
        author: n.author,
      },
    });
    for (const v of n.versions) {
      const version = await prisma.nodeVersion.create({
        data: { node_id: node.id, version_tag: v.tag, git_sha: v.sha, release_date: v.release },
      });
      await prisma.nodeRawRequirement.create({
        data: {
          version_id: version.id,
          python_min: '3.10',
          python_max: null,
          dependencies: [],
          node_class_mappings: [],
          incompatibilities: [],
          scan_warnings: [],
          raw_files: {},
        },
      });
    }
  }
}
```

- [ ] **Step 6: Wire setup into Vitest config**

Replace `web/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    globalSetup: ['./tests/setup.ts'],
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
});
```

- [ ] **Step 7: Run vitest with no tests to verify setup**

Run:
```bash
cd web && pnpm test
```
Expected: `No test files found` (or 0 tests collected) — the globalSetup runs and exits cleanly. The migration command may print output; that's fine.

- [ ] **Step 8: Commit**

```bash
git add web/tests/setup.ts web/tests/fixtures.ts web/.env.test web/vitest.config.ts
git commit -m "test(web): vitest setup with test DB migration and fixtures"
```

---

## Task 11: getPublishedRequirements Helper (TDD)

**Files:**
- Create: `web/lib/published.ts`
- Create: `web/tests/lib/published.test.ts`

**Interfaces:**
- Consumes: `prisma` from `web/lib/db.ts`.
- Produces:
  ```ts
  type PublishedDependency = {
    name: string;
    spec: string;
    min_version: string | null;
    max_version: string | null;
    is_pinned: boolean;
  };
  type PublishedRequirements = {
    version_id: number;
    version_tag: string;
    release_date: Date;
    python_min: string | null;
    python_max: string | null;
    dependencies: PublishedDependency[];
    node_class_mappings: string[];
    incompatibilities: string[];
  };
  function getPublishedRequirements(versionId: number): Promise<PublishedRequirements>;
  ```

  Merge rule: latest `status='approved'` `wiki_revisions` row (by `reviewed_at desc`) overlays raw fields; pending/rejected rows are ignored. When no raw row exists either, return safe empty defaults (used when scanner hasn't yet processed the version).

- [ ] **Step 1: Write the failing test**

Create `web/tests/lib/published.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { setup } from '../setup';
import { seedFixture } from '../fixtures';
import { getPublishedRequirements } from '@/lib/published';

const prisma = new PrismaClient();

describe('getPublishedRequirements', () => {
  beforeEach(async () => {
    await setup();
    await seedFixture(prisma);
  });

  it('returns raw requirements when no wiki revisions exist', async () => {
    const version = await prisma.nodeVersion.findFirstOrThrow({
      where: { version_tag: 'v8.10' },
    });
    await prisma.nodeRawRequirement.update({
      where: { version_id: version.id },
      data: {
        python_min: '3.10',
        python_max: null,
        dependencies: [
          { name: 'torch', spec: '>=2.0,<3.0', min_version: '2.0', max_version: '3.0', is_pinned: false },
        ],
        node_class_mappings: ['SAMLoader'],
        incompatibilities: [],
      },
    });
    const r = await getPublishedRequirements(version.id);
    expect(r.python_min).toBe('3.10');
    expect(r.dependencies).toHaveLength(1);
    expect(r.dependencies[0]?.name).toBe('torch');
    expect(r.node_class_mappings).toEqual(['SAMLoader']);
  });

  it('overlays approved wiki revisions on top of raw data', async () => {
    const version = await prisma.nodeVersion.findFirstOrThrow({ where: { version_tag: 'v8.10' } });
    const user = await prisma.user.create({ data: { github_id: 1n, username: 'editor', avatar_url: '' } });
    await prisma.wikiRevision.create({
      data: {
        version_id: version.id,
        author_id: user.id,
        python_min: '3.11',
        dependencies: [],
        node_class_mappings: ['SAMLoader', 'BarNode'],
        incompatibilities: ['comfyui-impact-pack'],
        notes_md: '',
        edit_summary: 'add BarNode',
        status: 'approved',
        reviewer_id: user.id,
        reviewed_at: new Date('2026-04-01T00:00:00Z'),
      },
    });
    const r = await getPublishedRequirements(version.id);
    expect(r.python_min).toBe('3.11');
    expect(r.dependencies).toHaveLength(0);
    expect(r.node_class_mappings).toEqual(['SAMLoader', 'BarNode']);
    expect(r.incompatibilities).toEqual(['comfyui-impact-pack']);
  });

  it('ignores pending and rejected revisions', async () => {
    const version = await prisma.nodeVersion.findFirstOrThrow({ where: { version_tag: 'v8.10' } });
    const user = await prisma.user.create({ data: { github_id: 1n, username: 'editor', avatar_url: '' } });
    await prisma.wikiRevision.create({
      data: {
        version_id: version.id,
        author_id: user.id,
        python_min: '3.12',
        dependencies: [],
        node_class_mappings: [],
        incompatibilities: [],
        notes_md: '',
        edit_summary: 'try python 3.12',
        status: 'pending',
      },
    });
    await prisma.wikiRevision.create({
      data: {
        version_id: version.id,
        author_id: user.id,
        python_min: '3.13',
        dependencies: [],
        node_class_mappings: [],
        incompatibilities: [],
        notes_md: '',
        edit_summary: 'bad',
        status: 'rejected',
        reviewer_id: user.id,
        reviewed_at: new Date('2026-04-01T00:00:00Z'),
      },
    });
    const r = await getPublishedRequirements(version.id);
    expect(r.python_min).toBe('3.10'); // raw default
  });

  it('returns safe defaults when neither raw nor approved exist', async () => {
    const version = await prisma.nodeVersion.findFirstOrThrow({ where: { version_tag: 'v8.9' } });
    // delete raw row to simulate un-scanned version
    await prisma.nodeRawRequirement.delete({ where: { version_id: version.id } });
    const r = await getPublishedRequirements(version.id);
    expect(r.python_min).toBeNull();
    expect(r.python_max).toBeNull();
    expect(r.dependencies).toEqual([]);
    expect(r.node_class_mappings).toEqual([]);
    expect(r.incompatibilities).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd web && pnpm test tests/lib/published.test.ts
```
Expected: FAIL — `Cannot find module '@/lib/published'`.

- [ ] **Step 3: Implement `web/lib/published.ts`**

```ts
import { prisma } from './db';

export type PublishedDependency = {
  name: string;
  spec: string;
  min_version: string | null;
  max_version: string | null;
  is_pinned: boolean;
};

export type PublishedRequirements = {
  version_id: number;
  version_tag: string;
  release_date: Date;
  python_min: string | null;
  python_max: string | null;
  dependencies: PublishedDependency[];
  node_class_mappings: string[];
  incompatibilities: string[];
};

export async function getPublishedRequirements(
  versionId: number,
): Promise<PublishedRequirements> {
  const version = await prisma.nodeVersion.findUniqueOrThrow({
    where: { id: versionId },
    include: {
      raw_requirements: true,
      wiki_revisions: {
        where: { status: 'approved' },
        orderBy: { reviewed_at: 'desc' },
        take: 1,
      },
    },
  });

  const raw = version.raw_requirements;
  const approved = version.wiki_revisions[0];

  return {
    version_id: version.id,
    version_tag: version.version_tag,
    release_date: version.release_date,
    python_min: approved?.python_min ?? raw?.python_min ?? null,
    python_max: approved?.python_max ?? raw?.python_max ?? null,
    dependencies:
      (approved?.dependencies as PublishedDependency[] | null) ??
      (raw?.dependencies as PublishedDependency[] | null) ??
      [],
    node_class_mappings:
      (approved?.node_class_mappings as string[] | null) ??
      raw?.node_class_mappings ??
      [],
    incompatibilities:
      (approved?.incompatibilities as string[] | null) ??
      raw?.incompatibilities ??
      [],
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd web && pnpm test tests/lib/published.test.ts
```
Expected: PASS (4 tests passing).

- [ ] **Step 5: Commit**

```bash
git add web/lib/published.ts web/tests/lib/published.test.ts
git commit -m "feat(web): getPublishedRequirements helper with raw+approved merge"
```

---

## Task 12: Public API — GET /api/v1/nodes (list)

**Files:**
- Create: `web/app/api/v1/nodes/route.ts`
- Create: `web/tests/api/nodes-list.test.ts`

**Interfaces:**
- Produces:
  ```
  GET /api/v1/nodes?page=1&page_size=20&q=impact
  → 200 { items: Array<{ owner, repo, name, author, description, updated_at }>, page, page_size, total }
  ```
  - `q` matches `name` OR `author` (case-insensitive substring).
  - Excludes `status='hidden'`. Includes `active` and `deprecated`.

- [ ] **Step 1: Write the failing test**

Create `web/tests/api/nodes-list.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { setup } from '../setup';
import { seedFixture } from '../fixtures';
import { GET } from '@/app/api/v1/nodes/route';

const prisma = new PrismaClient();

describe('GET /api/v1/nodes', () => {
  beforeEach(async () => {
    await setup();
    await seedFixture(prisma);
  });

  it('returns paginated active nodes', async () => {
    const res = await GET(new Request('http://x/api/v1/nodes?page=1&page_size=2'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.page).toBe(1);
    expect(body.page_size).toBe(2);
    expect(body.total).toBe(3);
    expect(body.items).toHaveLength(2);
    expect(body.items[0]).toMatchObject({
      owner: expect.any(String),
      repo: expect.any(String),
      name: expect.any(String),
    });
  });

  it('filters by q (name match)', async () => {
    const res = await GET(new Request('http://x/api/v1/nodes?q=impact'));
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.items[0].name).toMatch(/Impact/);
  });

  it('filters by q (author match)', async () => {
    const res = await GET(new Request('http://x/api/v1/nodes?q=rgthree'));
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.items[0].owner).toBe('rgthree');
  });

  it('hides nodes with status=hidden', async () => {
    await prisma.node.updateMany({ data: { status: 'hidden' } });
    const res = await GET(new Request('http://x/api/v1/nodes'));
    const body = await res.json();
    expect(body.total).toBe(0);
    expect(body.items).toEqual([]);
  });

  it('returns empty page when page is past the end', async () => {
    const res = await GET(new Request('http://x/api/v1/nodes?page=99'));
    const body = await res.json();
    expect(body.total).toBe(3);
    expect(body.items).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd web && pnpm test tests/api/nodes-list.test.ts
```
Expected: FAIL — route module not found.

- [ ] **Step 3: Implement `web/app/api/v1/nodes/route.ts`**

```ts
import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { json, parsePagination, parseSearch } from '@/lib/api-helpers';

export async function GET(request: NextRequest | Request) {
  const url = new URL(request.url);
  const { page, pageSize } = parsePagination(url);
  const { q } = parseSearch(url);

  const where = {
    status: { in: ['active', 'deprecated'] as const },
    ...(q
      ? {
          OR: [
            { name: { contains: q } },
            { author: { contains: q } },
          ],
        }
      : {}),
  };

  const [total, items] = await Promise.all([
    prisma.node.count({ where }),
    prisma.node.findMany({
      where,
      orderBy: { updated_at: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        github_owner: true,
        github_repo: true,
        name: true,
        author: true,
        description: true,
        updated_at: true,
      },
    }),
  ]);

  return json({
    items: items.map((n) => ({
      owner: n.github_owner,
      repo: n.github_repo,
      name: n.name,
      author: n.author,
      description: n.description,
      updated_at: n.updated_at.toISOString(),
    })),
    page,
    page_size: pageSize,
    total,
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd web && pnpm test tests/api/nodes-list.test.ts
```
Expected: PASS (5 tests passing).

- [ ] **Step 5: Commit**

```bash
git add web/app/api/v1/nodes/route.ts web/tests/api/nodes-list.test.ts
git commit -m "feat(api): GET /api/v1/nodes with pagination and search"
```

---

## Task 13: Public API — GET /api/v1/nodes/{owner}/{repo}

**Files:**
- Create: `web/app/api/v1/nodes/[owner]/[repo]/route.ts`
- Create: `web/tests/api/node-detail.test.ts`

**Interfaces:**
- Produces:
  ```
  GET /api/v1/nodes/{owner}/{repo}
  → 200 { owner, repo, name, author, description, versions: Array<{ tag, release_date }> }
  → 404 { error: { message: "node not found" } } if missing or status='hidden'
  ```

- [ ] **Step 1: Write the failing test**

Create `web/tests/api/node-detail.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { setup } from '../setup';
import { seedFixture } from '../fixtures';
import { GET } from '@/app/api/v1/nodes/[owner]/[repo]/route';

const prisma = new PrismaClient();

describe('GET /api/v1/nodes/[owner]/[repo]', () => {
  beforeEach(async () => {
    await setup();
    await seedFixture(prisma);
  });

  it('returns node with version list (newest first)', async () => {
    const res = await GET(new Request('http://x/api/v1/nodes/ltdrdata/ComfyUI-Impact-Pack'), {
      params: Promise.resolve({ owner: 'ltdrdata', repo: 'ComfyUI-Impact-Pack' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.owner).toBe('ltdrdata');
    expect(body.repo).toBe('ComfyUI-Impact-Pack');
    expect(body.versions).toHaveLength(2);
    expect(body.versions[0].tag).toBe('v8.10');
  });

  it('returns 404 for missing node', async () => {
    const res = await GET(new Request('http://x/api/v1/nodes/no/where'), {
      params: Promise.resolve({ owner: 'no', repo: 'where' }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.message).toBe('node not found');
  });

  it('returns 404 for hidden node', async () => {
    await prisma.node.update({
      where: { github_owner_github_repo: { github_owner: 'ltdrdata', github_repo: 'ComfyUI-Impact-Pack' } },
      data: { status: 'hidden' },
    });
    const res = await GET(new Request('http://x/api/v1/nodes/ltdrdata/ComfyUI-Impact-Pack'), {
      params: Promise.resolve({ owner: 'ltdrdata', repo: 'ComfyUI-Impact-Pack' }),
    });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd web && pnpm test tests/api/node-detail.test.ts
```
Expected: FAIL — route module not found.

- [ ] **Step 3: Implement `web/app/api/v1/nodes/[owner]/[repo]/route.ts`**

```ts
import { prisma } from '@/lib/db';
import { json, error } from '@/lib/api-helpers';

type Params = { owner: string; repo: string };

export async function GET(
  _request: Request,
  { params }: { params: Promise<Params> },
) {
  const { owner, repo } = await params;
  const node = await prisma.node.findUnique({
    where: { github_owner_github_repo: { github_owner: owner, github_repo: repo } },
    include: {
      versions: { orderBy: { release_date: 'desc' }, select: { version_tag: true, release_date: true } },
    },
  });
  if (!node || node.status === 'hidden') {
    return error(404, 'node not found');
  }
  return json({
    owner: node.github_owner,
    repo: node.github_repo,
    name: node.name,
    author: node.author,
    description: node.description,
    versions: node.versions.map((v) => ({
      tag: v.version_tag,
      release_date: v.release_date.toISOString(),
    })),
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd web && pnpm test tests/api/node-detail.test.ts
```
Expected: PASS (3 tests passing).

- [ ] **Step 5: Commit**

```bash
git add web/app/api/v1/nodes/\[owner\]/\[repo\]/route.ts web/tests/api/node-detail.test.ts
git commit -m "feat(api): GET /api/v1/nodes/{owner}/{repo}"
```

---

## Task 14: Public API — GET /api/v1/nodes/{owner}/{repo}/versions/{tag}

**Files:**
- Create: `web/app/api/v1/nodes/[owner]/[repo]/versions/[tag]/route.ts`
- Create: `web/tests/api/version-detail.test.ts`

**Interfaces:**
- Produces:
  ```
  GET /api/v1/nodes/{owner}/{repo}/versions/{tag}
  → 200 { owner, repo, version_tag, release_date, python_min, python_max, dependencies, node_class_mappings, incompatibilities, notes_md }
  → 404 if either node or version is missing
  ```
  Body shape matches `getPublishedRequirements` plus `owner`, `repo`, `notes_md` (latest approved revision's notes, or empty string).

- [ ] **Step 1: Write the failing test**

Create `web/tests/api/version-detail.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { setup } from '../setup';
import { seedFixture } from '../fixtures';
import { GET } from '@/app/api/v1/nodes/[owner]/[repo]/versions/[tag]/route';

const prisma = new PrismaClient();

describe('GET /api/v1/nodes/[owner]/[repo]/versions/[tag]', () => {
  beforeEach(async () => {
    await setup();
    await seedFixture(prisma);
  });

  it('returns published view for a known version', async () => {
    const version = await prisma.nodeVersion.findFirstOrThrow({ where: { version_tag: 'v8.10' } });
    await prisma.nodeRawRequirement.update({
      where: { version_id: version.id },
      data: {
        python_min: '3.10',
        python_max: null,
        dependencies: [{ name: 'torch', spec: '>=2.0', min_version: '2.0', max_version: null, is_pinned: false }],
        node_class_mappings: ['SAMLoader'],
        incompatibilities: [],
      },
    });
    const res = await GET(new Request('http://x/api/v1/nodes/ltdrdata/ComfyUI-Impact-Pack/versions/v8.10'), {
      params: Promise.resolve({ owner: 'ltdrdata', repo: 'ComfyUI-Impact-Pack', tag: 'v8.10' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.owner).toBe('ltdrdata');
    expect(body.repo).toBe('ComfyUI-Impact-Pack');
    expect(body.version_tag).toBe('v8.10');
    expect(body.python_min).toBe('3.10');
    expect(body.dependencies).toHaveLength(1);
    expect(body.notes_md).toBe('');
  });

  it('returns 404 when version tag does not exist', async () => {
    const res = await GET(new Request('http://x/api/v1/nodes/ltdrdata/ComfyUI-Impact-Pack/versions/v999'), {
      params: Promise.resolve({ owner: 'ltdrdata', repo: 'ComfyUI-Impact-Pack', tag: 'v999' }),
    });
    expect(res.status).toBe(404);
  });

  it('returns notes_md from latest approved revision', async () => {
    const version = await prisma.nodeVersion.findFirstOrThrow({ where: { version_tag: 'v8.10' } });
    const user = await prisma.user.create({ data: { github_id: 1n, username: 'editor', avatar_url: '' } });
    await prisma.wikiRevision.create({
      data: {
        version_id: version.id,
        author_id: user.id,
        dependencies: [],
        node_class_mappings: [],
        incompatibilities: [],
        notes_md: '# 注意\n需要 ≥16GB 显存。',
        edit_summary: 'add notes',
        status: 'approved',
        reviewer_id: user.id,
        reviewed_at: new Date('2026-04-02T00:00:00Z'),
      },
    });
    const res = await GET(new Request('http://x/api/v1/nodes/ltdrdata/ComfyUI-Impact-Pack/versions/v8.10'), {
      params: Promise.resolve({ owner: 'ltdrdata', repo: 'ComfyUI-Impact-Pack', tag: 'v8.10' }),
    });
    const body = await res.json();
    expect(body.notes_md).toContain('显存');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd web && pnpm test tests/api/version-detail.test.ts
```
Expected: FAIL — route module not found.

- [ ] **Step 3: Implement `web/app/api/v1/nodes/[owner]/[repo]/versions/[tag]/route.ts`**

```ts
import { prisma } from '@/lib/db';
import { json, error } from '@/lib/api-helpers';
import { getPublishedRequirements } from '@/lib/published';

type Params = { owner: string; repo: string; tag: string };

export async function GET(
  _request: Request,
  { params }: { params: Promise<Params> },
) {
  const { owner, repo, tag } = await params;
  const version = await prisma.nodeVersion.findFirst({
    where: { version_tag: tag, node: { github_owner: owner, github_repo: repo } },
  });
  if (!version) return error(404, 'version not found');

  const published = await getPublishedRequirements(version.id);
  const latestApproved = await prisma.wikiRevision.findFirst({
    where: { version_id: version.id, status: 'approved' },
    orderBy: { reviewed_at: 'desc' },
    select: { notes_md: true },
  });

  return json({
    owner,
    repo,
    version_tag: published.version_tag,
    release_date: published.release_date.toISOString(),
    python_min: published.python_min,
    python_max: published.python_max,
    dependencies: published.dependencies,
    node_class_mappings: published.node_class_mappings,
    incompatibilities: published.incompatibilities,
    notes_md: latestApproved?.notes_md ?? '',
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd web && pnpm test tests/api/version-detail.test.ts
```
Expected: PASS (3 tests passing).

- [ ] **Step 5: Commit**

```bash
git add "web/app/api/v1/nodes/[owner]/[repo]/versions/[tag]/route.ts" web/tests/api/version-detail.test.ts
git commit -m "feat(api): GET /api/v1/nodes/{owner}/{repo}/versions/{tag}"
```

---

## Task 15: Public UI — Shared Components

**Files:**
- Create: `web/app/(public)/_components/NodeCard.tsx`
- Create: `web/app/(public)/_components/Pagination.tsx`
- Create: `web/app/(public)/_components/DependencyTable.tsx`

**Interfaces:**
- Produces:
  - `<NodeCard owner repo name author description updatedAt />` — list-item card.
  - `<Pagination page pageSize total basePath />` — links to `?page=N`.
  - `<DependencyTable deps />` — table of `{ name, spec, min_version, max_version, is_pinned }`.

- [ ] **Step 1: Create `NodeCard.tsx`**

```tsx
import Link from 'next/link';
import { formatDate } from '@/lib/format';

type Props = {
  owner: string;
  repo: string;
  name: string;
  author: string;
  description: string | null;
  updatedAt: string | Date;
};

export function NodeCard({ owner, repo, name, author, description, updatedAt }: Props) {
  return (
    <Link
      href={`/nodes/${owner}/${repo}`}
      className="block rounded border border-gray-200 bg-white p-4 hover:border-accent"
    >
      <div className="flex items-baseline justify-between">
        <h3 className="text-lg font-semibold">{name}</h3>
        <span className="text-xs text-gray-500">{formatDate(updatedAt)}</span>
      </div>
      <div className="mt-1 text-sm text-gray-500">by {author}</div>
      {description && <p className="mt-2 text-sm text-gray-700">{description}</p>}
    </Link>
  );
}
```

- [ ] **Step 2: Create `Pagination.tsx`**

```tsx
import Link from 'next/link';

type Props = {
  page: number;
  pageSize: number;
  total: number;
  basePath: string;
};

export function Pagination({ page, pageSize, total, basePath }: Props) {
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  if (lastPage <= 1) return null;
  const link = (p: number) => `${basePath}?page=${p}&page_size=${pageSize}`;
  return (
    <nav className="flex items-center justify-between border-t border-gray-200 pt-4 text-sm">
      <span className="text-gray-500">第 {page} / {lastPage} 页 · 共 {total} 条</span>
      <div className="flex gap-2">
        {page > 1 && <Link href={link(page - 1)} className="text-accent hover:underline">上一页</Link>}
        {page < lastPage && <Link href={link(page + 1)} className="text-accent hover:underline">下一页</Link>}
      </div>
    </nav>
  );
}
```

- [ ] **Step 3: Create `DependencyTable.tsx`**

```tsx
import { shortenSpec } from '@/lib/format';
import type { PublishedDependency } from '@/lib/published';

export function DependencyTable({ deps }: { deps: PublishedDependency[] }) {
  if (deps.length === 0) return <p className="text-sm text-gray-500">无依赖。</p>;
  return (
    <table className="w-full text-sm">
      <thead className="border-b border-gray-200 text-left text-gray-500">
        <tr>
          <th className="py-2">包</th>
          <th className="py-2">规范</th>
          <th className="py-2">最低</th>
          <th className="py-2">最高</th>
        </tr>
      </thead>
      <tbody>
        {deps.map((d) => (
          <tr key={d.name} className="border-b border-gray-100">
            <td className="py-2 font-mono">{d.name}</td>
            <td className="py-2 font-mono" title={d.spec}>{shortenSpec(d.spec)}</td>
            <td className="py-2 font-mono">{d.min_version ?? '—'}</td>
            <td className="py-2 font-mono">{d.max_version ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run:
```bash
cd web && pnpm exec tsc --noEmit
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add web/app/\(public\)/_components/
git commit -m "feat(web): shared UI components (NodeCard, Pagination, DependencyTable)"
```

---

## Task 16: Public UI — Home Page (stats + recent nodes)

**Files:**
- Modify: `web/app/page.tsx`

**Interfaces:**
- Produces: home page at `/` showing total node count, total version count, and 5 most-recently-updated nodes as `<NodeCard>` list. Cached with `revalidate = 60`.

- [ ] **Step 1: Replace `web/app/page.tsx`**

```tsx
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { NodeCard } from './(public)/_components/NodeCard';

export const revalidate = 60;

export default async function HomePage() {
  const [nodeCount, versionCount, recent] = await Promise.all([
    prisma.node.count({ where: { status: { in: ['active', 'deprecated'] } } }),
    prisma.nodeVersion.count(),
    prisma.node.findMany({
      where: { status: { in: ['active', 'deprecated'] } },
      orderBy: { updated_at: 'desc' },
      take: 5,
      select: { github_owner: true, github_repo: true, name: true, author: true, description: true, updated_at: true },
    }),
  ]);

  return (
    <main className="mx-auto max-w-5xl p-8">
      <h1 className="text-3xl font-bold">ComfyUI 节点元数据 Wiki</h1>
      <p className="mt-2 text-gray-600">
        社区维护的 ComfyUI 自定义节点依赖、Python 版本与互斥关系。
      </p>

      <div className="mt-6 grid grid-cols-2 gap-4">
        <div className="rounded border border-gray-200 bg-white p-4">
          <div className="text-sm text-gray-500">收录节点</div>
          <div className="mt-1 text-2xl font-bold">{nodeCount}</div>
        </div>
        <div className="rounded border border-gray-200 bg-white p-4">
          <div className="text-sm text-gray-500">已扫描版本</div>
          <div className="mt-1 text-2xl font-bold">{versionCount}</div>
        </div>
      </div>

      <section className="mt-8">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xl font-semibold">最近更新</h2>
          <Link href="/nodes" className="text-sm text-accent hover:underline">查看全部 →</Link>
        </div>
        <div className="mt-4 grid gap-3">
          {recent.map((n) => (
            <NodeCard
              key={`${n.github_owner}/${n.github_repo}`}
              owner={n.github_owner}
              repo={n.github_repo}
              name={n.name}
              author={n.author}
              description={n.description}
              updatedAt={n.updated_at}
            />
          ))}
        </div>
      </section>
    </main>
  );
}
```

- [ ] **Step 2: Verify in browser**

Run:
```bash
cd web && pnpm dev
```
Open http://localhost:3000. Expected:
- Header shows "ComfyUI Node Wiki / 节点 / 用 GitHub 登录".
- Stats cards show "3" and "4".
- 3 recent node cards (only 3 nodes in seed). Stop dev server.

- [ ] **Step 3: Commit**

```bash
git add web/app/page.tsx
git commit -m "feat(web): home page with stats and recent nodes"
```

---

## Task 17: Public UI — Node List Page

**Files:**
- Create: `web/app/(public)/nodes/page.tsx`

**Interfaces:**
- Produces: `/nodes` page with `?page=&page_size=&q=` search. Shows paginated `<NodeCard>` list. Cached with `revalidate = 60`.

- [ ] **Step 1: Create `web/app/(public)/nodes/page.tsx`**

```tsx
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { NodeCard } from '../_components/NodeCard';
import { Pagination } from '../_components/Pagination';

export const revalidate = 60;

type SearchParams = { page?: string; page_size?: string; q?: string };

export default async function NodesListPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(sp.page_size ?? 20) || 20));
  const q = (sp.q ?? '').trim();

  const where = {
    status: { in: ['active', 'deprecated'] as const },
    ...(q
      ? { OR: [{ name: { contains: q } }, { author: { contains: q } }] }
      : {}),
  };

  const [total, items] = await Promise.all([
    prisma.node.count({ where }),
    prisma.node.findMany({
      where,
      orderBy: { updated_at: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        github_owner: true,
        github_repo: true,
        name: true,
        author: true,
        description: true,
        updated_at: true,
      },
    }),
  ]);

  return (
    <main className="mx-auto max-w-5xl p-8">
      <h1 className="text-2xl font-bold">节点</h1>

      <form className="mt-4 flex gap-2" action="/nodes" method="get">
        <input
          name="q"
          defaultValue={q}
          placeholder="按名称或作者搜索…"
          className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm"
        />
        <button type="submit" className="rounded bg-accent px-4 py-2 text-sm text-white">搜索</button>
      </form>

      <div className="mt-6 grid gap-3">
        {items.map((n) => (
          <NodeCard
            key={`${n.github_owner}/${n.github_repo}`}
            owner={n.github_owner}
            repo={n.github_repo}
            name={n.name}
            author={n.author}
            description={n.description}
            updatedAt={n.updated_at}
          />
        ))}
      </div>

      {items.length === 0 && (
        <p className="mt-6 text-sm text-gray-500">
          没有匹配的节点。<Link href="/nodes" className="text-accent hover:underline">清除筛选</Link>
        </p>
      )}

      <div className="mt-6">
        <Pagination page={page} pageSize={pageSize} total={total} basePath="/nodes" />
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Verify in browser**

Run:
```bash
cd web && pnpm dev
```
Open http://localhost:3000/nodes. Expected: 3 cards in a list, pagination control absent (3 ≤ 20 default pageSize).

Open http://localhost:3000/nodes?q=impact. Expected: 1 card matching "Impact Pack".

Stop dev server.

- [ ] **Step 3: Commit**

```bash
git add web/app/\(public\)/nodes/page.tsx
git commit -m "feat(web): node list page with pagination and search"
```

---

## Task 18: Public UI — Node Detail Page

**Files:**
- Create: `web/app/(public)/nodes/[owner]/[repo]/page.tsx`

**Interfaces:**
- Produces: `/nodes/{owner}/{repo}` showing node metadata (name, author, description, owner/repo) and a table of versions linked to `/nodes/{owner}/{repo}/versions/{tag}`. 404 if node missing or `status='hidden'`. `revalidate = 300`.

- [ ] **Step 1: Create `web/app/(public)/nodes/[owner]/[repo]/page.tsx`**

```tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { formatDate } from '@/lib/format';

export const revalidate = 300;

type Params = { owner: string; repo: string };

export default async function NodeDetailPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { owner, repo } = await params;
  const node = await prisma.node.findUnique({
    where: { github_owner_github_repo: { github_owner: owner, github_repo: repo } },
    include: {
      versions: { orderBy: { release_date: 'desc' }, select: { version_tag: true, release_date: true } },
    },
  });
  if (!node || node.status === 'hidden') notFound();

  return (
    <main className="mx-auto max-w-4xl p-8">
      <Link href="/nodes" className="text-sm text-accent hover:underline">← 全部节点</Link>
      <h1 className="mt-2 text-3xl font-bold">{node.name}</h1>
      <div className="mt-1 text-sm text-gray-500">by {node.author}</div>
      <div className="mt-1 text-xs text-gray-400 font-mono">{node.github_owner}/{node.github_repo}</div>
      {node.description && <p className="mt-4 text-gray-700">{node.description}</p>}

      <h2 className="mt-8 text-xl font-semibold">版本</h2>
      <table className="mt-4 w-full text-sm">
        <thead className="border-b border-gray-200 text-left text-gray-500">
          <tr>
            <th className="py-2">标签</th>
            <th className="py-2">发布日期</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {node.versions.map((v) => (
            <tr key={v.version_tag} className="border-b border-gray-100">
              <td className="py-2 font-mono">{v.version_tag}</td>
              <td className="py-2">{formatDate(v.release_date)}</td>
              <td className="py-2 text-right">
                <Link
                  href={`/nodes/${node.github_owner}/${node.github_repo}/versions/${v.version_tag}`}
                  className="text-accent hover:underline"
                >
                  详情 →
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
```

- [ ] **Step 2: Verify in browser**

Run:
```bash
cd web && pnpm dev
```
Open http://localhost:3000/nodes/ltdrdata/ComfyUI-Impact-Pack. Expected: shows Impact Pack with 2 versions in a table.

Open http://localhost:3000/nodes/no/such-node. Expected: Next.js 404 page.

Stop dev server.

- [ ] **Step 3: Commit**

```bash
git add web/app/\(public\)/nodes/\[owner\]/\[repo\]/page.tsx
git commit -m "feat(web): node detail page with version table"
```

---

## Task 19: Public UI — Version Detail Page

**Files:**
- Create: `web/app/(public)/nodes/[owner]/[repo]/versions/[tag]/page.tsx`

**Interfaces:**
- Produces: `/nodes/{owner}/{repo}/versions/{tag}` showing the full `getPublishedRequirements` view: header with release date, Python range, `<DependencyTable>`, node class mappings list, incompatibilities list, and rendered notes_md (if any). 404 if version missing. `revalidate = 300`.

- [ ] **Step 1: Create `web/app/(public)/nodes/[owner]/[repo]/versions/[tag]/page.tsx`**

```tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { formatDate } from '@/lib/format';
import { getPublishedRequirements } from '@/lib/published';
import { DependencyTable } from '../../../_components/DependencyTable';

export const revalidate = 300;

type Params = { owner: string; repo: string; tag: string };

export default async function VersionDetailPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { owner, repo, tag } = await params;
  const version = await prisma.nodeVersion.findFirst({
    where: { version_tag: tag, node: { github_owner: owner, github_repo: repo } },
  });
  if (!version) notFound();

  const pub = await getPublishedRequirements(version.id);
  const node = await prisma.node.findUniqueOrThrow({
    where: { id: version.node_id },
    select: { name: true },
  });

  return (
    <main className="mx-auto max-w-4xl p-8">
      <Link href={`/nodes/${owner}/${repo}`} className="text-sm text-accent hover:underline">
        ← 返回 {node.name}
      </Link>
      <h1 className="mt-2 text-2xl font-bold font-mono">{tag}</h1>
      <div className="mt-1 text-sm text-gray-500">{formatDate(pub.release_date)} 发布</div>

      <section className="mt-6 rounded border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-700">Python 版本</h2>
        <p className="mt-2 font-mono text-sm">
          {pub.python_min ?? '—'} ≤ Python &lt; {pub.python_max ?? '（无上限）'}
        </p>
      </section>

      <section className="mt-6 rounded border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-700">依赖</h2>
        <div className="mt-2">
          <DependencyTable deps={pub.dependencies} />
        </div>
      </section>

      <section className="mt-6 rounded border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-700">节点类映射</h2>
        {pub.node_class_mappings.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">无</p>
        ) : (
          <ul className="mt-2 grid grid-cols-2 gap-1 text-sm font-mono">
            {pub.node_class_mappings.map((c) => <li key={c}>{c}</li>)}
          </ul>
        )}
      </section>

      <section className="mt-6 rounded border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-700">互斥节点</h2>
        {pub.incompatibilities.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">无</p>
        ) : (
          <ul className="mt-2 list-disc pl-5 text-sm">
            {pub.incompatibilities.map((i) => <li key={i} className="font-mono">{i}</li>)}
          </ul>
        )}
      </section>

      {pub.dependencies.length === 0 && pub.node_class_mappings.length === 0 && (
        <p className="mt-6 text-xs text-gray-400">
          该版本尚未被扫描器处理，<Link href="/nodes" className="text-accent hover:underline">查看其他节点</Link>。
        </p>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Verify in browser**

Run:
```bash
cd web && pnpm dev
```
Open http://localhost:3000/nodes/ltdrdata/ComfyUI-Impact-Pack/versions/v8.10. Expected: shows Python range, dependency table (torch + ultralytics), node class mappings, no incompatibilities.

Open http://localhost:3000/nodes/ltdrdata/ComfyUI-Impact-Pack/versions/v999. Expected: 404 page.

Stop dev server.

- [ ] **Step 3: Commit**

```bash
git add "web/app/(public)/nodes/[owner]/[repo]/versions/[tag]/page.tsx"
git commit -m "feat(web): version detail page with full published view"
```

---

## Task 20: README + Local Run Instructions

**Files:**
- Create: `README.md`

**Interfaces:**
- Produces: README explaining prerequisites, first-time setup, dev workflow, test workflow, project structure, and a pointer to `docs/superpowers/specs/`.

- [ ] **Step 1: Create `README.md`**

````markdown
# ComfyUI Node Wiki

公开的 ComfyUI 节点元数据 Wiki 服务。本仓库目前包含 **Plan 1：Foundation + Public Read-Only Wiki Site** 的实现。

完整设计规格：[`docs/superpowers/specs/2026-06-21-comfyui-node-wiki-design.md`](docs/superpowers/specs/2026-06-21-comfyui-node-wiki-design.md)。

## 先决条件

- Node.js 20 LTS
- pnpm 9
- Docker + Docker Compose

## 首次启动

```bash
# 1. 安装依赖
cd web && pnpm install

# 2. 复制环境变量
cp .env.example ../.env       # Linux/macOS
# Windows (Git Bash):
cp ../.env.example ../.env

# 3. 启动 MySQL + Redis
docker compose up -d mysql redis

# 4. 应用数据库迁移
pnpm prisma migrate dev

# 5. 灌入示例数据（3 个节点 / 4 个版本）
pnpm prisma:seed

# 6. 启动开发服务器
pnpm dev
```

打开 http://localhost:3000 应能看到首页（含 3 个种子节点）。

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
├── docker-compose.yml          # 本地 MySQL 8 + Redis 7
├── .env.example                # 环境变量样例
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
````

- [ ] **Step 2: Verify README renders correctly**

Run:
```bash
cd D:/ToolDevelop/ComfyUINodeAnalysis
ls README.md
```
Expected: file exists.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: README with local run and test instructions"
```

---

## Task 21: Manual Smoke Test (End-to-End)

This task is a checklist, not committed code. It verifies that all flows from Plan 1 work in a real browser.

**Files:** none (manual verification).

- [ ] **Step 1: Fresh database state**

Run:
```bash
cd web && pnpm prisma:reset
```
Expected: database is wiped, schema re-applied, seed re-inserted. Final log shows `{ nodes: 3, versions: 4, raw: 4 }`.

- [ ] **Step 2: Full test suite**

Run:
```bash
cd web && pnpm test
```
Expected: all suites pass (lib/format, lib/api-helpers, lib/published, api/nodes-list, api/node-detail, api/version-detail). Approximately 25 passing tests.

- [ ] **Step 3: TypeScript + lint**

Run:
```bash
cd web && pnpm exec tsc --noEmit && pnpm lint
```
Expected: no errors.

- [ ] **Step 4: Browser smoke test**

Run:
```bash
cd web && pnpm dev
```

Verify each page renders without error:

1. http://localhost:3000/ → home with stats (3 nodes / 4 versions) and 3 recent cards.
2. http://localhost:3000/nodes → list of 3 cards, no pagination.
3. http://localhost:3000/nodes?q=impact → exactly 1 card (Impact Pack).
4. http://localhost:3000/nodes/ltdrdata/ComfyUI-Impact-Pack → node detail with 2 versions.
5. http://localhost:3000/nodes/ltdrdata/ComfyUI-Impact-Pack/versions/v8.10 → version detail with Python range, dependency table, node class list.
6. http://localhost:3000/nodes/no/such → Next.js 404.
7. http://localhost:3000/nodes/ltdrdata/ComfyUI-Impact-Pack/versions/v999 → Next.js 404.

- [ ] **Step 5: Public API smoke test**

With `pnpm dev` still running, run:

```bash
curl -s http://localhost:3000/api/v1/nodes | head -c 200
curl -s http://localhost:3000/api/v1/nodes/ltdrdata/ComfyUI-Impact-Pack | head -c 200
curl -s http://localhost:3000/api/v1/nodes/ltdrdata/ComfyUI-Impact-Pack/versions/v8.10 | head -c 200
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/v1/nodes/no/such
```
Expected: first three return valid JSON with the expected fields; the last returns `404`.

Stop dev server.

- [ ] **Step 6: Plan 1 sign-off**

Confirm the following are all green:
- [ ] All Vitest suites pass.
- [ ] `tsc --noEmit` clean.
- [ ] `pnpm lint` clean.
- [ ] All 7 browser pages render.
- [ ] All 4 API endpoints return the expected shape / status.
- [ ] `git log` shows the commits from Tasks 1–20.

Plan 1 is complete when every box above is checked. Hand off to Plan 2 (Wiki editing flow) only after this checklist is green.

---

## Self-Review Notes (author's checklist)

**Spec coverage:**
- §4 数据模型 — covered by Task 3 (Prisma schema) + Task 4 (seed). All 6 tables defined.
- §5.1 公开 API — covered by Tasks 12–14. Note: `POST /api/v1/conflicts/check` is Plan 3.
- §8.1 公开浏览页 — covered by Tasks 16–19. `ConflictPreview` is Plan 3.
- §9 认证 — covered by Task 5 (NextAuth + user upsert + bootstrap admin). Admin role enforcement wired via `requireAdmin()` (Task 6) but no admin UI is in this plan (Plan 2/3).
- §12.1 功能验收 — partial: public browse + read API + login work. Wiki editing, admin review, scanner are in later plans.
- §12.2 性能验收 — SSR caching via `revalidate` is set on each page (60 s for list/home, 300 s for detail). No load testing in this plan.

**Out-of-scope but flagged for later plans:**
- `wiki_revisions.status='approved'` uniqueness per `version_id` (Plan 2 introduces the transaction).
- Conflict engine + `POST /api/v1/conflicts/check` (Plan 3).
- Python scanner + `cleanup_old_versions` (Plan 4).
- `scan_failures` table (Plan 4).
- Production deployment / monitoring (Plan 5).

**Type/identifier consistency:** All public types (`PublishedDependency`, `PublishedRequirements`, `CurrentUser`) are defined once in the task that introduces them and referenced by name in subsequent tasks. Route handler function signatures (`GET(request, { params })`) match Next.js 15's async `params` pattern.
