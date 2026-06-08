import fs from "fs/promises";
import path from "path";
import { buildExperimentMarkdown, markdownFileNameForRun } from "../../lib/experiments/experimentMarkdownReport.js";
import { generateAndStoreStudentProfile } from "../../sim/lib/learner/studentProfileStore.js";
import { getConditionOptions } from "./conditionOptions.js";
import { runTutorExperimentSession } from "./tutorOrchestrator.js";

function safeToken(value, fallback = "run") {
  return String(value || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || fallback;
}

function timestampToken(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function markdownValue(value) {
  if (value == null || value === "") {
    return "n/a";
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(Number(value.toFixed(4))) : "n/a";
  }
  return String(value).replace(/\|/g, "\\|");
}

function addDistribution(target, source = {}) {
  Object.entries(source || {}).forEach(([key, value]) => {
    target[key] = (target[key] || 0) + Number(value || 0);
  });
}

function distributionTable(title, distribution = {}) {
  const entries = Object.entries(distribution);
  if (entries.length === 0) {
    return [`## ${title}`, "", "No data recorded.", ""].join("\n");
  }

  const total = entries.reduce((sum, [_key, count]) => sum + Number(count || 0), 0);

  return [
    `## ${title}`,
    "",
    "| Action | Count | Percentage |",
    "| --- | ---: | ---: |",
    ...entries
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([label, count]) => {
        const percentage = total > 0 ? `${((Number(count) / total) * 100).toFixed(1)}%` : "0%";
        return `| ${markdownValue(label)} | ${markdownValue(count)} | ${percentage} |`;
      }),
    ""
  ].join("\n");
}

function buildBatchSummaryMarkdown({ batchId, manifest, completedOutputs }) {
  const totals = {
    turnsCompleted: 0,
    totalCorrectResponses: 0,
    totalIncorrectResponses: 0,
    completedSteps: 0,
    completedProblems: 0
  };
  const tutorActions = {};
  const studentActions = {};

  completedOutputs.forEach(({ summary, output }) => {
    const metadata = output.runMetadata || {};
    const metrics = output.summaryMetrics || {};

    totals.turnsCompleted += Number(metadata.turnsCompleted || 0);
    totals.totalCorrectResponses += Number(metrics.totalCorrectResponses || 0);
    totals.totalIncorrectResponses += Number(metrics.totalIncorrectResponses || 0);
    totals.completedSteps += Number(metrics.completedSteps || 0);
    totals.completedProblems += Number(metrics.completedProblems || 0);
    addDistribution(tutorActions, metrics.tutorActionDistribution);
    addDistribution(studentActions, metrics.studentActionDistribution);

    summary.summaryMetrics = {
      totalCorrectResponses: metrics.totalCorrectResponses || 0,
      totalIncorrectResponses: metrics.totalIncorrectResponses || 0,
      completedSteps: metrics.completedSteps || 0,
      completedProblems: metrics.completedProblems || 0
    };
  });

  return [
    "# Batch Experiment Summary",
    "",
    "## Batch Information",
    "",
    `- Batch ID: ${markdownValue(batchId)}`,
    `- Total runs requested: ${markdownValue(manifest.totalRuns)}`,
    `- Completed runs: ${markdownValue(manifest.completedRuns)}`,
    `- Failed runs: ${markdownValue(manifest.failedRuns)}`,
    `- Output folder: ${markdownValue(manifest.outputDir)}`,
    "",
    "## Combined Final Session Results",
    "",
    `- Total turns completed: ${markdownValue(totals.turnsCompleted)}`,
    `- Total correct responses: ${markdownValue(totals.totalCorrectResponses)}`,
    `- Total incorrect responses: ${markdownValue(totals.totalIncorrectResponses)}`,
    `- Total completed lesson steps: ${markdownValue(totals.completedSteps)}`,
    `- Total completed problems: ${markdownValue(totals.completedProblems)}`,
    "",
    "## Per-Run Results",
    "",
    "| Run | Status | Condition | Seed | Turns | Correct | Incorrect | Steps | Problems |",
    "| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...manifest.runs.map((run) => {
      const metrics = run.summaryMetrics || {};
      return [
        `| ${markdownValue(run.runIndex)}`,
        markdownValue(run.status),
        markdownValue(run.conditionId),
        markdownValue(run.seed),
        markdownValue(run.turnsCompleted || 0),
        markdownValue(metrics.totalCorrectResponses ?? run.totalCorrectResponses ?? 0),
        markdownValue(metrics.totalIncorrectResponses ?? run.totalIncorrectResponses ?? 0),
        markdownValue(metrics.completedSteps ?? run.completedSteps ?? 0),
        `${markdownValue(metrics.completedProblems ?? run.completedProblems ?? 0)} |`
      ].join(" | ");
    }),
    "",
    distributionTable("Combined Tutor Actions", tutorActions),
    distributionTable("Combined Student Actions", studentActions)
  ].join("\n");
}

