# Frontend Simulation Content Integration Plan

## Purpose

This plan describes how to begin implementing a simulation-ready Next.js frontend using the generated OATutor lesson templates in:

```text
content/oatutor_lesson_templates/
```

The immediate goal is not to run the full adaptive simulation. The first goal is to establish a stable content layer that can load lessons, problems, steps, hints, knowledge components, BKT parameters, and validation metadata into frontend components without leaking hidden simulation state.

---

## Guiding Principles

- Treat the generated lesson templates as the first stable frontend content contract.
- Keep filesystem access server-side only.
- Do not import raw OATutor repositories into React client components.
- Do not expose hidden ARM values, behaviour labels, or researcher logs to teacher-facing UI.
- Build content inspection first, then simulation execution.
- Keep the first implementation minimal and deterministic.

---

## Existing Content Inputs

Generated lesson templates:

```text
content/oatutor_lesson_templates/index.json
content/oatutor_lesson_templates/build-report.json
content/oatutor_lesson_templates/openstax_precalculus_composition_of_functions.json
content/oatutor_lesson_templates/openstax_precalculus_fitting_linear_models.json
content/oatutor_lesson_templates/openstax_elementary_algebra_multiply_polynomials.json
```

Each lesson file includes:

- course metadata
- lesson metadata
- condition metadata
- problems
- ordered steps
- expected answers
- validation metadata
- hints and hint dependencies
- knowledge components
- BKT parameters
- teacher-facing context template

---

## Target Frontend Architecture

Recommended structure:

```text
app/
  api/
    content/
      lessons/
        route.js
      lessons/[lessonId]/
        route.js
      teacher-context/
        route.js
  page.js

src/
  server/
    content/
      lessonTemplateStore.js
      teacherContextBuilder.js
      simulationProblemMapper.js
  components/
    simulation/
      LessonSelector.jsx
      ProblemSelector.jsx
      StepInspector.jsx
      TeacherContextPanel.jsx
      DebugMetadataPanel.jsx
      SimulationConsole.jsx
```

If the project remains JavaScript-only, use `.js` / `.jsx`. Do not introduce TypeScript unless the project is already being migrated.

---

## Phase 1: Content Store

### Goal

Create a server-side loader that reads generated lesson templates and exposes safe lookup functions.

### Files To Create

```text
src/server/content/lessonTemplateStore.js
```

### Required Functions

```js
getLessonIndex()
getLessonById(lessonId)
getLessonByFile(fileName)
getProblemById(lessonId, problemId)
getStepByIndex(lessonId, problemId, stepIndex)
```

### Requirements

- Read from `content/oatutor_lesson_templates`.
- Load `index.json` first.
- Resolve lesson files by `lessonId`.
- Validate file names against `index.json`.
- Never accept arbitrary filesystem paths from the client.
- Return clear errors when lesson/problem/step IDs are invalid.

### Validation

- `getLessonIndex()` returns three lessons.
- Each lesson can be loaded by `lessonId`.
- Each lesson has at least one problem.
- Each problem has ordered steps.
- Each step has validation metadata and expected answers.

---

## Phase 2: Content API Routes

### Goal

Expose lesson content to frontend components through Next.js API routes.

### Files To Create

```text
app/api/content/lessons/route.js
app/api/content/lessons/[lessonId]/route.js
```

### Endpoint 1

```text
GET /api/content/lessons
```

Returns lightweight lesson index:

```json
{
  "lessons": [
    {
      "lessonId": "...",
      "lessonLabel": "...",
      "courseName": "...",
      "problemCount": 3,
      "stepCount": 6,
      "knowledgeComponentCount": 1
    }
  ]
}
```

### Endpoint 2

```text
GET /api/content/lessons/:lessonId
```

Returns full lesson template.

### Requirements

- Use server-side loader only.
- Return JSON responses.
- Return `404` for missing lessons.
- Do not expose absolute local filesystem paths unless in debug-only metadata.

### Validation

- Browser or API client can load lesson list.
- Selecting a lesson loads its full template.
- No server-only code is imported into client components.

---

## Phase 3: Teacher-Facing Context Builder

### Goal

Create a reduced context object that contains only what the teacher agent is allowed to see.

### Files To Create

```text
src/server/content/teacherContextBuilder.js
app/api/content/teacher-context/route.js
```

### Request Shape

```json
{
  "lessonId": "openstax_pre_calculus__1_4_composition_of_functions",
  "problemId": "a005bd5real1",
  "stepIndex": 0,
  "studentProgress": {
    "attemptsOnCurrentStep": 0,
    "previousIncorrectAnswers": [],
    "visibleStudentHistory": []
  }
}
```

### Response Shape

```json
{
  "teacherContext": {
    "courseName": "...",
    "lessonLabel": "...",
    "problemTitle": "...",
    "problemBody": "...",
    "currentStep": {
      "id": "...",
      "index": 0,
      "stepTitle": "...",
      "stepBody": "...",
      "answerType": "...",
      "availableHints": [
        {
          "index": 0,
          "text": "..."
        }
      ],
      "knowledgeComponents": ["..."]
    },
    "studentProgress": {
      "currentStepIndex": 0,
      "attemptsOnCurrentStep": 0,
      "previousIncorrectAnswers": [],
      "visibleStudentHistory": []
    }
  },
  "debug": {
    "expectedAnswers": ["..."],
    "validation": {},
    "bkt": {},
    "hintDependencies": []
  }
}
```

### Hidden-State Boundary

Teacher-facing context must not include:

- `A_t`
- `R_t`
- `M_t`
- behaviour labels
- hidden appraisal logs
- hidden behaviour logs
- researcher logs

