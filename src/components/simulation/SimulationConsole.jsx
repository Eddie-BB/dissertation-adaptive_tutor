"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import DebugMetadataPanel from "./DebugMetadataPanel";
import LessonSelector from "./LessonSelector";
import ProblemSelector from "./ProblemSelector";
import StepInspector from "./StepInspector";
import TeacherContextPanel from "./TeacherContextPanel";

export default function SimulationConsole() {
  const [selectedLessonId, setSelectedLessonId] = useState("");
  const [selectedProblemId, setSelectedProblemId] = useState("");
  const [selectedStepIndex, setSelectedStepIndex] = useState(0);
  const [lesson, setLesson] = useState(null);
  const [lessonError, setLessonError] = useState("");
  const [teacherPayload, setTeacherPayload] = useState(null);
  const [teacherError, setTeacherError] = useState("");
  const [debugVisible, setDebugVisible] = useState(true);

  const selectedProblem = useMemo(
    () => lesson?.problems?.find((problem) => problem.id === selectedProblemId),
    [lesson, selectedProblemId]
  );

  const handleSelectLesson = useCallback((lessonId) => {
    setSelectedLessonId(lessonId);
  }, []);

  useEffect(() => {
    if (!selectedLessonId) {
      return;
    }

    let isActive = true;

    async function loadLesson() {
      try {
        setLessonError("");
        const response = await fetch(`/api/content/lessons/${selectedLessonId}`);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Unable to load lesson");
        }

        if (isActive) {
          setLesson(data);
          setSelectedProblemId(data.problems?.[0]?.id || "");
          setSelectedStepIndex(data.problems?.[0]?.steps?.[0]?.index || 0);
        }
      } catch (error) {
        if (isActive) {
          setLesson(null);
          setLessonError(error.message);
        }
      }
    }

    loadLesson();

    return () => {
      isActive = false;
    };
  }, [selectedLessonId]);

  useEffect(() => {
    if (!selectedLessonId || !selectedProblemId) {
      return;
    }

    let isActive = true;

    async function loadTeacherContext() {
      try {
        setTeacherError("");
        const response = await fetch("/api/content/teacher-context", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            lessonId: selectedLessonId,
            problemId: selectedProblemId,
            stepIndex: selectedStepIndex,
            studentProgress: {
              attemptsOnCurrentStep: 0,
              previousIncorrectAnswers: [],
              visibleStudentHistory: []
            }
          })
        });
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Unable to build teacher context");
        }

        if (isActive) {
          setTeacherPayload(data);
        }
      } catch (error) {
        if (isActive) {
          setTeacherPayload(null);
          setTeacherError(error.message);
        }
      }
    }

    loadTeacherContext();

    return () => {
      isActive = false;
    };
  }, [selectedLessonId, selectedProblemId, selectedStepIndex]);

  function handleSelectProblem(problemId) {
    const nextProblem = lesson?.problems?.find((problem) => problem.id === problemId);
    setSelectedProblemId(problemId);
    setSelectedStepIndex(nextProblem?.steps?.[0]?.index || 0);
  }

  return (
    <main className="appShell">
      <header className="topBar">
        <div>
          <p className="eyebrow">Adaptive Teaching Simulation</p>
          <h1>Simulation Content Console</h1>
        </div>
        <label className="toggleControl">
          <input
            checked={debugVisible}
            onChange={(event) => setDebugVisible(event.target.checked)}
            type="checkbox"
          />
          <span>Debug metadata</span>
        </label>
      </header>

      <div className="consoleGrid">
        <aside className="sidebar">
          <LessonSelector
            onSelectLesson={handleSelectLesson}
            selectedLessonId={selectedLessonId}
          />
          {lessonError ? <p className="errorText">{lessonError}</p> : null}
          <ProblemSelector
            lesson={lesson}
            onSelectProblem={handleSelectProblem}
            selectedProblemId={selectedProblemId}
          />
        </aside>

        <section className="mainColumn">
          <StepInspector
            onSelectStep={setSelectedStepIndex}
            problem={selectedProblem}
            selectedStepIndex={selectedStepIndex}
          />
          <TeacherContextPanel
            context={teacherPayload?.teacherContext}
            error={teacherError}
          />
          <DebugMetadataPanel debug={teacherPayload?.debug} visible={debugVisible} />
        </section>
      </div>
    </main>
  );
}