export function normalizeSeedList(value) {
  if (Array.isArray(value)) {
    return value.map(Number).filter(Number.isFinite);
  }

  if (value == null || value === "") {
    return [];
  }

  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map(Number)
    .filter(Number.isFinite);
}

export function estimateBatchRunCount(config = {}) {
  if (Array.isArray(config.runs) && config.runs.length > 0) {
    return config.runs.length;
  }

  const conditionCount = Array.isArray(config.conditions) && config.conditions.length > 0
    ? config.conditions.length
    : 0;
  const seedCount = normalizeSeedList(config.seeds).length ||
    Math.max(Number(config.repetitions) || 1, 1);
  const replicates = Math.max(Number(config.replicates) || 1, 1);

  return conditionCount * seedCount * replicates;
}

async function resolveConditionIds(batchConfig) {
  if (Array.isArray(batchConfig.conditions) && batchConfig.conditions.length > 0) {
    return batchConfig.conditions;
  }

  return (await getConditionOptions()).map((condition) => condition.id);
}

function resolveSeeds(batchConfig) {
  const explicitSeeds = normalizeSeedList(batchConfig.seeds);
  if (explicitSeeds.length > 0) {
    return explicitSeeds;
  }

  const repetitions = Math.max(Number(batchConfig.repetitions) || 1, 1);
  const seed = Number.isFinite(Number(batchConfig.seedStart))
    ? Number(batchConfig.seedStart)
    : Number(batchConfig.seed ?? 17);

  return Array.from({ length: repetitions }, () => seed);
}

export async function buildBatchRunQueue(batchConfig = {}) {
  if (Array.isArray(batchConfig.runs) && batchConfig.runs.length > 0) {
    return batchConfig.runs.map((run, index) => ({
      runIndex: index + 1,
      ...run
    }));
  }

  const conditionIds = await resolveConditionIds(batchConfig);
  const seeds = resolveSeeds(batchConfig);
  const replicates = Math.max(Number(batchConfig.replicates) || 1, 1);

  return conditionIds.flatMap((conditionId) =>
    seeds.flatMap((seed) =>
      Array.from({ length: replicates }, (_item, replicateIndex) => ({
        conditionId,
        seed,
        replicate: replicateIndex + 1,
        maxTurns: batchConfig.maxTurns,
        lessonPlanId: batchConfig.lessonPlanId
      }))
    )
  ).map((run, index) => ({
    runIndex: index + 1,
    ...run
  }));
}

function createStudentId({ batchId, run }) {
  if (run.studentId) {
    return safeToken(run.studentId, "student");
  }

  const replicate = run.replicate ? `-r${run.replicate}` : "";
  const runIndex = run.runIndex ? `-run-${run.runIndex}` : "";
  return safeToken(`${batchId}-${run.conditionId}-seed-${run.seed}${replicate}${runIndex}`, "student");
}

function createRunConfig({ batchConfig, run, studentId }) {
  return {
    conditionId: run.conditionId,
    lessonPlanId: run.lessonPlanId ?? batchConfig.lessonPlanId,
    seed: Number.isFinite(Number(run.seed)) ? Number(run.seed) : Number(batchConfig.seed ?? 17),
    maxTurns: Number(run.maxTurns ?? batchConfig.maxTurns ?? 30),
    studentId,
    teacherRuntimeConfig: run.teacherRuntimeConfig ?? batchConfig.teacherRuntimeConfig,
    teacherMessageConfig: run.teacherMessageConfig ?? batchConfig.teacherMessageConfig,
    learnerRuntimeConfig: run.learnerRuntimeConfig ?? batchConfig.learnerRuntimeConfig,
    exposeHiddenTaskToStudent: Boolean(run.exposeHiddenTaskToStudent ?? batchConfig.exposeHiddenTaskToStudent)
  };
}

function summarizeRunResult({ run, result, markdownPath }) {
  const metadata = result.experimenterOutput?.runMetadata || {};
  const metrics = result.experimenterOutput?.summaryMetrics || {};

  return {
    runIndex: run.runIndex,
    status: "complete",
    runId: result.runId,
    conditionId: metadata.condition,
    seed: metadata.profileGenerationSeed ?? result.config?.seed ?? run.seed,
    studentId: metadata.studentId,
    turnsCompleted: metadata.turnsCompleted,
    totalCorrectResponses: metrics.totalCorrectResponses,
    totalIncorrectResponses: metrics.totalIncorrectResponses,
    completedSteps: metrics.completedSteps,
    completedProblems: metrics.completedProblems,
    markdownPath
  };
}

