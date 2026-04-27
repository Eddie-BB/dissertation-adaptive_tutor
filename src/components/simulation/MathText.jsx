"use client";

import katex from "katex";

function splitMathSegments(value) {
  const text = String(value || "");
  const segments = [];
  const pattern = /(\$\$[\s\S]+?\$\$|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\])/g;
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: "text", value: text.slice(lastIndex, match.index) });
    }

    const token = match[0];
    const isDisplay = token.startsWith("$$") || token.startsWith("\\[");
    const math = token.startsWith("$$")
      ? token.slice(2, -2)
      : token.startsWith("\\(")
        ? token.slice(2, -2)
        : token.slice(2, -2);

    segments.push({ type: "math", value: math, displayMode: isDisplay });
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    segments.push({ type: "text", value: text.slice(lastIndex) });
  }

  return segments;
}

function renderMath(value, displayMode) {
  try {
    return katex.renderToString(value, {
      displayMode,
      output: "html",
      strict: false,
      throwOnError: false,
      trust: false
    });
  } catch {
    return null;
  }
}

export default function MathText({ as: Component = "span", className = "", text }) {
  const segments = splitMathSegments(text);

  return (
    <Component className={className}>
      {segments.map((segment, index) => {
        if (segment.type === "text") {
          return <span key={index}>{segment.value}</span>;
        }

        const html = renderMath(segment.value, segment.displayMode);

        if (!html) {
          return <span key={index}>{segment.value}</span>;
        }

        return (
          <span
            className={segment.displayMode ? "mathDisplay" : "mathInline"}
            dangerouslySetInnerHTML={{ __html: html }}
            key={index}
          />
        );
      })}
    </Component>
  );
}
