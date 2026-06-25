// STUB: Plan 3 will replace this body with a real PEP 440 conflict
// detection algorithm. The exported types and async signature are the
// stable contract that Task 11 (HTTP route) and Task 18 (UI) will
// consume. Do not change the function signature without coordinating
// with those tasks.

export type ConflictCheckRequest = {
  installed: Array<{ owner: string; repo: string; version_tag: string }>;
};

export type Conflict = {
  type: string;
  severity: 'error' | 'warning';
  nodes: string[];
  detail: string;
};

export async function checkConflicts(_req: ConflictCheckRequest): Promise<Conflict[]> {
  return [];
}
