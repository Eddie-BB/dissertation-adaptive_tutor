# Enhanced Sensitivity Action Policy Audit

## Executive Summary

`enhanced_sensitivity` is implemented as the same symbolic teacher-policy pipeline as other non-baseline conditions, but with lower thresholds and higher sensitivities in `src/sim/teacher/teacherSpecs.js`. It is based on the previous visible student response and previous validation/progression state, not the current generated student response. The core loop is in `runTutorExperimentSession()` in `src/server/experiments/tutorOrchestrator.js`: teacher action is chosen, teacher text is rendered, the simulated student responds, validation runs, and only then does that validation affect the next teacher action.

The main functional risk is that `enhanced_sensitivity` has no explicit escalation ladder. `chooseTeacherAction()` computes scores, `applyConditionConstraints()` boosts many escalatory actions, and `selectHighestScoringAction()` sorts only by descending score. When scores saturate at `1`, original candidate insertion order wins. Because `GIVE_HINT` is inserted before `GIVE_SCAFFOLD`, `PROVIDE_WORKED_EXAMPLE`, `CALL_DYNAMIC_HINT`, pacing, and break actions, high support-need cases can repeatedly select `ACTION_GIVE_HINT`, including non-response/off-task cases.

Hint selection is similarly index-based and saturating. `selectHint()` clamps the hint index to the final hint. Once repeated incorrect attempts exceed available hints, the final hint/scaffold text is reused indefinitely. Scaffold objects contain their own `expectedAnswers`, but the orchestrator validates every student response against the original lesson step, not the scaffold subtask. Therefore scaffold prompts can ask an arithmetic subquestion while validation still expects the original final answer.

## File Map

| File | Role |
| --- | --- |
| `src/server/experiments/tutorOrchestrator.js` | Main experiment turn loop; builds step context, extracts cues from prior visible history, calls teacher policy, plans/render tutor message, validates student response, updates progression. |
| `src/sim/teacher/cueExtractor.js` | Observable-only phrase, length, trend, and idle-gap cue extraction. |
| `src/sim/teacher/teacherSpecs.js` | Condition specs; enhanced thresholds, sensitivities, enabled features/actions, default cooldown fields. |
| `src/sim/teacher/teacherFactory.js` | Creates `TeacherModel`; merges runtime threshold/sensitivity/action overrides into specs. |
| `src/sim/teacher/teacherPolicy.js` | Canonical action selection; computes policy signals, scores actions, applies boosts/suppressions, sorts by score. |
| `src/sim/teacher/actions.js` | Canonical symbolic action vocabulary. |
| `src/sim/teacher/tutorTurnPlanner.js` | Converts selected policy action into a tutor-turn plan and required content. |
| `src/sim/teacher/teacherMessageRenderer.js` | LLM-backed visible teacher message generation and validation. |
| `src/lib/validation/answerValidator.js` | Deterministic answer classification and validation input selection. |
| `src/lib/learner/observedLearnerState.js` | Aggregated observed correctness state; logged but not currently used by teacher policy. |
| `content/lessons/systems_linear_equations_two_variables.json` | Lesson steps, expected answers, choices, hints, scaffold objects. |
| `test/teacher-runtime.test.js` | Existing coverage for baseline escalation, enhanced candidate inclusion, validation evidence, planning, renderer, and full mocked run. |
| `test/validation-runtime.test.js` | Existing validation behavior coverage. |

## Current Action Selection Pipeline

```text
previous visible student response
+ validation/progression state
-> cue extraction
-> internal policy signal calculation
-> condition-specific thresholds/multipliers
-> action scoring
-> tie-breaking/suppression/boosting
-> selected action
-> tutor plan
-> rendered tutor text
-> student response/validation
-> next-turn policy context
```

