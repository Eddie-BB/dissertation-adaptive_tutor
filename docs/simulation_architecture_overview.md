# Simulation Architecture Overview

## 1. Purpose

This simulation models student behaviour during tutoring interactions by using an Attention–Reward–Monotony framework. The goal is to test how different teacher action policies affect student engagement over repeated instructional turns.

The simulation is designed as a controlled agent-to-agent environment where:

- the teacher guides the student through lesson content;
- the student responds based on latent engagement dynamics;
- teacher messages are analysed for attention, reward, and monotony effects;
- student behaviour is generated from these latent values;
- experimental conditions change how the teacher selects actions.

---

## 2. Core Simulation Logic

Each simulation turn follows this sequence:

1. Teacher selects an instructional action.
2. Teacher generates a message.
3. Student appraises the message.
4. ARM values are calculated:
   - Attention (A)
   - Reward (R)
   - Monotony (M)
5. Student state updates.
6. Behaviour is sampled.
7. Student generates response.
8. Logs are recorded.

---

## 3. Student Model

Each student is initialised with semi-randomised parameters:

- Base attention
- Monotony sensitivity
- Reward sensitivity
- Behavioural variability

Latent state variables:

- A_t (attention)
- R_t (reward)
- M_t (monotony)

---

## 4. Behaviour Generation

Behaviour categories:

- ENGAGED_ATTEMPT
- MINIMAL_COMPLIANCE
- HELP_SEEKING_CONFUSION
- CARELESS_GUESS
- OFF_TASK_BEHAVIOUR
- DISENGAGED_NON_RESPONSE

Behaviour is determined by mapping (A, R, M) to a probability distribution.

---

## 5. Teacher Model

The teacher:

- Guides student through content
- Selects actions based on observable features only
- Cannot access hidden student state

---

## 6. Experimental Conditions

### Condition 1: OATutor Baseline
- Uses original OATutor logic
- Minimal adaptation

### Condition 2: Enhanced Sensitivity
- Increased likelihood of adaptive actions
- More scaffolding, encouragement, variation

### Condition 3: State-Aware
- Teacher estimates A, R, M from student responses
- Uses estimates to guide actions

---

## 7. LLM Role

Used for:

- Analysing teacher messages (ARM scoring)
- Generating student responses
- Generating teacher messages
- Estimating student state (Condition 3)

---

## 8. Information Boundary

Teacher sees:
- Student text
- Dialogue history

Hidden (research logs):
- A, R, M values
- Behaviour labels
- Internal state

---

## 9. Outputs

### Per-turn:
- Teacher action
- Teacher message
- Student response
- A_t, R_t, M_t
- Behaviour

### Aggregate:
- Behaviour distribution
- Action distribution
- Average A, R, M
- Engagement trends

---

## 10. Summary

The system evaluates how different teacher policies affect engagement using a controlled simulation with latent psychological modelling and observable behavioural outputs.
