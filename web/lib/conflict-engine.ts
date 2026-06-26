import { prisma } from './db';
import { getPublishedRequirements } from './published';
import { intersectRanges, parseSpec, rangesOverlap } from './pep440-utils';
import type { PublishedDependency } from './published';

export type ConflictCheckRequest = {
  installed: Array<{ owner: string; repo: string; version_tag: string }>;
  draft?: ConflictDraftData;
};

export type Conflict =
  | { type: 'python_version'; severity: 'error'; nodes: string[]; detail: string }
  | { type: 'package_version'; severity: 'error' | 'warning'; nodes: string[]; detail: string; package: string }
  | { type: 'node_class'; severity: 'error'; nodes: string[]; detail: string; className: string }
  | { type: 'incompatibility'; severity: 'warning'; nodes: string[]; detail: string };

export type ConflictNodeData = {
  label: string;
  python_min: string | null;
  python_max: string | null;
  dependencies: PublishedDependency[];
  node_class_mappings: string[];
  incompatibilities: string[];
};

export type ConflictDraftData = {
  python_min?: string | null;
  python_max?: string | null;
  dependencies: PublishedDependency[];
  node_class_mappings: string[];
  incompatibilities: string[];
};

export async function checkConflicts(req: ConflictCheckRequest): Promise<Conflict[]> {
  return checkConflictsWithDraft(req.installed, req.draft);
}

export async function checkConflictsWithDraft(
  installed: ConflictCheckRequest['installed'],
  draft?: ConflictDraftData,
): Promise<Conflict[]> {
  // Load all installed versions in parallel
  const loaded = await Promise.all(
    installed.map(async (ref) => {
      const version = await prisma.nodeVersion.findFirst({
        where: { version_tag: ref.version_tag, node: { github_owner: ref.owner, github_repo: ref.repo } },
      });
      if (!version) {
        console.warn(`[conflict-engine] installed ref not found: ${ref.owner}/${ref.repo}@${ref.version_tag}`);
        return null;
      }
      const pub = await getPublishedRequirements(Number(version.id));
      return {
        label: `${ref.owner}/${ref.repo}@${ref.version_tag}`,
        python_min: pub.python_min,
        python_max: pub.python_max,
        dependencies: pub.dependencies,
        node_class_mappings: pub.node_class_mappings,
        incompatibilities: pub.incompatibilities,
      };
    }),
  );
  const data: ConflictNodeData[] = loaded.filter((x): x is ConflictNodeData => x !== null);
  // Apply draft as virtual node
  if (draft) {
    data.push({
      label: '<draft>',
      python_min: draft.python_min ?? null,
      python_max: draft.python_max ?? null,
      dependencies: draft.dependencies,
      node_class_mappings: draft.node_class_mappings,
      incompatibilities: draft.incompatibilities,
    });
  }
  // Run all 4 detectors
  const conflicts: Conflict[] = [
    ...detectPythonVersionConflicts(data),
    ...detectPackageVersionConflicts(data),
    ...detectNodeClassConflicts(data),
    ...detectIncompatibilityConflicts(data),
  ];
  // Sort for determinism
  conflicts.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return conflicts;
}

export function detectPythonVersionConflicts(nodes: ConflictNodeData[]): Conflict[] {
  const out: Conflict[] = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      const overlap = rangesOverlap(
        { min: a.python_min, max: a.python_max },
        { min: b.python_min, max: b.python_max },
      );
      if (!overlap) {
        out.push({
          type: 'python_version',
          severity: 'error',
          nodes: [a.label, b.label],
          detail: `Python 版本不兼容：${a.label} 要求 ${a.python_min ?? '无下限'}–${a.python_max ?? '无上限'}，与 ${b.label} 的 ${b.python_min ?? '无下限'}–${b.python_max ?? '无上限'} 无交集`,
        });
      }
    }
  }
  return out;
}

export function detectPackageVersionConflicts(nodes: ConflictNodeData[]): Conflict[] {
  const out: Conflict[] = [];
  const byName = new Map<string, Array<{ node: ConflictNodeData; dep: PublishedDependency }>>();
  for (const node of nodes) {
    for (const dep of node.dependencies) {
      if (!byName.has(dep.name)) byName.set(dep.name, []);
      byName.get(dep.name)!.push({ node, dep });
    }
  }
  for (const [name, entries] of byName) {
    if (entries.length < 2) continue;
    const specs = entries.map((e) => e.dep.spec);
    const intersection = intersectRanges(specs);
    if (intersection) continue; // no conflict
    // Intersection is empty → conflict
    const labels = entries.map((e) => e.node.label);
    const isPinned = entries.some((e) => parseSpec(e.dep.spec).isPinned);
    out.push({
      type: 'package_version',
      severity: isPinned ? 'error' : 'warning',
      nodes: labels,
      detail: `包 ${name} 版本不兼容：${entries.map((e) => `${e.node.label}=${e.dep.spec}`).join(' vs ')}`,
      package: name,
    });
  }
  return out;
}

export function detectNodeClassConflicts(nodes: ConflictNodeData[]): Conflict[] {
  const out: Conflict[] = [];
  const byClass = new Map<string, string[]>();
  for (const node of nodes) {
    for (const cls of node.node_class_mappings) {
      if (!byClass.has(cls)) byClass.set(cls, []);
      byClass.get(cls)!.push(node.label);
    }
  }
  for (const [cls, labels] of byClass) {
    if (labels.length < 2) continue;
    out.push({
      type: 'node_class',
      severity: 'error',
      nodes: labels,
      detail: `节点类 ${cls} 被多个节点声明：${labels.join(', ')}`,
      className: cls,
    });
  }
  return out;
}

export function detectIncompatibilityConflicts(nodes: ConflictNodeData[]): Conflict[] {
  const out: Conflict[] = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      const aExcludesB = a.incompatibilities.some((s) => matchesRef(s, b.label));
      const bExcludesA = b.incompatibilities.some((s) => matchesRef(s, a.label));
      if (aExcludesB || bExcludesA) {
        out.push({
          type: 'incompatibility',
          severity: 'warning',
          nodes: [a.label, b.label],
          detail: `${a.label} 与 ${b.label} 互相声明不兼容`,
        });
      }
    }
  }
  return out;
}

function matchesRef(ref: string, label: string): boolean {
  // label format: "owner/repo@tag". ref format: "owner/repo" (per spec).
  return ref === label.split('@')[0];
}
