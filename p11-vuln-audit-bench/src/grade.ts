export interface Planted {
  id: string;
  category: string;
  file: string;
  line_start: number;
  line_end: number;
  match_ranges: [number, number][];
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
  duplicates: { finding: Finding; planted: string }[];
  unmatched: Finding[];
  recall: number;
  precision: number;
}

function normalizePath(path: string): string {
  return path.replace(/^\.?\/?/, "").replace(/^fixture\//, "").trim();
}

function covers(plant: Planted, file: string, line: number): boolean {
  return plant.file === file && plant.match_ranges.some(([start, end]) => line >= start && line <= end);
}

export function grade(planted: Planted[], findings: Finding[]): Graded {
  const matched: { finding: Finding; planted: string }[] = [];
  const duplicates: { finding: Finding; planted: string }[] = [];
  const unmatched: Finding[] = [];
  const hit = new Set<string>();
  for (const finding of findings) {
    const file = normalizePath(finding.file);
    const plants = planted.filter((p) => covers(p, file, finding.line));
    const fresh = plants.find((p) => !hit.has(p.id));
    if (fresh) {
      hit.add(fresh.id);
      matched.push({ finding, planted: fresh.id });
    } else if (plants.length) {
      duplicates.push({ finding, planted: plants[0].id });
    } else {
      unmatched.push(finding);
    }
  }
  return {
    found: [...hit].sort(),
    missed: planted.map((p) => p.id).filter((id) => !hit.has(id)),
    matched,
    duplicates,
    unmatched,
    recall: hit.size / planted.length,
    precision: matched.length / (matched.length + unmatched.length || 1),
  };
}
