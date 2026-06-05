# Teacher Architecture

## Canonical Flow

1. The runner gathers observable cues and step context.
2. `src/sim/teacher/teacherFactory.js` initializes a teacher from a condition spec.
3. `src/sim/teacher/teacherPolicy.js` computes internal policy signals and selects one final symbolic action.
4. `src/sim/teacher/teacherMessageRenderer.js` turns that symbolic action into visible teacher behaviour.

The runner does not decide pedagogy. It only orchestrates turns.

## File Ownership

- `actions.js`
  - single source of truth for canonical teacher actions
- `teacherPolicy.js`
  - single source of final action selection
- `teacherSpecs.js`
  - declarative condition definitions
- `teacherFactory.js`
  - teacher initialization and compatibility wrapper
- `teacherMessageRenderer.js`
  - action-to-message execution layer

## Conditions

Conditions differ by:
- enabled actions
- enabled features
- thresholds
- sensitivities

The experimenter-selected condition must be explicit. Unknown or missing
condition IDs should fail closed rather than silently falling back to baseline.

Conditions do not create separate decision architectures.

## Legacy Intervention Modules

Legacy intervention modules have been removed from the active repository path.
Final action selection is now fully canonicalized under `src/sim/teacher/`.
