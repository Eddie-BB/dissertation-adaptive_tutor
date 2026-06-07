"use client";

import {
  buildExperimentMarkdown,
  markdownFileNameForRun
} from "../../lib/experiments/experimentMarkdownReport";

function downloadMarkdown(output) {
  const markdown = buildExperimentMarkdown(output);
  const runId = output?.runMetadata?.runId || "experiment-session";
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = markdownFileNameForRun(runId);
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function ExperimenterOutputPanel({ output, status }) {
  if (status !== "complete" || !output) {
    return null;
  }

  return (
    <section className="panel experimenterOutputPanel" aria-labelledby="experimenter-output-title">
      <div className="panelHeader outputHeader">
        <div>
          <p className="fieldLabel">Post-session output</p>
          <h2 id="experimenter-output-title">Download final report</h2>
        </div>
        <div className="outputActions">
          <button
            className="secondaryButton exportButton"
            onClick={() => downloadMarkdown(output)}
            type="button"
          >
            Download Markdown
          </button>
          <span className="statusPill complete">complete</span>
        </div>
      </div>
      <p className="helpText">
        The complete final results, transcript, validation outcomes, ARM values, and condition-appropriate cue/state estimates are exported as a Markdown document.
      </p>
    </section>
  );
}