Expected answers may appear only inside the `debug` object.

### Validation

- Teacher context contains lesson, problem, step, hints, and KC IDs.
- Debug panel contains expected answers and BKT metadata.
- Teacher-facing context does not contain hidden simulation state.

---

## Phase 4: Initial Frontend Components

### Goal

Build a minimal simulation content console.

### Files To Create

```text
src/components/simulation/SimulationConsole.jsx
src/components/simulation/LessonSelector.jsx
src/components/simulation/ProblemSelector.jsx
src/components/simulation/StepInspector.jsx
src/components/simulation/TeacherContextPanel.jsx
src/components/simulation/DebugMetadataPanel.jsx
```

### Component Responsibilities

`LessonSelector`

- Fetches `/api/content/lessons`.
- Displays lesson label, course name, problem count, and step count.
- Updates selected lesson ID.

`ProblemSelector`

- Receives loaded lesson template.
- Lists problems by title and ID.
- Updates selected problem ID.

`StepInspector`

- Displays current step title, body, answer type, and hints.
- Allows step index selection.

`TeacherContextPanel`

- Calls `/api/content/teacher-context`.
- Displays teacher-visible context only.

`DebugMetadataPanel`

- Displays expected answers, validation metadata, KC IDs, BKT params, and hint dependencies.
- Clearly separate from teacher-facing context.

`SimulationConsole`

- Coordinates selected lesson, problem, and step.
- Holds debug toggle state.
- Provides the main content-testing interface.

### Validation

- User can select a lesson.
- User can select a problem.
- User can select a step.
- Teacher-facing context updates.
- Debug metadata updates.
- UI works before simulation runner integration.

---

## Phase 5: Template To Simulation Problem Mapper

### Goal

Prepare generated lesson-template problems for the existing simulation runner.

### File To Create

```text
src/server/content/simulationProblemMapper.js
```

### Required Function

```js
templateProblemToSimulationProblem(templateLesson, templateProblem)
```

### Mapping

```text
templateProblem.id              -> problem.id
templateProblem.title           -> problem.title
templateProblem.body            -> problem.body
templateLesson.lesson.lessonId  -> problem.lessonId
templateLesson.lesson.lessonLabel -> problem.lesson
templateProblem.steps[].expectedAnswers -> step.stepAnswer
templateProblem.steps[].hints   -> step.hints.DefaultPathway
templateProblem.steps[].knowledgeComponents[].kcId -> step.knowledgeComponents
```

### Requirements

- Preserve `answerType`.
- Preserve `problemType`.
- Preserve `variabilization`.
- Preserve `precision`.
- Convert hint dependency indexes back into the shape expected by the runner if needed.
- Do not mutate the source template object.

### Validation

- Mapped problem works with existing simulation runner shape.
- All steps retain answers, hints, KCs, and validation metadata.

---

## Phase 6: One-Turn Simulation Integration

### Goal

Connect selected content to the simulation runner for one deterministic turn.

### Future API Route

```text
POST /api/simulation/run-one-turn
```

### Request Shape

```json
{
  "lessonId": "...",
  "problemId": "...",
  "conditionId": "oatutor_baseline",
  "stepIndex": 0,
  "seed": "demo-seed-v1",
  "studentAppraisalMode": "deterministic"
}
```

### Response Shape

```json
{
  "success": true,
  "publicTurn": {
    "teacherMessage": "...",
    "studentMessage": "...",
    "teacherAction": "..."
  },
  "debug": {
    "studentBehaviourLabel": "...",
    "A_t": 0.5,
    "R_t": 0.5,
    "M_t": 0.5
  }
}
```

### Requirements

- Use deterministic/mock mode first.
- Keep hidden values in debug only.
- Do not expose hidden values in teacher-facing panels.

---

## Phase 7: Full Session And Condition Comparison

### Goal

After one-turn simulation works, expose full session runs and condition comparison.

### Future Routes

```text
POST /api/simulation/run-session
POST /api/simulation/compare-conditions
```

### Required Outputs

- public transcript
- researcher/debug log
- behaviour distribution
- action distribution
- average `A_t`, `R_t`, `M_t`
- engagement trend over turns

### Validation

- Same seed gives repeatable results.
- Different conditions produce different action distributions.
- Public and hidden logs remain separated.

---

## Minimal First Milestone

The first complete milestone is:

- `/api/content/lessons` works.
- `/api/content/lessons/:lessonId` works.
- `/api/content/teacher-context` works.
- UI can select lesson, problem, and step.
- UI displays teacher-facing context.
- UI displays debug metadata separately.
- No simulation runner is required yet.

This milestone proves that the frontend can consume simulation-compatible OATutor lesson content safely.

---

## Agent Checklist

Use this checklist while implementing:

- [ ] Read generated lesson templates before coding.
- [ ] Create server-side content loader.
- [ ] Add lesson index API route.
- [ ] Add full lesson API route.
- [ ] Add teacher-context builder.
- [ ] Build minimal content console components.
- [ ] Keep debug metadata separate.
- [ ] Verify no hidden simulation state leaks into teacher-facing context.
- [ ] Run `npm run build`.
- [ ] Manually test selecting all three lesson templates.

---

## Notes

- Figure rendering is not required. Preserve or display figure markers as text.
- LaTeX rendering is not required in the first pass. Preserve raw strings.
- Dynamic hints are not required in the first pass.
- Firebase, Canvas, LTI, and AWS dependencies are not required.
- KAS-backed symbolic validation can be added later; first expose validation metadata only.
