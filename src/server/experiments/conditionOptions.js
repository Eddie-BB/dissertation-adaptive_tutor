import { getActiveLesson } from "../content/lessonStore.js";
import { getTeacherSpec } from "../../sim/teacher/teacherSpecs.js";

const CONDITION_COPY = {
  baseline: {
    label: "Condition 1: Baseline",
    description: "Baseline condition with minimal adaptation."
  },
  enhanced_sensitivity: {
    label: "Condition 2: Enhanced Sensitivity",
    description: "Condition that increases adaptive support, scaffolding, and variation."
  },
  state_aware: {
    label: "Condition 3: State-Aware",
    description: "Condition that adapts from inferred student response signals."
  }
};

function formatConditionId(conditionId) {
  return conditionId
    .split("_")
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() || ""}${part.slice(1)}`)
    .join(" ");
}

export async function getConditionOptions() {
  const conditionIds = new Set(
    ((await getActiveLesson()).conditionMetadata?.compatibleConditions || [])
  );

  return Array.from(conditionIds).map((conditionId) => {
    const teacherSpec = getTeacherSpec(conditionId);
    const copy = CONDITION_COPY[conditionId] || {};

    return {
      id: conditionId,
      label: copy.label || teacherSpec.name || formatConditionId(conditionId),
      description:
        copy.description ||
        teacherSpec.description ||
        "Condition exposed by the active lesson content."
    };
  });
}
