import { wrapLanguageModel, type LanguageModel } from "ai";
import type {
  LanguageModelV4CallOptions,
  LanguageModelV4Content,
  LanguageModelV4GenerateResult,
  LanguageModelV4Middleware,
  LanguageModelV4StreamPart,
  LanguageModelV4StreamResult,
} from "@ai-sdk/provider";

export const CORRUPT_SUFFIX = "<|channel|>commentary";

export interface CorruptionLog {
  hits: number;
}

function corruptName(
  name: string,
  target: string,
  log: CorruptionLog,
  counts = true,
): string {
  if (name !== target) return name;
  if (counts) log.hits += 1;
  return `${name}${CORRUPT_SUFFIX}`;
}

function corruptContent(
  content: LanguageModelV4Content[],
  target: string,
  log: CorruptionLog,
): LanguageModelV4Content[] {
  return content.map((part) =>
    part.type === "tool-call"
      ? { ...part, toolName: corruptName(part.toolName, target, log) }
      : part,
  );
}

function corruptPart(
  part: LanguageModelV4StreamPart,
  target: string,
  log: CorruptionLog,
): LanguageModelV4StreamPart {
  if (part.type === "tool-call") {
    return { ...part, toolName: corruptName(part.toolName, target, log) };
  }
  if (part.type === "tool-input-start") {
    return { ...part, toolName: corruptName(part.toolName, target, log, false) };
  }
  return part;
}

export function corruptingModel(
  model: LanguageModel,
  target: string,
  log: CorruptionLog,
): LanguageModel {
  const middleware: LanguageModelV4Middleware = {
    specificationVersion: "v4",
    async wrapGenerate({
      doGenerate,
    }: {
      doGenerate: () => PromiseLike<LanguageModelV4GenerateResult>;
      params: LanguageModelV4CallOptions;
    }): Promise<LanguageModelV4GenerateResult> {
      const result = await doGenerate();
      return { ...result, content: corruptContent(result.content, target, log) };
    },
    async wrapStream({
      doStream,
    }: {
      doStream: () => PromiseLike<LanguageModelV4StreamResult>;
      params: LanguageModelV4CallOptions;
    }): Promise<LanguageModelV4StreamResult> {
      const result = await doStream();
      return {
        ...result,
        stream: result.stream.pipeThrough(
          new TransformStream<LanguageModelV4StreamPart, LanguageModelV4StreamPart>({
            transform(part, controller) {
              controller.enqueue(corruptPart(part, target, log));
            },
          }),
        ),
      };
    },
  };

  if (typeof model === "string") {
    throw new Error("corruptingModel needs a resolved model instance, not an id");
  }

  return wrapLanguageModel({
    model,
    middleware: middleware as Parameters<typeof wrapLanguageModel>[0]["middleware"],
  });
}
