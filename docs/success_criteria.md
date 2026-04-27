# Success Criteria

Success is defined at three levels: **student model validity**, **teacher policy effectiveness**, and **simulation-level evaluation quality**.

---

## 1. Student Model Success Criteria

The student model must produce **internally coherent, psychologically plausible, and experimentally useful behaviour**.

### 1.1 Appraisal Accuracy (ARM Computation)

- The appraisal system reliably converts **teacher messages -> ARM values (A, R, M)**.
- ARM scoring reflects:
  - variation in instructional style (e.g. scaffold vs repetition);
  - differences in encouragement, clarity, and autonomy;
  - sensitivity to repeated structure across turns (monotony accumulation).
- Identical or near-identical teacher messages produce **consistently similar ARM outputs**.
- Distinct teacher strategies produce **meaningfully different ARM profiles**.

**Success indicator:**
- ARM values vary systematically with teacher message features, not randomly.

---

### 1.2 Behavioural Coherence

- Behaviour selection is **directly driven by ARM values**.
- The mapping from `(A, R, M)` -> behaviour produces expected outcomes:
  - High A + high R + low M -> engaged attempt
  - Moderate A + low R -> minimal compliance
  - Low A + high M -> disengagement or off-task behaviour
- Behaviour probabilities shift smoothly rather than erratically across turns.

**Success indicator:**
- Behaviour distributions align with theoretical expectations of engagement dynamics.

---

### 1.3 Temporal Realism (State Dynamics)

- Attention evolves over time in a **non-static, cumulative way**:
  - decreases under sustained monotony;
  - stabilises or increases under high reward;
- Behaviour transitions are **gradual and plausible**, not abrupt without cause.
- Early-turn behaviour differs from late-turn behaviour when conditions change.

**Success indicator:**
- Engagement trajectories show realistic patterns (e.g. gradual disengagement under poor teaching).

---

### 1.4 Inter-Student Variability

- Different students (via randomised parameters) respond differently to the same teacher input.
- Sensitivity parameters produce:
  - high-variance engagement profiles across runs;
  - consistent within-student behaviour patterns across turns.

**Success indicator:**
- Simulation captures heterogeneous learner responses, not a single deterministic pattern.

---

## 2. Teacher Model Success Criteria

The teacher must demonstrate **functional instructional control and condition-specific adaptation**.

---

### 2.1 Instructional Progression

- Teacher can successfully guide the student through:
  - task steps;
  - problem-solving progression;
  - completion of lesson objectives.
- Teacher maintains logical sequencing of actions (e.g. explanation -> attempt -> feedback).

**Success indicator:**
- Students progress through tasks in most runs under all conditions.

---

### 2.2 Response Interpretation

#### Condition 1 (Baseline)

- Teacher correctly interprets:
  - answer correctness;
  - task completion state.

#### Condition 3 (State-Aware)

- Teacher can infer:
  - possible confusion (unclear responses);
  - disengagement (minimal or off-task responses);
  - repetition fatigue (declining response quality).

**Success indicator:**
- Teacher actions differ meaningfully depending on student response patterns.

---

### 2.3 Action Selection Quality

- Teacher selects actions that are **contextually appropriate**, including:
  - scaffolding when confusion is detected;
  - encouragement when effort is shown;
  - variation when monotony is likely;
  - continuation when progress is smooth.
- Action selection reflects condition logic:
  - baseline = standard progression;
  - enhanced sensitivity = earlier/more frequent support;
  - state-aware = targeted adaptive intervention.

**Success indicator:**
- Action distributions differ across conditions in expected ways.

---

### 2.4 Natural Language Quality

- Teacher messages:
  - align with selected action;
  - are coherent and instructionally meaningful;
  - vary in structure and tone across turns;
  - avoid excessive repetition unless condition dictates.

**Success indicator:**
- Messages are interpretable, varied, and suitable for appraisal analysis.

---

## 3. Simulation-Level Success Criteria

The simulation must produce **valid, comparable, and interpretable experimental outputs**.

---

### 3.1 ARM Sensitivity to Conditions

- Different teacher conditions produce **distinct ARM trajectories**:
  - enhanced sensitivity -> higher average reward;
  - state-aware -> reduced monotony over time;
  - baseline -> more neutral or declining engagement.

**Success indicator:**
- Statistically distinguishable differences in A, R, M across conditions.

---

### 3.2 Behaviour Distribution Validity

- Each condition produces **distinct behaviour distributions**, e.g.:
  - baseline -> higher minimal compliance;
  - enhanced sensitivity -> more engaged attempts;
  - state-aware -> reduced disengagement.

**Success indicator:**
- Behaviour proportions shift meaningfully between conditions.

---

### 3.3 Action Distribution Validity

- Teacher actions vary across conditions:
  - baseline dominated by standard continuation;
  - enhanced sensitivity includes more scaffolding and praise;
  - state-aware includes targeted interventions.

**Success indicator:**
- Action frequencies reflect condition design.

---

### 3.4 Turn-Level Traceability

- Every turn includes:
  - teacher action;
  - teacher message;
  - student response;
  - A_t, R_t, M_t;
  - behaviour label.
- Hidden and public logs remain correctly separated.

**Success indicator:**
- Full traceability from teacher input -> student output -> internal state.

---

### 3.5 Reproducibility

- Simulation produces consistent results when:
  - using the same seed;
  - using identical parameters.

**Success indicator:**
- Runs are repeatable with minimal stochastic drift.

---

### 3.6 Experimental Usability

- Outputs support:
  - condition comparison;
  - statistical analysis;
  - visualisation of engagement trajectories;
  - interpretation of teacher effectiveness.

**Success indicator:**
- Data can be directly used for dissertation analysis without major restructuring.

---

## 4. Overall Success Definition

The simulation is considered successful if:

- Student behaviour is **plausible, dynamic, and sensitive to teaching style**;
- Teacher policies produce **distinct and interpretable effects on engagement**;
- ARM values provide a **valid intermediate representation linking teaching to behaviour**;
- Outputs enable **clear comparison between experimental conditions**.

The system should function as a **pre-deployment testing environment** where instructional strategies can be evaluated before real-world application.
