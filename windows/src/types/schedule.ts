// ===================
// Schedule (unchanged)
// ===================
export type ParentScheduleItem = {
  scheduleId: number;
  start_day: string;      // "YYYY-MM-DD"
  start_date: string | null;
  end_date: string | null;
  start_time: string;     // "HH:mm:ss"
  end_time: string;       // "HH:mm:ss"
  status: "active" | "inactive";
};

export type ParentScheduleResponse = {
  success: boolean;
  date: string;           // "YYYY-MM-DD"
  day: string;            // e.g. "Monday"
  count: number;
  data: ParentScheduleItem[];
};

// ===================
// Widgets (enhanced)
// ===================

/** Known widgets we support in the Player UI. */
export type WidgetBase = {
  id?: number;
  /** Optional overlay placement: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center" */
  position?: string;
  /** City label comes from backend; shown as-is (no timezone mapping on frontend). */
  city?: string;
  /** Allow extra fields without breaking. */
  [k: string]: any;
};

export type WidgetClock = WidgetBase & { type: "clock" };
export type WidgetWeather = WidgetBase & { type: "weather" };

/**
 * If backend later sends other widget types, we keep them permissive via the string type.
 * KnownWidget narrows for our UI; UnknownWidget keeps compatibility.
 */
export type KnownWidget = WidgetClock | WidgetWeather;
export type UnknownWidget = WidgetBase & { type: string };

export type PlaylistWidget = KnownWidget | UnknownWidget;

// Optional type guards (handy if you want safer checks in components)
export function isClockWidget(w: any): w is WidgetClock {
  return w && typeof w === "object" && w.type === "clock";
}
export function isWeatherWidget(w: any): w is WidgetWeather {
  return w && typeof w === "object" && w.type === "weather";
}

// ===================
// Playlist (minor adjust)
// ===================

export type PlaylistSlot = {
  id: number;
  index: number;
  scale: string;
  mediaType: "image" | "video";
  mediaId: number;
  ImageFile: string;
  /** Now typed as PlaylistWidget | null (still accepts unknown shapes). */
  widget: PlaylistWidget | null;
};

export type PlaylistSlide = {
  id: number;
  transition: string;
  duration: number;
  index: number;

  // ✅ backend fields
  grid_id?: number;
  grid_type?: string | null;

  // ✅ optional (sometimes present)
  grid_style?: number;

  slots: PlaylistSlot[];
};


export type ChildPlaylistResponse = {
  success: boolean;
  schedule: { id: number; screen_id: number };
  playlist: {
    id: number;
    name: string;
    duration: number;
    slide_number: number;
    style: string;
    slides: PlaylistSlide[];
  };
};
