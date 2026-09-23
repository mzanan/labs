export interface Planted {
  id: string;
  category: string;
  file: string;
  line_start: number;
  line_end: number;
  match_start: number;
  match_end: number;
  summary: string;
}

export interface Finding {
  file: string;
  line: number;
  category: string;
  severity: string;
  title: string;
  evidence: string;
}

export interface Graded {
  found: string[];
  missed: string[];
  matched: { finding: Finding; planted: string }[];
  unmatched: Finding[];
  recall: number;
  precision: number;
}

function normalizePath(path: string): string {
  return path.replace(/^\.?\/?/, "").replace(/^fixture\//, "").trim();
}

export function grade(planted: Planted[], findings: Finding[]): Graded {
  const matched: { finding: Finding; planted: string }[] = [];
  const unmatched: Finding[] = [];
  const hit = new Set<string>();
  for (const finding of findings) {
    const file = normalizePath(finding.file);
    const target = planted.find(
      (p) =>
        !hit.has(p.id) &&
        p.file === file &&
        finding.line >= p.match_start &&
        finding.line <= p.match_end,
    );
    if (target) {
      hit.add(target.id);
      matched.push({ finding, planted: target.id });
      continue;
    }
    const duplicate = planted.some(
      (p) => hit.has(p.id) && p.file === file && finding.line >= p.match_start && finding.line <= p.match_end,
    );
    if (!duplicate) unmatched.push(finding);
  }
  return {
    found: [...hit].sort(),
    missed: planted.map((p) => p.id).filter((id) => !hit.has(id)),
    matched,
    unmatched,
    recall: hit.size / planted.length,
    precision: matched.length / (matched.length + unmatched.length || 1),
  };
}
