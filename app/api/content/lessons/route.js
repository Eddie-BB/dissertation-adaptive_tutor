import { NextResponse } from "next/server";
import { getLessonIndex } from "../../../../src/server/content/lessonTemplateStore";

export async function GET() {
  const index = await getLessonIndex();

  return NextResponse.json({
    lessons: index.lessons.map((lesson) => ({
      lessonId: lesson.lessonId,
      lessonLabel: lesson.lessonLabel,
      courseName: lesson.courseName,
      problemCount: lesson.problemCount,
      stepCount: lesson.stepCount,
      knowledgeComponentCount: lesson.knowledgeComponentCount
    }))
  });
}