| Stage | File/function | Inputs | Outputs | Data type | Timing |
| --- | --- | --- | --- | --- | --- |
| Step and hint context | `src/server/experiments/tutorOrchestrator.js`, `buildTaskContext()` | current lesson step, `currentStepIndex`, `repeatedIncorrectOnCurrentStep` | task context with selected hint, choices, capabilities | lesson/progression derived state | before tutor message |
| Last visible student text | `getLastStudentText()` | `visibleTurnHistory` | last `student_message` or empty string | observable | before tutor message |
| Cue extraction | `src/sim/teacher/cueExtractor.js`, `extractCues()` | last visible student text, visible history, optional timestamp | cue booleans/rates/trends | observable only | before tutor message |
| Teacher decision | `src/sim/teacher/teacherFactory.js`, `TeacherModel.processTurnAsync()` -> `teacherPolicy.chooseTeacherActionAsync()` | cues, visible history, step context, current step, progression context, `lastTurnOutcome` | `teacherDecision.action`, rationale, debug | derived policy state | before tutor message |
| Signal calculation | `src/sim/teacher/teacherPolicy.js`, `computePolicySignals()` | cues, thresholds, sensitivities, `lastTurnOutcome`, repeated incorrect count | progress/confusion/support/remediate/etc. | derived from observable + validation/progression | before tutor message |
| Scoring | `scoreActionCandidates()` | signals, cues, thresholds, sensitivities, capabilities | action candidates with scores | derived policy state | before tutor message |
| Boost/suppress/filter | `applyConditionConstraints()` | candidates, enabled actions/features, capabilities, condition spec | considered/disabled candidates | derived policy state | before tutor message |
| Selection | `selectPolicyAction()` -> `selectHighestScoringAction()` | filtered candidates | selected action | derived policy state | before tutor message |
| Planning | `src/sim/teacher/tutorTurnPlanner.js`, `planTutorTurn()` | teacher decision, current step, task context, previous turn validation | tutor turn plan and message skeleton | derived planning state | before rendering |
| Rendering | `src/sim/teacher/teacherMessageRenderer.js`, `renderTeacherMessageWithAdapter()` | teacher decision, tutor turn plan, visible history | visible teacher message | observable output | before student response |
| Student response | `applyAppraisalTurn()` in orchestrator | visible teacher text | simulated student text and hidden logs | generated observable + hidden student internals | after tutor message |
| Validation | `src/lib/validation/answerValidator.js`, `validateAnswer()` | current original step and student response | validation result | derived validation state | after student response |
| Progression update | `runTutorExperimentSession()` | validation result | increment/reset repeated incorrect, advance step on correct | derived progression state | after validation; affects next turn |

The one-turn delay is explicit in `runTutorExperimentSession()`: cues are extracted from `getLastStudentText(visibleTurnHistory)` before the current teacher message/student response exists; `lastTurnOutcome` is updated only after `validateAnswer()` later in the same loop.

## Enhanced Sensitivity Configuration

`withDefaults()` in `src/sim/teacher/teacherSpecs.js` supplies default features, thresholds, sensitivities, cooldowns, and all actions unless a condition overrides them. `enhanced_sensitivity` inherits all actions and all default feature flags because it does not specify `enabledActions` or `enabledFeatures`.

| Parameter | Baseline/default | Enhanced sensitivity | Functional implication |
| --- | ---: | ---: | --- |
| Enabled actions | baseline: continue, hint, scaffold; default: all | all actions | Enhanced can choose cognitive, affective, pacing, choice, check-in, bottom-out, dynamic hint. |
| `scaffolding` feature | baseline true, default true | true inherited | Enables hint/scaffold/worked/bottom-out scoring. |
| `pacing` feature | baseline false, default true | true inherited | Enables slower pace, break, skip optional content. |
| `choice` feature | baseline false, default true | true inherited | Enables offer choice. |
| `encouragement` feature | baseline false, default true | true inherited | Enables encouragement/praise/frustration actions. |
| `dynamic_hint` feature | baseline false, default true | true inherited | Enables `CALL_DYNAMIC_HINT`. |
| `confusion` | default 0.60 | 0.42 | Scaffold/praise/encouragement threshold effects trigger earlier. |
| `disengagement` | default 0.70; baseline 0.85 | 0.50 | Lower threshold, but mostly affects escalation pressure indirectly via signals. |
| `off_task` | default 0.60 | 0.45 | Choice/off-task related boost triggers earlier. |
| `minimal` | default 0.65; baseline 0.85 | 0.50 | Spec value is not directly referenced in current signal formulas; cue extractor has its own token threshold. |
| `frustration` | default 0.65 | 0.50 | Spec value is not directly used in current formulas except through affect-derived signals. |
| `progress_low` | default 0.35 | 0.35 inherited | Bottom-out and worked-example support use this default. |
| `progress_high` | default 0.75 | 0.75 inherited | Present but not used in current policy formulas. |
| `encouragement` | default 0.55 | 0.55 inherited | Present but not directly used as a gate. |
| `choice` | default 0.60 | 0.60 inherited | Adds +0.1 to choice when engagement exceeds threshold. |
| `pacing_slow` | default 0.55 | 0.38 | Present in spec but not directly referenced in scoring. |
| `remediate` | default 0.85 | 0.72 | Suppresses worked examples less often; worked example score is multiplied by 0.7 only when supportNeed < 0.72. |
| `review` | default 0.70 | 0.55 | Present in spec but not directly used as a gate. |
| `scaffolding` sensitivity | baseline 0.20; default 1.00 | 1.35 | Multiplies hint/scaffold/worked/bottom-out/dynamic hint scores, often saturating them. |
| `pacing` sensitivity | baseline 0.40; default 1.00 | 1.30 | Increases slower-pace/break scores. |
| `choice` sensitivity | baseline 0.00; default 1.00 | 1.00 | Choice score unchanged from default. |
| `encouragement` sensitivity | baseline 0.00; default 1.00 | 0.95 | Slightly lowers encouragement/praise vs default. |
| `affect` sensitivity | baseline 0.40; default 1.00 | 1.25 | Boosts frustration-addressing score. |
| Cooldowns | default `{ choice: 2, encouragement: 2 }` | inherited | Not used anywhere in current policy selection. |
| Suppression/boost rules | none in spec | hardcoded in `applyConditionConstraints()` | Enhanced suppresses continue, praise, and choice under escalation pressure; boosts many support/pacing/variation actions by +0.28 * escalation pressure. |
| Fallback | score sort | score sort | If all candidates unavailable, throws; no safe fallback action in policy. |

