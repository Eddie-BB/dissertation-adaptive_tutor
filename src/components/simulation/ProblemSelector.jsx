"use client";

export default function ProblemSelector({ lesson, selectedProblemId, onSelectProblem }) {
  const problems = lesson?.problems || [];

  return (
    <section className="panel">
      <div className="panelHeader">
        <h2>Problems</h2>
      </div>
      <div className="optionStack">
        {problems.map((problem) => (
          <button
            className={`compactOption ${
              problem.id === selectedProblemId ? "selected" : ""
            }`}
            key={problem.id}
            onClick={() => onSelectProblem(problem.id)}
            type="button"
          >
            <span className="optionTitle">{problem.title || problem.id}</span>
            <span className="optionMeta">
              {problem.id} · {problem.stepCount || problem.steps?.length || 0} step
              {(problem.stepCount || problem.steps?.length) === 1 ? "" : "s"}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
