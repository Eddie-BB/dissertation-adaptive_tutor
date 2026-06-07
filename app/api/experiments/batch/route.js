import { NextResponse } from "next/server";
import {
  estimateBatchRunCount,
  executeBatchExperimentRuns
} from "../../../../src/server/experiments/batchRunner.js";
import { createExperimentError, toErrorResponse } from "../../../../src/server/errors/experimentErrors.js";

const MAX_FRONTEND_BATCH_RUNS = 30;

async function readRequestJson(request) {
  try {
    return await request.json();
  } catch (error) {
    throw createExperimentError("INVALID_REQUEST_BODY", { cause: error });
  }
}

export async function POST(request) {
  try {
    const config = await readRequestJson(request);
    const totalRuns = estimateBatchRunCount(config);

    if (totalRuns < 1) {
      return NextResponse.json(
        {
          ok: false,
          errorCode: "BATCH_EMPTY",
          message: "Select at least one condition and one seed before running a batch."
        },
        { status: 400 }
      );
    }

    if (totalRuns > MAX_FRONTEND_BATCH_RUNS) {
      return NextResponse.json(
        {
          ok: false,
          errorCode: "BATCH_TOO_LARGE",
          message: `Frontend batch runs are capped at ${MAX_FRONTEND_BATCH_RUNS}. Reduce the number of runs.`
        },
        { status: 400 }
      );
    }

    const manifest = await executeBatchExperimentRuns(config, { includeArtifacts: true });
    return NextResponse.json({ ok: true, manifest });
  } catch (error) {
    const response = toErrorResponse(error, "EXPERIMENT_RUN_FAILED");
    return NextResponse.json(response.body, { status: response.status });
  }
}
