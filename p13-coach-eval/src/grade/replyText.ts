import type { Lang } from "../scenarios/types";

const APP_LINE = /^(Logged |Rule "|Closed the day:|Targets set:|\(Not in your catalog: |Heads up: this model cannot use)/;

const APP_NOTICE = /^Nothing was logged\. The coach said it did.*$/m;

const GENERIC_ERRORS = [
  /could not reach your AI model/i,
  /request came back malformed/i,
  /Nothing was read or written\./,
  /This answer was interrupted\./,
  /stopped before an answer began/i,
  /may or may not have been written/i,
  /coach turns per hour/i,
];

const CLAIM_ES =
  /(?<!\bno\s)(?<!\p{L})(registré|anoté|guardé|agregué|cargué|sumé)(?!\p{L})|(?:^|[.!¡\n]\s*)(listo|registrad[oa]s?|anotad[oa]s?|guardad[oa]s?|agregad[oa]s?|cargad[oa]s?)(?!\p{L})(?![^.\n]*\?)/iu;

const CLAIM_EN =
  /(?<!\p{L})I(?:'ve| have)?\s+(?:just\s+)?(logged|saved|added|recorded|noted)(?!\p{L})|(?:^|[.!\n]\s*)(logged|saved|added|done)(?!\p{L})(?![^.\n]*\?)/iu;

const ES_MARKERS =
  /(?<!\p{L})(que|de|el|la|los|las|para|con|tu|tus|te|hoy|queda|quedan|por|una|es|y|más|día|comida|cena|podés|tenés|vas|está|son|sin|como|pero|lo|del|al)(?!\p{L})/giu;

const EN_MARKERS =
  /(?<!\p{L})(the|you|your|and|of|to|is|for|with|today|left|have|has|are|this|that|it|on|can|meal|dinner|protein|remaining)(?!\p{L})/giu;

export function stripAppText(text: string): string {
  return text
    .replace(APP_NOTICE, "")
    .split("\n")
    .filter((line) => !APP_LINE.test(line.trim()))
    .join("\n")
    .trim();
}

export function appNoticeFired(text: string): boolean {
  return APP_NOTICE.test(text);
}

export function isGenericError(text: string): boolean {
  return !text.trim() || GENERIC_ERRORS.some((pattern) => pattern.test(text));
}

export function claimsSave(text: string): boolean {
  return CLAIM_ES.test(text) || CLAIM_EN.test(text);
}

export function detectLanguage(text: string): Lang | null {
  const es = (text.match(ES_MARKERS)?.length ?? 0) + (text.match(/[ñ¿¡áéíóú]/giu)?.length ?? 0);
  const en = text.match(EN_MARKERS)?.length ?? 0;
  if (es + en < 3) return null;
  return es >= en ? "es" : "en";
}
