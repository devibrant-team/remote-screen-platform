export type ScreenType = "portrait" | "landscape" | string;

/**
 * On Windows web/Electron, we can't "lock device orientation" like mobile.
 * So we apply a CSS class on <html> and let CSS handle layout.
 */
export function applyScreenTypeWeb(type: ScreenType) {
  const t = String(type || "").trim().toLowerCase();
  const root = document.documentElement;

  // remove previous
  root.classList.remove("screen-portrait", "screen-landscape");
  root.removeAttribute("data-screen-type");

  if (!t) return;

  root.setAttribute("data-screen-type", t);

  if (t === "portrait") root.classList.add("screen-portrait");
  if (t === "landscape") root.classList.add("screen-landscape");
}
