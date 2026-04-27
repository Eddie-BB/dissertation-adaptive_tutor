import { NextResponse } from "next/server";
import {
  getLessonById,
  isContentLookupError
} from "../../../../../src/server/content/lessonTemplateStore";

export async function GET(_request, { params }) {
  try {
    const { lessonId } = await params;
    const lesson = await getLessonById(lessonId);

    return NextResponse.json(lesson);
  } catch (error) {
    if (isContentLookupError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    throw error;
  }
}
