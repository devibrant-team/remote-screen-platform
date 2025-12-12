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
  /** 0..1 percentages when PERCENTAGE_MODE = true */
  x: number;
  y: number;
  width: number;
  height: number;
  type: ButtonAction;
  meta?: Record<string, unknown>;
};

export type InteractiveLayout = { index: number; buttons: ButtonRect[] };

type StyleName = "Interactive1" | "Interactive2" | (string & {});
type StyleConfig = Record<StyleName, InteractiveLayout[]>;

export const PERCENTAGE_MODE = true;

/* ─────────────────────────────────────────────── */
const DESIGN_W = 1080;
const DESIGN_H = 1920;

function pxToPct(x: number, y: number, w: number, h: number) {
  return { x: x / DESIGN_W, y: y / DESIGN_H, width: w / DESIGN_W, height: h / DESIGN_H };
}

const BTN_W = 180;
const BTN_H = 64;
const MARGIN = 52;

function atCorner(
  corner: "bl" | "br" | "tl" | "tr",
  opts: { id: string; action: ButtonAction; marginX?: number; marginY?: number; w?: number; h?: number }
): ButtonRect {
  const { id, action, marginX = MARGIN, marginY = MARGIN, w = BTN_W, h = BTN_H } = opts;
  const xPx = corner === "bl" || corner === "tl" ? marginX : DESIGN_W - marginX - w;
  const yPx = corner === "tl" || corner === "tr" ? marginY : DESIGN_H - marginY - h;
  const { x, y, width, height } = pxToPct(xPx, yPx, w, h);
  return {
    id,
    type: action,
    x,
    y,
    width,
    height,
    meta: {
      clamp: { minWpx: 44, minHpx: 44, prefVminW: 12, prefVminH: 4.5, maxWpx: 240, maxHpx: 96 },
      safeInsetPct: { top: 0.01, right: 0.02, bottom: 0.02, left: 0.02 },
    },
  };
}

function atPct(id: string, action: ButtonAction, x: number, y: number, w: number, h: number): ButtonRect {
  return {
    id,
    type: action,
    x,
    y,
    width: w,
    height: h,
    meta: {
      clamp: { minWpx: 44, minHpx: 44, prefVminW: 12, prefVminH: 4.5, maxWpx: 240, maxHpx: 96 },
      safeInsetPct: { top: 0.01, right: 0.02, bottom: 0.02, left: 0.02 },
    },
  };
}

/* ─────────────────────────────────────────────── */
/* Layout definitions (NO LABELS)                  */
/* ─────────────────────────────────────────────── */
export const styleDefaults: StyleConfig = {
  // INTERACTIVE 2 → 4 slides
  Interactive2: [
    {
      index: 0,
      buttons: [
        atPct("go-1", "index:1", 0.26, 0.56, 0.18, 0.07),
        atPct("go-2", "index:2", 0.50, 0.56, 0.18, 0.07),
        atPct("go-3", "index:3", 0.74, 0.56, 0.18, 0.07),
      ],
    },
    {
      index: 1,
      buttons: [
        atCorner("bl", { id: "prev-1", action: "prev" }),
        atCorner("br", { id: "next-1", action: "next" }),
      ],
    },
    {
      index: 2,
      buttons: [
        atCorner("bl", { id: "prev-2", action: "prev" }),
        atCorner("br", { id: "next-2", action: "next" }),
      ],
    },
    {
      index: 3,
      buttons: [atCorner("bl", { id: "menu-3", action: "index:0" })],
    },
  ],

  // INTERACTIVE 1 → 5 slides
  Interactive1: [
    { index: 0, buttons: [atCorner("br", { id: "next-0", action: "next" })] },
    {
      index: 1,
      buttons: [
        atCorner("bl", { id: "prev-1", action: "prev" }),
        atCorner("br", { id: "next-1", action: "next" }),
      ],
    },
    {
      index: 2,
      buttons: [
        atCorner("bl", { id: "prev-2", action: "prev" }),
        atCorner("br", { id: "next-2", action: "next" }),
      ],
    },
    {
      index: 3,
      buttons: [
        atCorner("bl", { id: "prev-3", action: "prev" }),
        atCorner("br", { id: "next-3", action: "next" }),
      ],
    },
    { index: 4, buttons: [atCorner("bl", { id: "prev-4", action: "prev" })] },
  ],
};

/* ─────────────────────────────────────────────── */
/* Override API (unchanged)                       */
/* ─────────────────────────────────────────────── */
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
  try {
    return JSON.parse(raw) as ButtonRect[];
  } catch {
    return null;
  }
}

export function buttonsFor(args: KeyArgs): ButtonRect[] {
  const perPl = loadButtonsPreset(args);
  if (perPl) return perPl;
  const arr = styleDefaults[args.style] ?? [];
  return arr.find((s) => s.index === args.index)?.buttons ?? [];
}
