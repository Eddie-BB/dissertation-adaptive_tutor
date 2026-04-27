"use client";

import { useEffect, useState } from "react";

export default function LessonSelector({ selectedLessonId, onSelectLesson }) {
  const [lessons, setLessons] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let isActive = true;

    async function loadLessons() {
      try {
        const response = await fetch("/api/content/lessons");
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Unable to load lessons");
        }

        if (isActive) {
          setLessons(data.lessons || []);
          if (!selectedLessonId && data.lessons?.[0]) {
            onSelectLesson(data.lessons[0].lessonId);
          }
        }
      } catch (loadError) {
        if (isActive) {
          setError(loadError.message);
        }
      }
    }

    loadLessons();

    return () => {
      isActive = false;
    };
  }, [onSelectLesson, selectedLessonId]);

  return (
    <section className="panel">
      <div className="panelHeader">
        <h2>Lessons</h2>
      </div>
      {error ? <p className="errorText">{error}</p> : null}
      <div className="lessonList">
        {lessons.map((lesson) => (
          <button
            className={`lessonOption ${
              lesson.lessonId === selectedLessonId ? "selected" : ""
            }`}
            key={lesson.lessonId}
            onClick={() => onSelectLesson(lesson.lessonId)}
            type="button"
          >
            <span className="optionTitle">{lesson.lessonLabel}</span>
            <span className="optionMeta">{lesson.courseName}</span>
            <span className="metricRow">
              <span>{lesson.problemCount} problems</span>
              <span>{lesson.stepCount} steps</span>
              <span>{lesson.knowledgeComponentCount} KCs</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
