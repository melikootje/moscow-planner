import type { Part } from "./types";

const common = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export function PartIcon({ part, size = 18 }: { part: Part; size?: number }) {
  const props = { ...common, width: size, height: size };
  switch (part) {
    case "morning":
      return (
        <svg {...props}>
          <path d="M3 18h18M6.5 18a5.5 5.5 0 0 1 11 0M12 6V3M5.2 9.2 3.8 7.8M18.8 9.2l1.4-1.4" />
        </svg>
      );
    case "afternoon":
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" />
        </svg>
      );
    case "evening":
      return (
        <svg {...props}>
          <path d="M3 18h18M7 18a5 5 0 0 1 10 0M12 9V6M12 6l-2 2M12 6l2 2" />
        </svg>
      );
    case "night":
      return (
        <svg {...props}>
          <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
        </svg>
      );
  }
}

export function Icon({ name, size = 16 }: { name: "plus" | "trash" | "edit" | "chevron-left" | "chevron-right" | "gear" | "check" | "x" | "carry" | "menu"; size?: number }) {
  const props = { ...common, width: size, height: size };
  switch (name) {
    case "plus":
      return (
        <svg {...props}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    case "trash":
      return (
        <svg {...props}>
          <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
        </svg>
      );
    case "edit":
      return (
        <svg {...props}>
          <path d="M4 20h4L19 9l-4-4L4 16v4ZM14 6l4 4" />
        </svg>
      );
    case "chevron-left":
      return (
        <svg {...props}>
          <path d="m15 5-7 7 7 7" />
        </svg>
      );
    case "chevron-right":
      return (
        <svg {...props}>
          <path d="m9 5 7 7-7 7" />
        </svg>
      );
    case "gear":
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L14.3 3h-4l-.4 2.6a7 7 0 0 0-2 1.2l-2.3-.9-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7 7 0 0 0 2-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2Z" />
        </svg>
      );
    case "check":
      return (
        <svg {...props} strokeWidth={2.4}>
          <path d="m5 12.5 4.5 4.5L19 7.5" />
        </svg>
      );
    case "x":
      return (
        <svg {...props}>
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      );
    case "menu":
      return (
        <svg {...props}>
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      );
    case "carry":
      return (
        <svg {...props}>
          <path d="M4 12h13M13 6l6 6-6 6" />
        </svg>
      );
  }
}