## Observable Cue Extraction

`extractCues()` in `src/sim/teacher/cueExtractor.js` uses only visible `studentText`, visible history, and optional timestamps. It does not receive hidden simulated labels or hidden ARM values.

| Cue | Detection logic | Example matching text | False positive risk | False negative risk |
| --- | --- | --- | --- | --- |
| `tokenCount` | whitespace token count after lowercasing/trimming | `I do not know` => 4 | punctuation-heavy math may count oddly | terse meaningful answers look low-progress |
| `hasAnyQuestion` | raw text contains `?` | `Can you explain?` | rhetorical/off-task questions | help requests without question mark |
| `isEmptyOrEllipsis` | empty normalized text or raw/normalized `...` | `...` | ellipsis can mean thinking | silent refusal without ellipsis |
| `isMinimal` | `tokenCount <= minimalTokenThreshold`, default 6 | `no` | correct short MC answers look minimal | verbose but disengaged answers |
| `isHelpSeeking` | help phrase list or question with how/why/what/where/when/can you | `I don't understand`, `what do I do?` | `example` can be content not request | misspellings/slang not listed |
| `isConfused` | confusion phrase list | `I'm lost`, `doesn't make sense` | self-report may be mild | students can be confused without saying so |
| `isFrustrated` | frustration phrase list | `this is hard`, `I hate this` | "hard" can be productive challenge | subdued frustration not stated |
| `isOffTask` | off-task phrase list | `This is boring`, `can we change?` | wanting a different strategy may be adaptive | off-task behavior without wording |
| `isDisengaged` | empty/ellipsis or disengaged phrase list | `I give up`, `need a break` | "can't" substring can catch low-confidence statements | disengagement masked as short answer |
| `requestsRepetition` | repetition phrase list | `Can you repeat?` | "again" can mean another problem | repetition request phrased differently |
| `tokenTrendSlopeLastK` | least-squares slope over token counts of last K plus current | shrinking replies across turns | short correct answers reduce slope | no timestamps/content semantics |
| `minimalRateLastK` | rate of minimal responses in history window plus current | repeated `no`, `?`, `...` | MC tasks naturally short | verbose non-answer |
| `helpSeekingRateLastK` | rate of history/current text containing help phrases | repeated `help` | content word "example" | unlisted help language |
| `offTaskRateLastK` | rate of off-task phrase matches | repeated `boring` | legitimate request to switch approach | off-task without words |
| `disengagedRateLastK` | rate of empty/ellipsis only in rolling flags | repeated `...` | thinking ellipses | ignores most disengaged phrases in rolling rate |
| `idleGapDetected` | last timestamp gap > `idleGapMs`, default 45s | long pause | environmental pause | not available without timestamps |

## Internal Policy Signal Formulas

All non-initial formulas are in `computePolicySignals()` and helper functions in `src/sim/teacher/teacherPolicy.js`; each numeric signal is clamped with `clamp01()` unless noted.

Initial turn special case:

```text
progress=0.45, confusion=0, disengagement=0, offTask=0, frustration=0,
engagement=0.4, pacingPressure=0.15, autonomyOpportunity=0.2,
supportNeed=0.12, remediateNeed=0.15,
encouragementNeed=0.08 * encouragementSensitivity,
praiseOpportunity=0.18, reviewNeed=0.12
```

Non-initial formulas:

