import path from "node:path";

export const FIT_COACH_DIR = path.resolve(
  process.env.FIT_COACH_DIR ?? path.join(import.meta.dirname, "..", "..", "..", "fit-coach"),
);
