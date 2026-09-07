import { gzipSync } from "node:zlib";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { build } from "esbuild";

export interface BundleCandidate {
  readonly id: string;
  readonly note: string;
  readonly entry: readonly string[];
}

export interface BundleMeasurement {
  readonly id: string;
  readonly minifiedBytes: number;
  readonly gzipBytes: number;
}

export async function measureBundle(
  candidate: BundleCandidate,
  shader: readonly string[],
  resolveDir: string,
): Promise<BundleMeasurement> {
  const dir = mkdtempSync(join(tmpdir(), `bundle-${candidate.id}-`));
  const entryPath = join(dir, "entry.js");
  const source = [`const SHADER = ${JSON.stringify(shader.join("\n"))};`, ...candidate.entry].join("\n");

  try {
    writeFileSync(entryPath, source, "utf8");
    const result = await build({
      entryPoints: [entryPath],
      bundle: true,
      minify: true,
      format: "esm",
      platform: "browser",
      target: "es2022",
      write: false,
      absWorkingDir: resolveDir,
      nodePaths: [join(resolveDir, "node_modules")],
    });

    const output = result.outputFiles[0].contents;
    return {
      id: candidate.id,
      minifiedBytes: output.byteLength,
      gzipBytes: gzipSync(output).byteLength,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
