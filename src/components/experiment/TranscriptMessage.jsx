"use client";

function stripMathDelimiters(value) {
  return String(value || "")
    .replace(/\$\$([^$]+)\$\$/g, "$1")
    .replace(/\$([^$]+)\$/g, "$1")
    .replace(/\\\((.*?)\\\)/g, "$1")
    .replace(/\\\[(.*?)\\\]/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export default function TranscriptMessage({ message }) {
  return (
    <article className={`transcriptMessage ${message.role}`}>
      <div className="messageMeta">
        <span>Turn {message.turn}</span>
        <strong>{message.role === "tutor" ? "Tutor" : "Student"}</strong>
      </div>
      <p>{stripMathDelimiters(message.text)}</p>
    </article>
  );
}