```text
progress = clamp01((tokenCount / 18) * 0.4 + (!isMinimal) * 0.35 + (!isDisengaged) * 0.25)
confusion = clamp01(isConfused*0.45 + isHelpSeeking*0.35 + helpSeekingRateLastK*0.2)
disengagement = clamp01(isDisengaged*0.6 + idleGapDetected*0.2 + disengagedRateLastK*0.2)
offTask = clamp01(isOffTask*0.55 + offTaskRateLastK*0.25 + (minimalRateLastK > 0.5 ? 0.1 : 0))
frustration = clamp01(isFrustrated*0.55 + isConfused*0.15 + isDisengaged*0.1)
engagement = clamp01(progress*0.55 + hasAnyQuestion*0.15 + (1-disengagement)*0.2 + (1-offTask)*0.1)
pacingPressure = clamp01((1-progress)*0.35 + confusion*0.25 + minimalRateLastK*0.4 + clamp01(-tokenTrendSlopeLastK/4)*0.2 + (currentTurn > 3 ? 0.1 : 0))
autonomyOpportunity = clamp01(engagement*0.45 + progress*0.15 + isOffTask*0.2 + isMinimal*0.1 + offTaskRateLastK*0.1)
baseSupport = clamp01(confusion*0.45 + frustration*0.2 + disengagement*0.15 + (1-progress)*0.2)
supportNeed = clamp01(baseSupport + previousIncorrect*0.32 + previousPartial*0.16 + previousMisconception*0.28 + previousUnknown*0.12 + repeatedIncorrect*0.12)
remediateNeed = clamp01(max(supportNeed, pacingPressure))
encouragementNeed = clamp01(((1-progress)*0.25 + frustration*0.45 + engagement*0.2) * encouragementSensitivity)
praiseOpportunity = clamp01(progress*0.75 + engagement*0.25 + previousCorrect*0.28 - previousIncorrect*0.2)
reviewNeed = clamp01((1-progress)*0.5 + confusion*0.3 + offTask*0.2 + previousIncorrect*0.34 + previousPartial*0.14 + previousMisconception*0.28 + previousUnknown*0.18)
```

Signals saturate at `1`. When multiple action scores saturate at `1`, `selectHighestScoringAction()` sorts only by score; equal-score order follows candidate insertion order.

## Action Score Formulas

All candidate scores are clamped once by `candidate()`. Many formulas also clamp internally, then multiply by sensitivity, and `candidate()` clamps again. Enhanced then applies post-score boost/suppression in `applyConditionConstraints()`.

