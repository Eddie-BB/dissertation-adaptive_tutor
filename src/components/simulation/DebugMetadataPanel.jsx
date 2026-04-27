"use client";

export default function DebugMetadataPanel({ debug, visible }) {
  if (!visible) {
    return null;
  }

  return (
    <section className="panel detailPanel debugPanel">
      <div className="panelHeader">
        <h2>Debug Metadata</h2>
      </div>
      {debug ? (
        <pre>{JSON.stringify(debug, null, 2)}</pre>
      ) : (
        <p className="mutedText">Debug metadata will appear after a step is selected.</p>
      )}
    </section>
  );
}
