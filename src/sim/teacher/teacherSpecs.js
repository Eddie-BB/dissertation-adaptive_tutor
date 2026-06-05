/**
 * CANONICAL: declarative teacher condition specifications.
 *
 * All experimental conditions use the same decision pipeline and action
 * vocabulary. Conditions vary only by enabled actions, enabled features,
 * thresholds, and sensitivities.
 */

import { TEACHER_ACTIONS, ALL_TEACHER_ACTIONS } from './actions.js';

const DEFAULT_FEATURES = Object.freeze({
  scaffolding: true,
  pacing: true,
  choice: true,
  encouragement: true,
  dynamic_hint: true
});

const DEFAULT_THRESHOLDS = Object.freeze({
  confusion: 0.6,
  disengagement: 0.7,
  off_task: 0.6,
  minimal: 0.65,
  frustration: 0.65,
  progress_low: 0.35,
  progress_high: 0.75,
  encouragement: 0.55,
  choice: 0.6,
  pacing_slow: 0.55,
  remediate: 0.85,
  review: 0.7
});

const DEFAULT_SENSITIVITIES = Object.freeze({
  scaffolding: 1.0,
  pacing: 1.0,
  choice: 1.0,
  encouragement: 1.0,
  affect: 1.0
});

function withDefaults(spec) {
  return {
    enabledActions: spec.enabledActions || ALL_TEACHER_ACTIONS,
    enabledFeatures: { ...DEFAULT_FEATURES, ...(spec.enabledFeatures || {}) },
    thresholds: { ...DEFAULT_THRESHOLDS, ...(spec.thresholds || {}) },
    sensitivities: { ...DEFAULT_SENSITIVITIES, ...(spec.sensitivities || {}) },
    cooldowns: { choice: 2, encouragement: 2, ...(spec.cooldowns || {}) },
    metadata: spec.metadata || {},
    ...spec
  };
}

export const TEACHER_SPECS = Object.freeze({
  baseline: withDefaults({
    id: 'baseline',
    name: 'Baseline Teacher',
    description: 'Minimal adaptation with standard progression.',
    conditionId: 'baseline',
    enabledActions: [
      TEACHER_ACTIONS.CONTINUE_STANDARD,
      TEACHER_ACTIONS.GIVE_HINT,
      TEACHER_ACTIONS.GIVE_SCAFFOLD
    ],
    enabledFeatures: {
      scaffolding: true,
      pacing: false,
      choice: false,
      encouragement: false,
      dynamic_hint: false
    },
    sensitivities: {
      scaffolding: 0.2,
      pacing: 0.4,
      choice: 0.0,
      encouragement: 0.0,
      affect: 0.4
    },
    thresholds: {
      disengagement: 0.85,
      minimal: 0.85
    }
  }),

  enhanced_sensitivity: withDefaults({
    id: 'enhanced_sensitivity',
    name: 'Enhanced Sensitivity Teacher',
    description: 'Earlier triggering and stronger adaptive responses using cue trends.',
    conditionId: 'enhanced_sensitivity',
    sensitivities: {
      scaffolding: 1.35,
      pacing: 1.3,
      choice: 1.0,
      encouragement: 0.95,
      affect: 1.25
    },
    thresholds: {
      confusion: 0.42,
      disengagement: 0.5,
      off_task: 0.45,
      minimal: 0.5,
      frustration: 0.5,
      pacing_slow: 0.38,
      remediate: 0.72,
      review: 0.55
    }
  }),

  state_aware: withDefaults({
    id: 'state_aware',
    name: 'State-Aware Teacher',
    description: 'Uses visible-only estimated engagement state to vary actions.',
    conditionId: 'state_aware',
    sensitivities: {
      scaffolding: 1.2,
      pacing: 1.2,
      choice: 1.1,
      encouragement: 1.05,
      affect: 1.15
    },
    thresholds: {
      confusion: 0.48,
      disengagement: 0.52,
      off_task: 0.46,
      minimal: 0.5,
      frustration: 0.52,
      pacing_slow: 0.42,
      remediate: 0.72,
      review: 0.56
    },
    metadata: {
      usesEstimatedState: true
    }
  })
});

export const EXPERIMENTAL_DESIGNS = Object.freeze({
  baseline_comparison: {
    id: 'baseline_comparison',
    name: 'Baseline Condition Comparison',
    specs: ['baseline', 'enhanced_sensitivity', 'state_aware']
  }
});

export function getTeacherSpec(specId) {
  if (!specId) {
    throw new Error('Teacher condition is required.');
  }

  const spec = TEACHER_SPECS[specId];
  if (!spec) {
    throw new Error(`Unknown teacher spec: ${specId}`);
  }
  return spec;
}

export function getAvailableSpecs() {
  return Object.keys(TEACHER_SPECS);
}

export function getExperimentalDesign(designId) {
  return EXPERIMENTAL_DESIGNS[designId];
}

export default { TEACHER_SPECS, EXPERIMENTAL_DESIGNS, getTeacherSpec, getAvailableSpecs, getExperimentalDesign };