| Action | Score formula before enhanced adjustment | Main triggers | Enhanced adjustment | Failure mode |
| --- | --- | --- | --- | --- |
| `CONTINUE_STANDARD` | `0.1 + engagement*0.35 + progress*0.35 - supportNeed*0.25` | engagement/progress | multiply by `1 - escalationPressure*0.55` | suppressed appropriately under difficulty, but no fallback if all else tied. |
| `OFFER_CHOICE` | `autonomyOpportunity*choiceSens + offTask>thr?0.15 + engagement>choiceThr?0.1 - supportNeed*0.2 - frustration*0.15 - disengagement*0.1` | autonomy/off-task/high engagement | multiply by `1 - escalationPressure*0.4` | off-task/monotony often loses to hints because support actions saturate. |
| `GIVE_HINT` | `clamp01(supportNeed*0.75 + help?0.12 + repetition?0.08 + previousIncorrect?0.28 + previousPartial?0.14) * scaffoldingSens` | support need, help, prior incorrect | `+ escalationPressure*0.28` then clamp | Saturates early and wins ties due to first insertion among support actions. |
| `GIVE_SCAFFOLD` | `clamp01(supportNeed*0.95 + confusion>thr?0.1 + help?0.18 + previousMisconception?0.16 + repeatedIncorrect*0.12) * scaffoldingSens` | support, confusion, help, misconception, repeats | same support boost; disabled if `canUseScaffold=false` | Can tie with hint and lose by array order. |
| `PROVIDE_WORKED_EXAMPLE` | `clamp01(remediateNeed*0.9 + confusion*0.2 + help?0.1 + previousMisconception?0.16) * scaffoldingSens` | remediation/confusion/help | same support boost; disabled if `canUseScaffold=false`; multiplied by `0.7` when `supportNeed < remediateThreshold` | No lesson worked-example content; can be selected but rendered with selected hint text. |
| `GIVE_BOTTOM_OUT` | `clamp01(remediateNeed*0.95 + progress<progressLow?0.15) * scaffoldingSens` | severe remediation/low progress | same support boost; disabled if `canUseBottomOut=false`; multiplied by `0.5` if progress > 0.25 | Renderer rules say bottom-out may reveal answers, but planner supplies only selected hint. |
| `CALL_DYNAMIC_HINT` | `clamp01(supportNeed*0.85 + confusion*0.15 + help?0.18) * scaffoldingSens` | support/confusion/help | same support boost; disabled if `canUseDynamicHint=false` | No distinct dynamic-hint generator is called; planner renders selected static hint. |
| `REQUEST_CHECKIN` | `clamp01(disengagement*0.4 + confusion*0.35 + reviewNeed*0.2 + previousUnknown?0.2)` | disengagement/confusion/unknown | no enhanced support boost | Can lose to saturated hints even for non-response. |
| `REFRAME_PROMPT_VARIANT` | `clamp01(offTask*0.5 + autonomyOpportunity*0.2 + progressRatio>0.4?0.1)` | off-task/variation | `+ escalationPressure*0.28` | No distinct reframe text except modifier/action instruction to LLM. |
| `GIVE_GENERAL_ENCOURAGEMENT` | `clamp01(encouragementNeed + supportNeed>confusionThr?0.05 - offTask*0.1) * encouragementSens` | affect/effort | no enhanced support boost | Often lower than cognitive support during difficulty. |
| `GIVE_SPECIFIC_PRAISE` | `clamp01(praiseOpportunity - supportNeed*0.45 - confusion*0.35 - frustration*0.45 - offTask*0.2 - disengagement*0.25) * encouragementSens` | correct/progress/engagement | multiply by `1 - escalationPressure*0.55` | sensible suppression after failure. |
| `ADDRESS_FRUSTRATION` | `clamp01(frustration*affectSens + disengagement*0.2)` | frustration/disengagement | no enhanced support boost | Can lose to hint even when affect is the salient issue. |
| `SUGGEST_SLOWER_PACE` | `clamp01(pacingPressure*pacingSens + confusion*0.15)` | pacing/confusion | `+ escalationPressure*0.28` | Ties with support actions but inserted later, so loses. |
| `SUGGEST_BREAK` | `clamp01(disengagement*0.75 + frustration*0.35) * pacingSens` | disengagement/frustration | `+ escalationPressure*0.28` | Can saturate for non-response but loses to hint by tie order. |
| `SKIP_OPTIONAL_CONTENT` | `clamp01(remediateNeed*0.6 + pacingPressure*0.45)` | remediation/pacing | `+ escalationPressure*0.28`; disabled by orchestrator via `canSkipOptionalContent:false` | Always disabled in integrated run. |

`enhanced_sensitivity` computes:

```text
escalationPressure = clamp01(max(
  supportNeed,
  pacingPressure,
  reviewNeed*0.85,
  offTask*0.9,
  confusion*0.95
))
```

It boosts hint/scaffold/worked/bottom-out/dynamic-hint/slower-pace/break/skip/reframe by `+ escalationPressure*0.28`, suppresses continue and praise by `*(1 - escalationPressure*0.55)`, and suppresses choice by `*(1 - escalationPressure*0.4)`.

## Tie-Breaking and Escalation Behaviour

`selectHighestScoringAction()` copies filtered candidates and calls `.sort((a, b) => b.score - a.score)`. There is no explicit priority order for enhanced sensitivity, no near-tie margin, no action cooldown use, no previous-action penalty, no hint exhaustion check, and no rendered-text de-duplication.

Baseline is different: `selectBaselineTeacherAction()` directly returns scaffold at `repeatedIncorrectOnCurrentStep >= 2`, hint at `>= 1`, else continue. There is also a baseline-only override inside `selectPolicyAction()`, but normal baseline exits earlier from `chooseTeacherAction()`, so the direct baseline selector is the operative path.

Diagnostic policy probes confirm the failure mode:

| Scenario | Selected enhanced action | Why |
| --- | --- | --- |
| Mild confusion/help, no prior wrong | `ACTION_GIVE_SCAFFOLD` | Lower confusion threshold plus 1.35 scaffolding sensitivity makes scaffold outrank hint. |
| Prior incorrect + help/confusion + repeated=1 | `ACTION_GIVE_HINT` | hint, scaffold, worked example, dynamic hint, slower pace, skip all score `1`; hint inserted first. |
| Misconception + help/confusion + repeated=3 | `ACTION_GIVE_HINT` | same saturation and insertion-order tie. |
| Non-response `...` + unknown + repeated=3 | `ACTION_GIVE_HINT` | hint/scaffold/worked/bottom-out/dynamic/slower/break/skip all score `1`; hint inserted first. |
| Off-task/break request + previous unknown | `ACTION_GIVE_HINT` | hint/scaffold saturate before break/check-in can win. |

