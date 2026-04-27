import { NextResponse } from "next/server";
import { buildTeacherContext } from "../../../../src/server/content/teacherContextBuilder";
import { isContentLookupError } from "../../../../src/server/content/lessonTemplateStore";

export async function POST(request) {
  try {
    const body = await request.json();
    const result = await buildTeacherContext(body);

    return NextResponse.json(result);
  } catch (error) {
    if (isContentLookupError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid JSON request body" }, { status: 400 });
    }

    throw error;
  }
}
