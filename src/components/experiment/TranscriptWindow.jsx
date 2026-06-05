"use client";

import { useEffect, useRef } from "react";
import TranscriptMessage from "./TranscriptMessage";

export default function TranscriptWindow({
  error,
  condition,
  lessonPlan,
  status,
  transcript
}) {
  const bottomRef = useRef(null);

  useEffect(() => {
    if (transcript.length > 0) {
      bottomRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
    }
  }, [status, transcript]);

  return (
    <section className="panel transcriptPanel" aria-labelledby="transcript-title">
      <div className="panelHeader transcriptHeader">
        <div>
          <p className="fieldLabel">Public interaction</p>
          <h2 id="transcript-title">Teacher-student transcript</h2>
        </div>
        <div className="transcriptSelection">
          <span>{condition?.label || "No condition selected"}</span>
          <span>{lessonPlan?.label || "No lesson plan selected"}</span>
        </div>
      </div>

      <div className="transcriptWindow" aria-live="polite">
        {status === "idle" ? (
          <div className="transcriptState">
            Configure a condition and lesson plan, then start an experiment.
          </div>
        ) : null}
        {status === "running" ? (
          <div className="transcriptState runningState">
            Simulation running. The transcript will appear when the run completes.
          </div>
        ) : null}
        {status === "error" ? (
          <div className="transcriptState errorState">{error || "The experiment failed."}</div>
        ) : null}
        {status === "complete" && transcript.length === 0 ? (
          <div className="transcriptState">
            The experiment did not produce a transcript. Try running it again.
          </div>
        ) : null}
        {transcript.map((message) => (
          <TranscriptMessage key={message.id} message={message} />
        ))}
        <div ref={bottomRef} />
      </div>
    </section>
  );
}