For the requested case `supportNeed = 1` and `repeatedIncorrectOnCurrentStep >= 3`, hint, scaffold, worked example, and dynamic hint can all tie at score `1`. `GIVE_HINT` wins because `scoreActionCandidates()` pushes `GIVE_HINT` before `GIVE_SCAFFOLD`, `PROVIDE_WORKED_EXAMPLE`, and `CALL_DYNAMIC_HINT`.

## Hint, Scaffold, and Worked Example Handling

`selectHint()` in `tutorOrchestrator.js` selects:

```text
hintIndex = min(max(repeatedIncorrectOnCurrentStep - 1, 0), hints.length - 1)
```

So first incorrect response leads to hint index 0 on the next turn, second to hint index 1, and so on. After the final hint, the final hint is repeated indefinitely. Hints can be objects; `summarizeHint()` preserves only `type`, `title`, and `text`, not nested `scaffold.expectedAnswers`.

`canUseScaffold` is true when any hint has `type === "scaffold"` or a `scaffold` object. This capability allows both `GIVE_SCAFFOLD` and `PROVIDE_WORKED_EXAMPLE`; there is no separate worked-example data field in the lesson and no automatic hint -> scaffold -> worked-example transition.

For problem 04:

| Problem ID | Original expected answer | Validation mode | Hints | Scaffold data | Worked example data | Risk |
| --- | --- | --- | --- | --- | --- | --- |
| `problem_04_check_ordered_pair_not_solution_step_01` | `no` | `normalized_string_equality` | 2 plain hints, then 3 scaffold hints | scaffold 1 expects arithmetic `17`; scaffold 2 expects arithmetic `15`; scaffold 3 expects string `no` | none explicit | High: scaffold 1 asks for `17`, but validation still expects original answer `no`, so a correct scaffold answer is marked incorrect. Final scaffold can repeat indefinitely. |

Other scaffold-bearing examples include problem 07 hint 2 expecting `6`, problem 08 hint 2 expecting `6`, problem 11 hint 1 expecting `-30`, and problem 12 hint 1 expecting `10`. In all cases the orchestrator validates against the original step passed to `validateAnswer()`, not the nested scaffold object.

## Rendering Behaviour

`planTutorTurn()` maps support actions (`GIVE_HINT`, `GIVE_SCAFFOLD`, `PROVIDE_WORKED_EXAMPLE`, `GIVE_BOTTOM_OUT`, `CALL_DYNAMIC_HINT`) to the same selected-hint inclusion mechanism. `buildRequiredContent()` includes:

```text
current_problem_material = current step title
current_step_body = current step body
selected_hint = selectedHint only if support action
response_instruction = choices => "Choose one: ..."; arithmetic => "What is your answer?"; otherwise "What do you think?"
```

The original problem title is required for every response-expecting plan. Choices are not directly inserted as separate content, but `getResponseInstruction()` includes them if `currentStep.choices` exist. The selected hint text can be identical across repeated attempts once hint selection reaches the final hint.

The renderer builds a structured contract and asks the teacher-message LLM to instantiate it. `validateTeacherMessage()` checks non-empty length and required active problem material, but it does not check hint inclusion, exact choice inclusion, previous message duplication, action-text consistency, or scaffold validation alignment.

Example skeletons from `createMessageSkeleton()`:

| Case | Skeleton behavior |
| --- | --- |
| `GIVE_HINT` after first incorrect answer on problem 04 | `Not quite yet. Determine whether ... 5x-4y=20, 2x+1=3y Plug the point into the first equation ... Choose one: yes or no.` |
| `GIVE_HINT` after hints exhausted on problem 04 | repeats final selected hint: `If the LHS doesn't equal the RHS, is our point a solution?` with original problem and `Choose one: yes or no.` |
| `GIVE_SCAFFOLD` | same selected-hint mechanism as hint; only `type` says scaffold. Nested scaffold expected answer is omitted from plan. |
| `PROVIDE_WORKED_EXAMPLE` | also uses selected hint text; no worked-example content is supplied. |
| `REQUEST_CHECKIN` | no support hint; instructional action is check-in, current problem still required, response instruction included. |
| `SUGGEST_BREAK` | modifier is `suggest_short_break_briefly`; instructional action becomes continue standard, current problem still required. |

## Validation and Feedback Loop Analysis

`validateAnswer()` normalizes the original current step in `normalizeQuestionSpec()`, selects validation input in `resolveValidationInput()`, classifies it in `classifyAnswer()`, and returns category/correctness. In the orchestrator, it is always called with `questionSpec: step`, where `step` is the original lesson step. Nested `selectedHint.scaffold` is not passed as the validation target.

