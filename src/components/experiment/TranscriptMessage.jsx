"use client";

export default function TranscriptMessage({ message }) {
  return (
    <article className={`transcriptMessage ${message.role}`}>
      <div className="messageMeta">
        <span>Turn {message.turn}</span>
        <strong>{message.role === "tutor" ? "Tutor" : "Student"}</strong>
      </div>
      <p>{message.text}</p>
    </article>
  );
}
