"use client";

import type { SongSectionDTO } from "@singlearn/shared";

/** Lets the user jump directly to any detected section (Intro, Verse, Chorus, ...) or step to the previous/next one, per command.txt's SECTIONS requirement: "Users should be able to jump between sections." */
export function SectionNav({
  sections,
  activeSection,
  onJump,
  onPrevious,
  onNext,
}: {
  sections: SongSectionDTO[];
  activeSection: SongSectionDTO | null;
  onJump: (section: SongSectionDTO) => void;
  onPrevious: () => void;
  onNext: () => void;
}) {
  if (sections.length === 0) return null;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <button
        className="btn btn-secondary"
        onClick={onPrevious}
        title="Previous section"
        aria-label="Previous section"
        data-testid="section-nav-prev"
        style={{ padding: "4px 10px", fontSize: 12, flexShrink: 0 }}
      >
        ‹
      </button>
      <div style={{ display: "flex", gap: 6, overflowX: "auto", flex: 1 }}>
        {sections.map((section) => (
          <button
            key={section.id}
            className={activeSection?.id === section.id ? "btn" : "btn btn-secondary"}
            onClick={() => onJump(section)}
            title={`Jump to ${section.label}`}
            data-testid="section-chip"
            data-active={activeSection?.id === section.id}
            style={{ padding: "4px 12px", fontSize: 12, whiteSpace: "nowrap", flexShrink: 0 }}
          >
            {section.label}
          </button>
        ))}
      </div>
      <button
        className="btn btn-secondary"
        onClick={onNext}
        title="Next section"
        aria-label="Next section"
        data-testid="section-nav-next"
        style={{ padding: "4px 10px", fontSize: 12, flexShrink: 0 }}
      >
        ›
      </button>
    </div>
  );
}
