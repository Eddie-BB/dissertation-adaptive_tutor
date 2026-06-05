import { NextResponse } from "next/server";
import { generateAndStoreStudentProfile } from "../../../../src/sim/lib/learner/studentProfileStore.js";
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
    const body = await readRequestJson(request);
    const student = await generateAndStoreStudentProfile({
      seed: body.seed,
      studentId: body.studentId,
      conditionId: body.conditionId
    });

    return NextResponse.json({ ok: true, student });
  } catch (error) {
    const response = toErrorResponse(error, "STUDENT_GENERATION_FAILED");
    return NextResponse.json(response.body, { status: response.status });
  }
}
