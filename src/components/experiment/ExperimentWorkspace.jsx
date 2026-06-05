"use client";

import { useEffect, useMemo, useState } from "react";
import {
  generateStudentProfile,
  getAvailableConditions,
  getAvailableLessonPlans,
  runExperiment,
  validateStudentAppraisalLoop
} from "../../services/experimentApi";
import ExperimentConfigPanel from "./ExperimentConfigPanel";
import ExperimenterOutputPanel from "./ExperimenterOutputPanel";
import ExperimentSummaryPanel from "./ExperimentSummaryPanel";
import StudentProfilePanel from "./StudentProfilePanel";
import TranscriptWindow from "./TranscriptWindow";

const DEFAULT_CONFIG = {
  conditionId: "",
  lessonPlanId: "",
  seed: 17,
  maxTurns: 4
};

function createIdleResult(config) {
  return {
    status: "idle",
    config,
    transcript: []
  };
}

export default function ExperimentWorkspace() {
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [lessonPlans, setLessonPlans] = useState([]);
  const [loadError, setLoadError] = useState("");
  const [result, setResult] = useState(createIdleResult(DEFAULT_CONFIG));
  const [student, setStudent] = useState(null);
  const [studentError, setStudentError] = useState("");
  const [studentValidation, setStudentValidation] = useState(null);
  const [conditions, setConditions] = useState([]);
  const resultConfig = result.status === "idle" ? config : result.config;

  const selectedCondition = useMemo(
    () => conditions.find((condition) => condition.id === resultConfig.conditionId),
    [conditions, resultConfig.conditionId]
  );
  const selectedLessonPlan = useMemo(
    () => lessonPlans.find((lessonPlan) => lessonPlan.id === resultConfig.lessonPlanId),
    [lessonPlans, resultConfig.lessonPlanId]
  );
  const running = result.status === "running";

  useEffect(() => {
    let isActive = true;

    async function loadOptions() {
      try {
        const [availableConditions, availableLessonPlans] = await Promise.all([
          getAvailableConditions(),
          getAvailableLessonPlans()
        ]);

        if (!isActive) {
          return;
        }

        setConditions(availableConditions);
        setLessonPlans(availableLessonPlans);
        setConfig((currentConfig) => ({
          ...currentConfig,
          conditionId: currentConfig.conditionId || availableConditions[0]?.id || "",
          lessonPlanId: currentConfig.lessonPlanId || availableLessonPlans[0]?.id || ""
        }));
      } catch (error) {
        if (isActive) {
          setLoadError(error.message);
        }
      }
    }

    loadOptions();

    return () => {
      isActive = false;
    };
  }, []);

  async function handleStart() {
    if (!student?.student_id) {
      setStudentError("Generate a student profile before starting the experiment.");
      return;
    }

    const runConfig = {
      ...config,
      seed: Number.isFinite(config.seed) ? config.seed : undefined,
      maxTurns: Math.min(Math.max(Number(config.maxTurns) || 1, 1), 30),
      studentId: student.student_id
    };

    setResult({
      status: "running",
      config: runConfig,
      transcript: []
    });

    try {
      setResult(await runExperiment(runConfig));
    } catch (error) {
      setResult({
        status: "error",
        config: runConfig,
        transcript: [],
        error: error.message
      });
    }
  }

  async function handleGenerateStudent() {
    setStudentError("");
    setStudentValidation(null);

    try {
      setStudent(await generateStudentProfile(config));
    } catch (error) {
      setStudentError(error.message);
    }
  }

  async function handleValidateStudentLoop() {
    if (!student?.student_id) {
      return;
    }

    setStudentError("");

    try {
      const validationResult = await validateStudentAppraisalLoop({
        studentId: student.student_id
      });
      setStudent(validationResult.student);
      setStudentValidation(validationResult.mapping_validation);
    } catch (error) {
      setStudentError(error.message);
    }
  }

  function handleReset() {
    setResult(createIdleResult(config));
  }

  function handleConfigChange(nextConfig) {
    setConfig(nextConfig);

    if (result.status !== "running") {
      setResult(createIdleResult(nextConfig));
    }
  }

  return (
    <main className="appShell workspaceShell">
      <header className="topBar workspaceHeader">
        <div>
          <p className="eyebrow">Adaptive Teaching Simulation</p>
          <h1>Experimenter workspace</h1>
          <p className="headerCopy">
            Configure an adaptive tutor condition, run it against a simulated student,
            and inspect the public interaction transcript.
          </p>
        </div>
      </header>

      {loadError ? (
        <p className="workspaceError" role="alert">
          {loadError}
        </p>
      ) : null}

      <div className="workspaceGrid">
        <div className="workspaceRail">
          <ExperimentConfigPanel
            config={config}
            disabled={running}
            lessonPlans={lessonPlans}
            onChange={handleConfigChange}
            onReset={handleReset}
            onStart={handleStart}
            student={student}
            conditions={conditions}
          />
          <ExperimentSummaryPanel
            lessonPlan={selectedLessonPlan}
            result={result}
            condition={selectedCondition}
          />
          <StudentProfilePanel
            disabled={running}
            error={studentError}
            onGenerate={handleGenerateStudent}
            onValidateLoop={handleValidateStudentLoop}
            student={student}
            validation={studentValidation}
          />
        </div>

        <div className="workspaceMain">
          <TranscriptWindow
            error={result.error}
            lessonPlan={selectedLessonPlan}
            status={result.status}
            transcript={result.transcript}
            condition={selectedCondition}
          />
          <ExperimenterOutputPanel
            output={result.experimenterOutput}
            status={result.status}
          />
        </div>
      </div>
    </main>
  );
}