`repeatedIncorrectOnCurrentStep` is a local variable in `runTutorExperimentSession()`. It resets to `0` only when `validationResult.isCorrect` advances the lesson step. It increments for every non-correct result, including `unknown`, `incorrect`, `misconception`, and `partially_correct`. It does not reset after scaffold prompts because scaffold prompts are not separate subtasks in progression state.

The loop currently exists:

```text
incorrect/non-response
-> validationResult.isCorrect false
-> repeatedIncorrectOnCurrentStep increments
-> next turn supportNeed/reviewNeed/pacingPressure rise or saturate
-> enhanced support/pacing actions saturate at score 1
-> GIVE_HINT wins score ties by insertion order
-> selectHint clamps to final hint after exhaustion
-> planner reuses final hint text and original validation target
-> student answers scaffold subtask or non-response
-> original validation remains incorrect/unknown
```

Responsible functions: `runTutorExperimentSession()`, `selectHint()`, `buildTaskContext()`, `computePolicySignals()`, `scoreActionCandidates()`, `applyConditionConstraints()`, `selectHighestScoringAction()`, `planTutorTurn()`, and `validateAnswer()`.

## Psychological Realism Assessment

| Principle | Current implementation fit | Evidence | Recommended change |
| --- | --- | --- | --- |
| Mild confusion should usually trigger low-level hints. | Weak fit. | Mild help/confusion can select scaffold because scaffold formula plus 1.35 sensitivity outranks hint. | Raise scaffold threshold or add low-confusion hint preference. |
| Repeated incorrect attempts should escalate from hints to scaffolds. | Brittle. | Scaffold score rises, but ties at 1 lose to hint. | Add explicit repeated-failure priority ladder. |
| Persistent failure after scaffolding should trigger worked examples/task simplification. | Poor fit. | Worked example can tie but lacks content and loses order ties. | Add worked-example content and post-scaffold escalation. |
| Non-response/disengagement should trigger check-in/pacing/regulation. | Poor fit. | Non-response repeated=3 selects hint despite break/slower pace also scoring 1. | Prioritize check-in/break for unknown/non-answer + disengagement. |
| High monotony should encourage variation/choice/break. | Partial only. | Enhanced has no hidden/estimated monotony signal; state-aware does. Off-task cues can boost variation but often lose to hint. | Add visible monotony/repetition features or use state-aware estimate. |
| High support need should not always mean another hint. | Poor fit. | Support saturation and insertion order make hint a common winner. | Split cognitive support need from regulatory need and add cooldowns. |
| Scaffold prompts should align with validation targets. | Poor fit. | Nested scaffold expected answers are ignored by validation. | Represent scaffold as active substep or validation override. |
| Repetition of identical rendered tutor text is failure. | Not handled. | Final hint repeats indefinitely; renderer has no dedupe check. | Store previous tutor text/action and penalize or regenerate. |

## Redesign Options

| Option | Code complexity | Psychological realism | Risk | Best use |
| --- | --- | --- | --- | --- |
| A. Minimal parameter recalibration | Low | Moderate | Still score/tie brittle | Quick experiment stabilization without architecture changes. |
| B. Escalation ladder | Medium | High for repeated failure | Requires state/action history | Dissertation condition focused on support sequencing. |
| C. State-based policy | Medium-high | High if states validated | More design/testing burden | Clear psychological modelling of SEND-aligned learner states. |
| D. Hybrid score + escalation | Medium | High | Requires careful priority tests | Best fit for current codebase: preserves scoring but fixes known failure modes. |

### Option A: Minimal Parameter Recalibration

Suggested starting values: `scaffolding: 1.05`, `pacing: 1.15`, `affect: 1.2`; raise `confusion` to `0.50`; keep `remediate` around `0.75`; reduce enhanced support boost from `0.28` to `0.12`; add small negative term to hint for `repeatedIncorrectCount >= 2`. This reduces saturation but does not fix validation mismatch.

### Option B: Escalation Ladder

Add explicit priority:

```text
first incorrect or mild confusion -> hint
second incorrect or misconception -> scaffold if scaffold available
third incorrect after scaffold -> worked example or bottom-out
unknown/non-answer + disengagement -> request check-in or suggest break
hint exhausted -> never choose same hint again; escalate or reframe
```

### Option C: State-Based Policy

Map visible patterns to states:

| State | Pattern | Preferred actions |
| --- | --- | --- |
| Productive struggle | non-minimal, incorrect/partial, low frustration | hint or targeted scaffold |
| Confusion | help/confusion phrases, prior incorrect | hint then scaffold |
| Cognitive overload | repeated incorrect, low progress, frustration | worked example, slower pace |
| Disengagement | ellipsis/non-answer/break language | check-in, break, choice |
| Careless guessing | short wrong repeated answers | reframe, ask reasoning/check-in |
| Low confidence | `can't`, help, low frustration | encouragement + scaffold |
| Off-task/monotony | boring/switch/repetitive | offer choice, reframe, break |

