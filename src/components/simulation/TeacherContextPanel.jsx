"use client";

import MathText from "./MathText";

export default function TeacherContextPanel({ context, error }) {
  if (error) {
    return (
      <section className="panel detailPanel">
        <div className="panelHeader">
          <h2>Teacher Context</h2>
        </div>
        <p className="errorText">{error}</p>
      </section>
    );
  }

  if (!context) {
    return (
      <section className="panel detailPanel">
        <div className="panelHeader">
          <h2>Teacher Context</h2>
        </div>
        <p className="mutedText">Choose a lesson, problem, and step.</p>
      </section>
    );
  }

  return (
    <section className="panel detailPanel teacherPanel">
      <div className="panelHeader">
        <h2>Teacher Context</h2>
      </div>
      <div className="contentStack">
        <div>
          <p className="fieldLabel">Lesson</p>
          <p className="bodyText">
            {context.courseName} · {context.lessonLabel}
          </p>
        </div>
        <div>
          <p className="fieldLabel">Problem</p>
          <MathText as="p" className="bodyText" text={context.problemTitle} />
          {context.problemBody ? (
            <MathText as="p" className="secondaryText" text={context.problemBody} />
          ) : null}
        </div>
        <div>
          <p className="fieldLabel">Current Step</p>
          <MathText as="p" className="bodyText" text={context.currentStep.stepTitle} />
          {context.currentStep.stepBody ? (
            <MathText
              as="p"
              className="secondaryText"
              text={context.currentStep.stepBody}
            />
          ) : null}
        </div>
        <div className="tagRow">
          <span>Step {context.currentStep.index + 1}</span>
          <span>{context.currentStep.answerType}</span>
          {context.currentStep.knowledgeComponents.map((kcId) => (
            <span key={kcId}>{kcId}</span>
          ))}
        </div>
        <div>
          <p className="fieldLabel">Available Hints</p>
          <ol className="hintList">
            {context.currentStep.availableHints.map((hint) => (
              <li key={hint.index}>
                <MathText text={hint.text} />
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
