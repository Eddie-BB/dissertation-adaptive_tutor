import { NextResponse } from "next/server";
import { getConditionOptions } from "../../../../src/server/experiments/conditionOptions.js";
import { toErrorResponse } from "../../../../src/server/errors/experimentErrors.js";

export async function GET() {
  try {
    return NextResponse.json({
      ok: true,
      conditions: await getConditionOptions()
    });
  } catch (error) {
    const response = toErrorResponse(error, "LESSON_FILE_NOT_FOUND");
    return NextResponse.json(response.body, { status: response.status });
  }
}
