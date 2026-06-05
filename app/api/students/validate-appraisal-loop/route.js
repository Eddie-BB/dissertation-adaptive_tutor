import { NextResponse } from "next/server";
import { applyAppraisalTurn } from "../../../../src/sim/lib/learner/studentProfileStore.js";
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
    const result = await applyAppraisalTurn({
      studentId: body.studentId,
      teacherText:
        body.teacherText ||
        "Let us solve this step. First write the formula, then substitute the values."
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const response = toErrorResponse(error, "STUDENT_RESPONSE_INVALID");
    return NextResponse.json(response.body, { status: response.status });
  }
}
