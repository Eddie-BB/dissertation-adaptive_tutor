import { NextResponse } from "next/server";
import { runTutorExperimentSession } from "../../../../src/server/experiments/tutorOrchestrator.js";
import { createExperimentError, toErrorResponse } from "../../../../src/server/errors/experimentErrors.js";

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
    const result = await runTutorExperimentSession(config);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const response = toErrorResponse(error, "EXPERIMENT_RUN_FAILED");

    return NextResponse.json(response.body, { status: response.status });
  }
}
