// src/features/schedule/interactive/buttonRegistry.ts
export type ButtonAction =
  | "next"
  | "prev"
  | `index:${number}`
  | `goto:${number | string}`
  | `open:${string}`
  | string;

export type ButtonRect = {
  id?: string;
  /** Responsive: 0..1 (percent of container). */
  x: number;
  y: number;
  width: number;
  height: number;
  type: ButtonAction;
  meta?: Record<string, unknown>;
};

export type InteractiveLayout = {
  /** zero-based slide index from the API */
  index: number;
  /** absolute, per-slide button positions (no merging) */
  buttons: ButtonRect[];
};

type StyleName = "Interactive1" | "Interactive2" | (string & {});
type StyleConfig = Record<StyleName, InteractiveLayout[]>;

/** Responsive mode ON: treat x/y/w/h as percentages (0..1). */
export const PERCENTAGE_MODE = true;

/* ------------------------------------------------------------------
   EXPLICIT PER-SLIDE LAYOUTS (no auto merge / no generator)
   - Adjust coordinates per your design/artwork.
   - Actions use zero-based indices (e.g., index:3).
   - If you want wrapping, set first/last slides' prev/next accordingly.
------------------------------------------------------------------- */

export const styleDefaults: StyleConfig = {
  /* =======================
     INTERACTIVE 1 (5 slides)
     ======================= */
  Interactive1: [
    {
      index: 0,
      buttons: [
        // prev from 0 → 4 (wrap)
        { id: "prev-0", x: 0.04, y: 0.50, width: 0.10, height: 0.10, type: "index:3" },
        // next to 1
        { id: "next-0", x: 0.86, y: 0.50, width: 0.10, height: 0.10, type: "index:1" },
      ],
    },
    {
      index: 1,
      buttons: [
        // custom positions for slide 1
        { id: "prev-1", x: 0.06, y: 0.12, width: 0.12, height: 0.08, type: "index:0" },
        { id: "next-1", x: 0.82, y: 0.82, width: 0.12, height: 0.08, type: "index:2" },
      ],
    },
    {
      index: 2,
      buttons: [
        // different layout for slide 2
        { id: "prev-2", x: 0.02, y: 0.90, width: 0.16, height: 0.08, type: "index:1" },
        { id: "next-2", x: 0.82, y: 0.06, width: 0.16, height: 0.08, type: "index:3" },
      ],
    },
    {
      index: 3,
      buttons: [
        { id: "prev-3", x: 0.12, y: 0.40, width: 0.12, height: 0.10, type: "index:2" },
        { id: "next-3", x: 0.76, y: 0.40, width: 0.12, height: 0.10, type: "index:0" },
      ],
    },
    {
      index: 4,
      buttons: [
        // last slide → next wraps to 0
        { id: "prev-4", x: 0.10, y: 0.86, width: 0.14, height: 0.08, type: "index:3" },
        { id: "next-4", x: 0.76, y: 0.12, width: 0.14, height: 0.08, type: "index:0" },
      ],
    },
  ],

  /* =======================
     INTERACTIVE 2 (7 slides)
     ======================= */
  Interactive2: [
    {
      index: 0,
      buttons: [
        { id: "prev-0", x: 0.03, y: 0.50, width: 0.10, height: 0.10, type: "index:6" },
        { id: "next-0", x: 0.87, y: 0.50, width: 0.10, height: 0.10, type: "index:1" },
      ],
    },
    {
      index: 1,
      buttons: [
        { id: "prev-1", x: 0.05, y: 0.10, width: 0.12, height: 0.08, type: "index:0" },
        { id: "next-1", x: 0.83, y: 0.88, width: 0.12, height: 0.08, type: "index:2" },
      ],
    },
    {
      index: 2,
      buttons: [
        { id: "prev-2", x: 0.02, y: 0.88, width: 0.15, height: 0.08, type: "index:1" },
        { id: "next-2", x: 0.83, y: 0.06, width: 0.15, height: 0.08, type: "index:3" },
      ],
    },
    {
      index: 3,
      buttons: [
        { id: "prev-3", x: 0.08, y: 0.42, width: 0.12, height: 0.10, type: "index:2" },
        { id: "next-3", x: 0.80, y: 0.42, width: 0.12, height: 0.10, type: "index:4" },
      ],
    },
    {
      index: 4,
      buttons: [
        { id: "prev-4", x: 0.12, y: 0.78, width: 0.12, height: 0.08, type: "index:3" },
        { id: "next-4", x: 0.76, y: 0.22, width: 0.12, height: 0.08, type: "index:5" },
      ],
    },
    {
      index: 5,
      buttons: [
        { id: "prev-5", x: 0.06, y: 0.18, width: 0.12, height: 0.08, type: "index:4" },
        { id: "next-5", x: 0.82, y: 0.78, width: 0.12, height: 0.08, type: "index:6" },
      ],
    },
    {
      index: 6,
      buttons: [
        // last slide wraps next → 0
        { id: "prev-6", x: 0.10, y: 0.50, width: 0.14, height: 0.10, type: "index:5" },
        { id: "next-6", x: 0.76, y: 0.50, width: 0.14, height: 0.10, type: "index:0" },
      ],
    },
  ],
};

/* ----------------------------
   per-playlist overrides (optional)
----------------------------- */
type KeyArgs = {
  style: StyleName;
  index: number;
  playlistId?: number | string;
  mediaId?: number | string;
};

const keyFor = ({ style, index, playlistId, mediaId }: KeyArgs) =>
  `btnPreset|style:${style}|idx:${index}|pl:${playlistId ?? "na"}|mid:${mediaId ?? "na"}`;

export function saveButtonsPreset(args: KeyArgs, buttons: ButtonRect[]) {
  localStorage.setItem(keyFor(args), JSON.stringify(buttons));
}
function loadButtonsPreset(args: KeyArgs): ButtonRect[] | null {
  const raw = localStorage.getItem(keyFor(args));
  if (!raw) return null;
  try { return JSON.parse(raw) as ButtonRect[]; } catch { return null; }
}

/** resolution order: override → style default → [] */
export function buttonsFor(args: KeyArgs): ButtonRect[] {
  const perPl = loadButtonsPreset(args);
  if (perPl) return perPl;
  const arr = styleDefaults[args.style] ?? [];
  return arr.find(s => s.index === args.index)?.buttons ?? [];
}
