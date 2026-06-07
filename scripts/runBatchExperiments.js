import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { executeBatchExperimentRuns } from "../src/server/experiments/batchRunner.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) {
      continue;
    }

    const [rawKey, inlineValue] = item.slice(2).split("=", 2);
    const key = rawKey.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
    const nextValue = inlineValue ?? argv[index + 1];

    if (inlineValue == null && nextValue && !nextValue.startsWith("--")) {
      index += 1;
      args[key] = nextValue;
    } else {
      args[key] = inlineValue ?? true;
    }
  }

  return args;
}

async function readJsonFile(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function loadEnvFile(filePath) {
  let raw;

  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return;
    }
    throw error;
  }

  raw.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      return;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    const value = rawValue.replace(/^(['"])(.*)\1$/, "$2");

    if (key && process.env[key] == null) {
      process.env[key] = value;
    }
  });
}

function splitList(value) {
  if (value == null || value === true) {
    return [];
  }

  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function applyCliOverrides(config, args) {
  const nextConfig = { ...config };
  const conditions = splitList(args.conditions);
  const seeds = splitList(args.seeds).map(Number).filter(Number.isFinite);

  if (conditions.length > 0) nextConfig.conditions = conditions;
  if (seeds.length > 0) nextConfig.seeds = seeds;
  if (args.maxTurns != null && args.maxTurns !== true) nextConfig.maxTurns = Number(args.maxTurns);
  if (args.replicates != null && args.replicates !== true) nextConfig.replicates = Number(args.replicates);
  if (args.repetitions != null && args.repetitions !== true) nextConfig.repetitions = Number(args.repetitions);
  if (args.seedStart != null && args.seedStart !== true) nextConfig.seedStart = Number(args.seedStart);
  if (args.batchId != null && args.batchId !== true) nextConfig.batchId = args.batchId;
  if (args.outputDir != null && args.outputDir !== true) nextConfig.outputDir = args.outputDir;

  return nextConfig;
}

async function loadBatchConfig(args) {
  const fileConfig = args.config
    ? await readJsonFile(path.resolve(ROOT_DIR, args.config))
    : {};

  return applyCliOverrides(fileConfig, args);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await loadEnvFile(path.join(ROOT_DIR, ".env"));

  const manifest = await executeBatchExperimentRuns(await loadBatchConfig(args), {
    rootDir: ROOT_DIR,
    onProgress(event) {
      if (event.type === "start") {
        process.stdout.write(
          `[${event.run.runIndex}/${event.totalRuns}] ${event.run.conditionId} seed=${event.run.seed}... `
        );
      }
      if (event.type === "complete") {
        process.stdout.write(`wrote ${path.basename(event.summary.markdownPath)}\n`);
      }
      if (event.type === "failed") {
        process.stdout.write("failed\n");
      }
    }
  });

  process.stdout.write(`Batch complete: ${manifest.completedRuns}/${manifest.totalRuns} completed\n`);
  process.stdout.write(`Manifest: ${manifest.manifestPath}\n`);

  if (manifest.failedRuns > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