### Option D: Hybrid Score + Escalation Policy

Keep scores, then apply deterministic post-processing:

```text
if non-answer/unknown + disengaged/offTask: prioritize REQUEST_CHECKIN/SUGGEST_BREAK
else if repeatedIncorrect >= 3 and scaffold already used: PROVIDE_WORKED_EXAMPLE
else if repeatedIncorrect >= 2 and scaffold available: GIVE_SCAFFOLD
else if hint exhausted: escalate, do not repeat final hint
else select score winner with priority list [check-in, break, scaffold, worked, hint] depending on state
```

Add action cooldowns, previous rendered-text dedupe, and scaffold validation overrides.

## Recommended Parameter/Architecture Changes

1. Add explicit enhanced tie-break priorities in `selectPolicyAction()` for non-baseline conditions.
2. Track previous selected actions and selected hint IDs in teacher/progression context.
3. Prevent final hint repetition after `repeatedIncorrectOnCurrentStep > hints.length`.
4. Split `supportNeed` into cognitive help need and regulatory support need so non-response does not become hint-first.
5. Add scaffold subtask state: when a selected hint has `scaffold`, validate against `selectedHint.scaffold` until passed or abandoned.
6. Add real `workedExample` content to lesson schema or prevent `PROVIDE_WORKED_EXAMPLE` when no worked example exists.
7. Make dynamic hints genuinely dynamic or disable `CALL_DYNAMIC_HINT`.
8. Use configured cooldowns or remove them from specs to avoid misleading condition documentation.
9. Add rendered-message repetition checks in `teacherMessageRenderer.js` or pre-render planning.

## Required Regression Tests

| Test | File | Setup | Expected |
| --- | --- | --- | --- |
| `enhanced does not repeat final hint after exhaustion` | `test/teacher-runtime.test.js` or new `test/enhanced-policy.test.js` | problem 04, repeated incorrect > hint count | selected action escalates or selected hint changes; final hint not reused indefinitely. |
| `enhanced repeated incorrect escalates to scaffold` | same | repeated=2, scaffold available | `ACTION_GIVE_SCAFFOLD`, not hint tie-order. |
| `enhanced persistent failure escalates to worked example` | same | repeated>=3 after scaffold used, worked example available | `ACTION_PROVIDE_WORKED_EXAMPLE` or explicit bottom-out. |
| `scaffold uses scaffold validation target` | `test/validation-runtime.test.js` plus orchestrator test | problem 04 scaffold asking LHS with answer `17` | validation correct against scaffold target, not incorrect against original `no`. |
| `non-response triggers regulation` | `test/teacher-runtime.test.js` | text `...`, previous unknown, repeated>=2 | `REQUEST_CHECKIN` or `SUGGEST_BREAK`, not hint. |
| `high monotony/off-task increases variation` | same | repeated boring/switch responses | `OFFER_CHOICE` or `REFRAME_PROMPT_VARIANT` beats cognitive hint when no content attempt. |
| `tied scores use escalation priority` | same | mocked context causing hint/scaffold/worked/dynamic scores all 1 | selected action follows explicit priority, not insertion order. |
| `rendered tutor text dedupes` | renderer/planner test | same action and same selected hint twice | second plan/render differs or policy escalates. |
| `enhanced differs from baseline explainably` | same | repeated incorrect and off-task cases | baseline uses count-only sequence; enhanced uses cue/state-specific action. |

Existing tests cover baseline count sequence, enhanced candidate inclusion, preservation of validation category in signals, planner praise behavior, renderer field variants, and mocked full run. Missing tests are the repeated-hint loop, enhanced tie-breaking, scaffold validation override, action cooldowns, and render deduplication.

## Open Questions / Missing Evidence

1. What should count as a psychologically valid scaffold completion: answer to the scaffold subtask, original answer, or either?
2. Should `PROVIDE_WORKED_EXAMPLE`, `GIVE_BOTTOM_OUT`, and `CALL_DYNAMIC_HINT` be enabled unless lesson content/generator support exists?
3. Should enhanced sensitivity use hidden ARM values? Current cue extraction does not; only `state_aware` uses a visible state estimate.
4. How many repeated attempts should be allowed before break/check-in/task reset for SEND-aligned behavior?
5. Should monotony be inferred from visible repeated tutor text/action history in enhanced sensitivity, or reserved for state-aware condition?
6. Should cooldowns be condition parameters if the current policy does not enforce them?
