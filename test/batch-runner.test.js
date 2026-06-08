import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildBatchRunQueue,
  executeBatchExperimentRuns
} from "../src/server/experiments/batchRunner.js";

function createExperimentResult(config) {
  const runId = `run-${config.conditionId}-${config.studentId}-${config.seed}`;

  return {
    status: "complete",
    runId,
    config,
    transcript: [],
    experimenterOutput: {
      runMetadata: {
        runId,
        condition: config.conditionId,
        turnsCompleted: 1,
        studentId: config.studentId,
        profileGenerationSeed: config.seed,
        behaviourSamplingSeed: null,
        behaviourSamplingMode: "runtime Math.random() cumulative probability sampling",
        seedExplanation: "test seed"
      },
      summaryMetrics: {
        totalCorrectResponses: 1,
        totalIncorrectResponses: 0,
        completedSteps: 1,
        completedProblems: 1,
        tutorActionDistribution: {
          ACTION_CONTINUE_STANDARD: 1
        },
        studentActionDistribution: {
          ENGAGED_ATTEMPT: 1
        }
      },
      lesson: {
        problemCount: 1,
        stepCount: 1
      },
      turnSummaries: []
    }
  };
}

test("batch queue repeats the configured seed for requested UI repetitions", async () => {
  const queue = await buildBatchRunQueue({
    conditions: ["baseline"],
    seedStart: 17,
    repetitions: 5,
    maxTurns: 4,
    lessonPlanId: "lesson"
  });

  assert.deepEqual(
    queue.map((run) => ({ runIndex: run.runIndex, conditionId: run.conditionId, seed: run.seed })),
    [
      { runIndex: 1, conditionId: "baseline", seed: 17 },
      { runIndex: 2, conditionId: "baseline", seed: 17 },
      { runIndex: 3, conditionId: "baseline", seed: 17 },
      { runIndex: 4, conditionId: "baseline", seed: 17 },
      { runIndex: 5, conditionId: "baseline", seed: 17 }
    ]
  );
});

test("batch runner emits each completed markdown artifact before final summary", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "batch-runner-"));
  const events = [];

  const manifest = await executeBatchExperimentRuns(
    {
      batchId: "test-batch",
      outputDir: "results",
      conditions: ["baseline"],
      seedStart: 17,
      repetitions: 3,
      maxTurns: 1,
      lessonPlanId: "lesson"
    },
    {
      rootDir,
      includeArtifacts: true,
      async generateStudentProfile() {},
      async runExperimentSession(config) {
        return createExperimentResult(config);
      },
      onProgress(event) {
        events.push(event);
      }
    }
  );

  const completedEvents = events.filter((event) => event.type === "complete");

  assert.equal(manifest.totalRuns, 3);
  assert.equal(manifest.completedRuns, 3);
  assert.equal(manifest.failedRuns, 0);
  assert.equal(completedEvents.length, 3);
  assert.ok(completedEvents.every((event) => event.artifact?.markdown?.includes("# Experimenter Session Report")));
  assert.ok(manifest.artifacts.summary.markdown.includes("# Batch Experiment Summary"));
  assert.equal((await fs.readdir(path.join(rootDir, "results"))).filter((file) => file.endsWith(".md")).length, 4);
});
