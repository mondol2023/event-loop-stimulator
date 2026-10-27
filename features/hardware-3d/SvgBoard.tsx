"use client";

// Placeholder: Task 9 replaces this with the SVG board and keeps the default export.
export default function SvgBoard() {
  return (
    <svg role="img" aria-label="2D hardware board" viewBox="0 0 160 90" className="h-full w-full text-muted-foreground">
      <rect x="2" y="2" width="156" height="86" rx="4" fill="none" stroke="currentColor" strokeWidth="1" />
      <text x="80" y="48" textAnchor="middle" fontSize="8" fill="currentColor">
        2D board
      </text>
    </svg>
  );
}
