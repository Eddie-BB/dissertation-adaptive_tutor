import { NextResponse } from "next/server";
import { getActiveLesson } from "../../../../src/server/content/lessonStore.js";
import { toErrorResponse } from "../../../../src/server/errors/experimentErrors.js";

export async function GET() {
  try {
    return NextResponse.json({ ok: true, ...(await getActiveLesson()) });
  } catch (error) {
    const response = toErrorResponse(error, "LESSON_FILE_NOT_FOUND");
    return NextResponse.json(response.body, { status: response.status });
  }
}
