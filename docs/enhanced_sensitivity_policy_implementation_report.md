# Enhanced Sensitivity Action Policy Implementation Report

## Summary of Changes

Implemented a minimal hybrid score + escalation policy for `enhanced_sensitivity` while preserving the existing one-turn timing model. The teacher still scores candidates from previous visible student cues and previous validation/progression context, but enhanced selection now applies deterministic situation rules after scoring so saturated ties no longer default to `GIVE_HINT`.

## Files Modified

| File | Change | Reason | Risk |
|---|---|---|---|
| `src/sim/teacher/teacherPolicy.js` | Added enhanced-only post-score selector, explicit escalation rules, tie priority, content capability gates, and immediate repeat guard for hint/check-in/break/choice. | Stop insertion-order hint wins and route repeated failure/non-response/off-task cues realistically. | Medium: policy behavior changes for enhanced condition only. |
| `src/server/experiments/tutorOrchestrator.js` | Added hint metadata, scaffold validation targets, support content capabilities, and logging for active validation target. | Detect hint exhaustion and validate scaffold subtasks against scaffold answers. | Medium: progression now treats correct scaffold answers as subtask completion rather than parent-step completion. |
| `src/sim/teacher/tutorTurnPlanner.js` | Added distinct worked-example and bottom-out required content paths; removed selected-hint reuse for those actions. | Prevent logs/render plans from claiming worked/bottom-out while rendering static hints. | Low: only changes support content fields for those action types. |
| `test/teacher-runtime.test.js` | Added enhanced policy, planning, content-gating, and integrated scaffold validation regressions. | Prove the audited failure modes are fixed and baseline remains stable. | Low. |

## Behaviour Before vs After

| Scenario | Previous behaviour | New behaviour | Test coverage |
|---|---|---|---|
| Saturated high-support tie | `GIVE_HINT` won because it was first in candidate order. | Enhanced post-processor chooses scaffold/check-in/bottom-out/reframe according to visible situation. | `enhanced sensitivity escalates repeated incorrect attempts...` |
| Mild confusion/help request | Could jump directly to scaffold because scaffold scored higher. | Starts with `GIVE_HINT`. | `enhanced sensitivity starts mild visible confusion with a hint` |
| Repeated incorrect attempt | Could continue selecting hint after scores saturated. | `repeatedIncorrectOnCurrentStep >= 2` escalates to `GIVE_SCAFFOLD` when available. | `enhanced sensitivity escalates repeated incorrect attempts...` |
| Persistent failure with exhausted hints | Final hint could repeat indefinitely. | Hint exhaustion is exposed and enhanced escalates to worked example if available, otherwise bottom-out/scaffold. | `enhanced sensitivity uses bottom-out...`; integrated scaffold test checks hint metadata. |
| Non-response/unknown | Cognitive hints could beat regulatory support. | Repeated unknown/non-response prioritizes `REQUEST_CHECKIN`, then slower pace/break. | `enhanced sensitivity routes repeated unknown non-response...` |
| Off-task/monotony | Cognitive hints could win. | Visible off-task/monotony routes to reframe/choice/break. | `enhanced sensitivity routes off-task monotony...` |
| Scaffold prompt validation | Scaffold answers were validated against the parent answer. | Scaffold action with scaffold hint validates against scaffold expected answers and then returns to parent. | `enhanced runner exposes hint exhaustion...` |
| Worked example action | Could render the same selected hint path. | Disabled unless worked-example content exists; planner has distinct worked-example content field. | `tutor turn planner renders worked example...` |
| Dynamic hint action | Enabled without a generator/content path. | Disabled unless `canUseDynamicHint === true`. | `enhanced sensitivity starts mild visible confusion...` |

## Action Selection Changes

`selectEnhancedSensitivityAction()` now applies enhanced-only rules after candidate scoring and condition constraints:

- non-answer/unknown + repeated evidence -> `REQUEST_CHECKIN`, then slower pace/break;
- off-task/monotony -> `REFRAME_PROMPT_VARIANT`, then choice/break;
- frustration -> affect support or slower pace;
- current scaffold hint after persistent failure -> `GIVE_SCAFFOLD`;
- repeated incorrect >= 2 -> `GIVE_SCAFFOLD`;
- persistent failure or exhausted hints -> worked example if content exists, otherwise bottom-out/scaffold;
- mild confusion/help-seeking with no repeated failure -> `GIVE_HINT`.

Baseline selection is unchanged and still uses its count-only sequence.

## Hint Exhaustion Handling

`selectHint()` now returns `hintState`:

```js
{ selectedHint, hintIndex, rawHintIndex, hintCount, hintExhausted, reusedFinalHint }
```

This is added to task context and turn logs. Enhanced policy reads this state and avoids repeated final-hint behavior by escalating or reframing.

## Scaffold Validation Handling

The orchestrator builds an `activeValidationTarget` after the tutor plan is known. If the selected instructional action is `GIVE_SCAFFOLD` and the selected hint has `scaffold.expectedAnswers`, validation uses a scaffold subtask question spec. Correct scaffold answers reset repeated incorrect count but do not advance the parent lesson step; the next turn resumes parent validation.

## Worked Example / Dynamic Hint Handling

`PROVIDE_WORKED_EXAMPLE` is now capability-gated by `canUseWorkedExample`, which is true only when the step provides `workedExample` content. `CALL_DYNAMIC_HINT` is disabled by default because there is no dynamic hint generator pathway in the current runtime. `GIVE_BOTTOM_OUT` remains available when bottom-out content or expected answers exist, and planner now renders bottom-out content separately from hints.

## Cooldown or Repetition Controls

Enhanced teacher state records `lastAction` and `lastSelectedHintId`. The enhanced selector prevents immediate repeats of `GIVE_HINT`, `REQUEST_CHECKIN`, `SUGGEST_BREAK`, and `OFFER_CHOICE` when alternatives are available. Repeated same-hint detection also contributes to hint exhaustion behavior.

## Redundant Code / Process Cleanup

- Dynamic hints are no longer treated as available without an explicit capability.
- Worked examples are no longer treated as scaffold-compatible by default.
- Scaffold data is now used for validation instead of ignored.
- Bottom-out and worked-example planning no longer reuse selected static hint text.
- Existing cooldown config remains, but the implemented control is an immediate-repeat guard rather than multi-turn cooldown counters.

## Tests Added or Updated

Added tests for:

- mild confusion -> hint;
- repeated incorrect -> scaffold despite saturated hint score;
- persistent failure -> bottom-out when worked-example content is unavailable;
- repeated unknown/non-response -> check-in;
- off-task/monotony -> reframe;
- dynamic hint disabled without capability;
- worked example/bottom-out planner content is distinct from selected hints;
- integrated scaffold validation against scaffold expected answer and return to parent step.

## Test Results

`npm test`

Result: 44 tests passed, 0 failed.

## Remaining Limitations

- Multi-turn cooldown counters from `spec.cooldowns` are not fully implemented; current control prevents immediate repeats only.
- No real dynamic hint generator exists yet, so dynamic hints remain disabled unless a caller explicitly enables the capability.
- Lesson content currently has no worked examples, so worked-example action is correctly disabled in integrated lesson runs.
- Bottom-out content falls back to expected answers when no explicit `bottomOut` content exists.

## Suggested Next Improvements

- Add explicit worked examples to lesson content where pedagogically appropriate.
- Implement true multi-turn action cooldown counters if the experiment needs exact cooldown durations.
- Add a dynamic hint generator or remove the action from enabled condition specs.
- Add render-level text similarity checks if LLM-generated phrasing still repeats despite action-level controls.