async function runOneBatchExperiment({
  batchConfig,
  batchId,
  outputDir,
  run,
  includeArtifacts = false,
  generateStudentProfile = generateAndStoreStudentProfile,
  runExperimentSession = runTutorExperimentSession
}) {
  const studentId = createStudentId({ batchId, run });
  const runConfig = createRunConfig({ batchConfig, run, studentId });

  await generateStudentProfile({
    seed: runConfig.seed,
    studentId,
    conditionId: runConfig.conditionId
  });

  const result = await runExperimentSession(runConfig);
  const markdown = buildExperimentMarkdown(result.experimenterOutput);
  const markdownFileName = markdownFileNameForRun(result.runId);
  const markdownPath = path.join(outputDir, markdownFileName);

  await fs.writeFile(markdownPath, `${markdown}\n`, "utf8");

  return {
    summary: summarizeRunResult({ run, result, markdownPath }),
    output: result.experimenterOutput,
    artifact: includeArtifacts
      ? {
          runIndex: run.runIndex,
          runId: result.runId,
          conditionId: result.config?.conditionId,
          seed: result.config?.seed,
          studentId: result.config?.studentId,
          transcript: result.transcript,
          markdown,
          markdownFileName,
          markdownPath
        }
      : null
  };
}

export async function executeBatchExperimentRuns(batchConfig = {}, options = {}) {
  const rootDir = options.rootDir || process.cwd();
  const batchId = safeToken(batchConfig.batchId || `batch-${timestampToken()}`, "batch");
  const outputDir = path.resolve(
    rootDir,
    batchConfig.outputDir || path.join("batch_results", batchId)
  );
  const queue = await buildBatchRunQueue(batchConfig);
  const manifest = {
    batchId,
    startedAt: new Date().toISOString(),
    outputDir,
    totalRuns: queue.length,
    runs: []
  };
  const completedOutputs = [];
  const artifacts = options.includeArtifacts ? { runs: [] } : null;

  await fs.mkdir(outputDir, { recursive: true });

  for (const run of queue) {
    if (options.onProgress) {
      options.onProgress({ type: "start", run, totalRuns: queue.length });
    }

    try {
      const { summary, output, artifact } = await runOneBatchExperiment({
        batchConfig,
        batchId,
        outputDir,
        run,
        includeArtifacts: Boolean(options.includeArtifacts),
        generateStudentProfile: options.generateStudentProfile,
        runExperimentSession: options.runExperimentSession
      });
      manifest.runs.push(summary);
      completedOutputs.push({ summary, output });
      if (artifact) {
        artifacts.runs.push(artifact);
      }
      if (options.onProgress) {
        options.onProgress({
          type: "complete",
          run,
          totalRuns: queue.length,
          summary,
          artifact
        });
      }
    } catch (error) {
      const failure = {
        runIndex: run.runIndex,
        status: "failed",
        conditionId: run.conditionId,
        seed: run.seed,
        message: error?.message || "Unknown batch run failure",
        details: error?.experimenter_debug_log || error?.safeDetails || null
      };
      const failurePath = path.join(outputDir, `run-${run.runIndex}-error.json`);

      manifest.runs.push({ ...failure, failurePath });
      await fs.writeFile(failurePath, `${JSON.stringify(failure, null, 2)}\n`, "utf8");
      if (options.onProgress) {
        options.onProgress({ type: "failed", run, totalRuns: queue.length, failure });
      }
    }
  }

  manifest.completedAt = new Date().toISOString();
  manifest.completedRuns = manifest.runs.filter((run) => run.status === "complete").length;
  manifest.failedRuns = manifest.runs.filter((run) => run.status === "failed").length;
  const summaryMarkdown = buildBatchSummaryMarkdown({ batchId, manifest, completedOutputs });
  const summaryMarkdownFileName = `${batchId}-summary.md`;
  manifest.summaryMarkdownPath = path.join(outputDir, summaryMarkdownFileName);
  manifest.manifestPath = path.join(outputDir, "manifest.json");

  await fs.writeFile(manifest.summaryMarkdownPath, `${summaryMarkdown}\n`, "utf8");
  await fs.writeFile(manifest.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  if (artifacts) {
    artifacts.summary = {
      markdown: summaryMarkdown,
      markdownFileName: summaryMarkdownFileName,
      markdownPath: manifest.summaryMarkdownPath
    };
    manifest.artifacts = artifacts;
  }

  return manifest;
}
