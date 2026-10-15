import type { ReasoningEffort } from "@/lib/ai/aiCredentials";
import { ensureDay } from "@/lib/data/days";
import { dayConfig, shiftDay, todayLogicalDay } from "@/lib/dates";
import { runAsUser } from "@/lib/db/context";

import { mealsOn, type MealRow } from "./capture/writeChanges";
import type { CoachEngine } from "./engine/coachEngine";
import { deleteEvalUser } from "./fixtures/cleanup";
import { createEvalUser, findCatalogEntry, seedMeals, type EvalSource, type EvalUser } from "./fixtures/syntheticUser";
import { gradeTurn, turnPassed, unrequestedWriteCount, type TurnObservation } from "./grade/graders";
import { appNoticeFired, stripAppText } from "./grade/replyText";
import { domainChanges, memoryChanges } from "./grade/writes";
import type { ScenarioRecord, TurnRecord } from "./report/records";
import { summarizeWrite } from "./report/writeSummary";
import type { Scenario, ScenarioTurn } from "./scenarios/types";

export interface ScenarioRun {
  engine: CoachEngine;
  source: EvalSource;
  runId: string;
  userNumber: number;
  model: string;
  effort: ReasoningEffort;
  apiKey: string;
  rep: number;
}

interface DayBaseline {
  today: string;
  autoMeals: MealRow[];
}

async function prepareDay(user: EvalUser): Promise<DayBaseline> {
  const today = todayLogicalDay(dayConfig(user.profile));
  await runAsUser(user.userId, "app", () => ensureDay(user.userId, user.profile, today));
  return { today, autoMeals: await mealsOn(user.userId, today) };
}

async function runTurn(run: ScenarioRun, scenario: Scenario, user: EvalUser, turn: ScenarioTurn, index: number, day: DayBaseline): Promise<TurnRecord> {
  const output = await run.engine.reply({ userId: user.userId, profile: user.profile, message: turn.user });
  const toolNames = [
    ...new Set([
      ...output.toolCalls.map((call) => call.name),
      ...output.events.flatMap((event) => (event.type === "status" ? [event.tool] : [])),
    ]),
  ];
  const meals = await mealsOn(user.userId, day.today);
  const autoIds = new Set(day.autoMeals.map((meal) => meal.id));
  const observation: TurnObservation = {
    expect: turn.expect,
    lang: scenario.lang,
    fullText: output.text,
    modelText: stripAppText(output.text),
    writes: output.writes,
    toolNames,
    mealsToday: meals.filter((meal) => !autoIds.has(meal.id)),
    missingAutoMeals: day.autoMeals.filter((meal) => !meals.some((row) => row.id === meal.id)).map((meal) => meal.name),
    resolveItem: (expectation) =>
      expectation.item ? findCatalogEntry(user.catalog, expectation.item.name, expectation.item.place) : undefined,
    engineError: output.error,
  };
  const grades = gradeTurn(observation);
  return {
    index,
    user: turn.user,
    text: output.text,
    toolNames,
    toolCalls: output.toolCalls,
    domainWrites: domainChanges(output.writes).map(summarizeWrite),
    memoryWrites: memoryChanges(output.writes).map(summarizeWrite),
    grades,
    passed: turnPassed(grades, turn.expect),
    unrequestedWrites: unrequestedWriteCount(observation),
    appNotice: appNoticeFired(output.text),
    approved: output.approved,
    latencyMs: Math.round(output.latencyMs),
    usage: output.usage,
    providerErrors: output.providerErrors,
    error: output.error,
  };
}

export async function runScenario(run: ScenarioRun, scenario: Scenario): Promise<ScenarioRecord> {
  const user = await createEvalUser(run.source, run.runId, run.userNumber, run.model, run.effort, run.apiKey);
  const turns: TurnRecord[] = [];
  try {
    const day = await prepareDay(user);
    if (scenario.seed?.meals) await seedMeals(user, scenario.seed.meals, (offset) => shiftDay(day.today, offset));
    for (const [index, turn] of scenario.turns.entries()) {
      turns.push(await runTurn(run, scenario, user, turn, index, day));
    }
  } finally {
    await deleteEvalUser(user.userId);
  }
  return {
    runId: run.runId,
    model: run.model,
    engine: run.engine.name,
    scenarioId: scenario.id,
    job: scenario.job,
    lang: scenario.lang,
    rep: run.rep,
    passed: turns.length === scenario.turns.length && turns.every((turn) => turn.passed),
    turns,
  };
}
