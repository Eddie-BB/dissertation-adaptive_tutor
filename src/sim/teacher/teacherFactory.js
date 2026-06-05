/**
 * CANONICAL: teacher initialization and compatibility wrapper.
 *
 * The factory creates a teacher object with one decision entrypoint:
 * `processTurn(cues, context)`.
 *
 * Final action selection always happens inside `chooseTeacherAction`.
 */

import { chooseTeacherAction, chooseTeacherActionAsync } from './teacherPolicy.js';
import { getTeacherSpec, getAvailableSpecs, getExperimentalDesign } from './teacherSpecs.js';

export class TeacherModel {
  constructor(spec, runtimeConfig = {}) {
    this.spec = {
      ...spec,
      thresholds: { ...(spec.thresholds || {}), ...(runtimeConfig.thresholds || {}) },
      sensitivities: { ...(spec.sensitivities || {}), ...(runtimeConfig.sensitivities || {}) },
      enabledFeatures: { ...(spec.enabledFeatures || {}), ...(runtimeConfig.enabledFeatures || {}) },
      enabledActions: runtimeConfig.enabledActions || spec.enabledActions,
      cooldowns: { ...(spec.cooldowns || {}), ...(runtimeConfig.cooldowns || {}) }
    };
    this.runtimeConfig = runtimeConfig;
  }

  processTurn(cues, context = {}) {
    return chooseTeacherAction({
      conditionSpec: this.spec,
      cues,
      history: context.history || [],
      stepContext: context.stepContext || {},
      context
    });
  }

  async processTurnAsync(cues, context = {}) {
    return chooseTeacherActionAsync({
      conditionSpec: this.spec,
      cues,
      history: context.history || [],
      stepContext: context.stepContext || {},
      context,
      config: this.runtimeConfig
    });
  }

  getStats() {
    return {
      specId: this.spec.id,
      conditionId: this.spec.conditionId,
      enabledActions: this.spec.enabledActions,
      enabledFeatures: this.spec.enabledFeatures
    };
  }

  reset() {
    return undefined;
  }
}

export function createTeacher(specId, runtimeConfig = {}) {
  const spec = getTeacherSpec(specId);
  return new TeacherModel(spec, runtimeConfig);
}

export { getTeacherSpec, getAvailableSpecs, getExperimentalDesign };

export default { TeacherModel, createTeacher, getTeacherSpec, getAvailableSpecs, getExperimentalDesign };
