import { useEffect, useState } from "react";

/* ──────────────────────────────────────────────────────────────
  Types
────────────────────────────────────────────────────────────── */
export type WidgetConf = {
  type: "clock" | "weather";
  city?: string;
  position?:
    | "top-left"
    | "top-right"
    | "bottom-left"
    | "bottom-right"
    | "center";
  accent?: "slate" | "blue" | "emerald" | "violet" | "rose";
  hourCycle?: 12 | 24;
  /** overall card width preset (default: "xl") */
  size?: "md" | "lg" | "xl" | "full";
};

type WeatherData = {
  tempC?: number;
  condition?: string;
  iconUrl?: string;
} | null;

/* ──────────────────────────────────────────────────────────────
  Position & Sizing
────────────────────────────────────────────────────────────── */
const posClass = (p?: WidgetConf["position"]) => {
  switch ((p || "center").toLowerCase()) {
    case "top-left":
      return "top-1 left-1";
    case "top-right":
      return "top-1 right-1";
    case "bottom-left":
      return "bottom-1 left-1";
    case "bottom-right":
      return "bottom-1 right-1";
    case "center":
    default:
      return "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2";
  }
};

const widthClass = (size?: WidgetConf["size"]) => {
  switch (size) {
    case "md":
      return "w-[min(78vw,340px)]";
    case "lg":
      return "w-[min(80vw,420px)]";
    case "full":
      return "w-[min(86vw,560px)]";
    case "xl":
    default:
      return "w-[min(82vw,480px)]";
  }
};



const ringFromAccent: Record<NonNullable<WidgetConf["accent"]>, string> = {
  slate: "ring-white/10",
  blue: "ring-blue-300/20",
  emerald: "ring-emerald-300/20",
  violet: "ring-violet-300/20",
  rose: "ring-rose-300/20",
};

/* ──────────────────────────────────────────────────────────────
  Free front-end weather (Open-Meteo) + 10m localStorage cache
────────────────────────────────────────────────────────────── */
type OMGeo = {
  results?: Array<{
    name: string;
    country?: string;
    latitude: number;
    longitude: number;
  }>;
};
type OMForecast = {
  current_weather?: { temperature?: number; weathercode?: number };
};

const WX_CACHE_MIN = 10;
const wxKey = (q: string) => `wx:${q.toLowerCase()}`;

const ICONS: Record<number, { label: string; icon: string }> = {
  0: {
    label: "Clear",
    icon: "https://raw.githubusercontent.com/basmilius/weather-icons/refs/heads/dev/production/fill/all/clear-day.svg",
  },
  1: {
    label: "Mainly clear",
    icon: "https://raw.githubusercontent.com/basmilius/weather-icons/refs/heads/dev/production/fill/all/partly-cloudy-day.svg",
  },
  2: {
    label: "Partly cloudy",
    icon: "https://raw.githubusercontent.com/basmilius/weather-icons/refs/heads/dev/production/fill/all/partly-cloudy-day.svg",
  },
  3: {
    label: "Overcast",
    icon: "https://raw.githubusercontent.com/basmilius/weather-icons/refs/heads/dev/production/fill/all/overcast.svg",
  },
  45: {
    label: "Fog",
    icon: "https://raw.githubusercontent.com/basmilius/weather-icons/refs/heads/dev/production/fill/all/fog.svg",
  },
  48: {
    label: "Rime fog",
    icon: "https://raw.githubusercontent.com/basmilius/weather-icons/refs/heads/dev/production/fill/all/fog.svg",
  },
  51: {
    label: "Drizzle",
    icon: "https://raw.githubusercontent.com/basmilius/weather-icons/refs/heads/dev/production/fill/all/drizzle.svg",
  },
  53: {
    label: "Drizzle",
    icon: "https://raw.githubusercontent.com/basmilius/weather-icons/refs/heads/dev/production/fill/all/drizzle.svg",
  },
  55: {
    label: "Drizzle",
    icon: "https://raw.githubusercontent.com/basmilius/weather-icons/refs/heads/dev/production/fill/all/drizzle.svg",
  },
  61: {
    label: "Rain",
    icon: "https://raw.githubusercontent.com/basmilius/weather-icons/refs/heads/dev/production/fill/all/rain.svg",
  },
  63: {
    label: "Rain",
    icon: "https://raw.githubusercontent.com/basmilius/weather-icons/refs/heads/dev/production/fill/all/rain.svg",
  },
  65: {
    label: "Heavy rain",
    icon: "https://raw.githubusercontent.com/basmilius/weather-icons/refs/heads/dev/production/fill/all/rain.svg",
  },
  66: {
    label: "Freezing rain",
    icon: "https://raw.githubusercontent.com/basmilius/weather-icons/refs/heads/dev/production/fill/all/freezing-rain.svg",
  },
  67: {
    label: "Freezing rain",
    icon: "https://raw.githubusercontent.com/basmilius/weather-icons/refs/heads/dev/production/fill/all/freezing-rain.svg",
  },
  71: {
    label: "Snow",
    icon: "https://raw.githubusercontent.com/basmilius/weather-icons/refs/heads/dev/production/fill/all/snow.svg",
  },
  73: {
    label: "Snow",
    icon: "https://raw.githubusercontent.com/basmilius/weather-icons/refs/heads/dev/production/fill/all/snow.svg",
  },
  75: {
    label: "Heavy snow",
    icon: "https://raw.githubusercontent.com/basmilius/weather-icons/refs/heads/dev/production/fill/all/snow.svg",
  },
  77: {
    label: "Snow grains",
    icon: "https://raw.githubusercontent.com/basmilius/weather-icons/refs/heads/dev/production/fill/all/snow.svg",
  },
  80: {
    label: "Showers",
    icon: "https://raw.githubusercontent.com/basmilius/weather-icons/refs/heads/dev/production/fill/all/showers.svg",
  },
  81: {
    label: "Showers",
    icon: "https://raw.githubusercontent.com/basmilius/weather-icons/refs/heads/dev/production/fill/all/showers.svg",
  },
  82: {
    label: "Violent showers",
    icon: "https://raw.githubusercontent.com/basmilius/weather-icons/refs/heads/dev/production/fill/all/showers.svg",
  },
  85: {
    label: "Snow showers",
    icon: "https://raw.githubusercontent.com/basmilius/weather-icons/refs/heads/dev/production/fill/all/snow-showers.svg",
  },
  86: {
    label: "Snow showers",
    icon: "https://raw.githubusercontent.com/basmilius/weather-icons/refs/heads/dev/production/fill/all/snow-showers.svg",
  },
  95: {
    label: "Thunderstorm",
    icon: "https://raw.githubusercontent.com/basmilius/weather-icons/refs/heads/dev/production/fill/all/thunderstorms.svg",
  },
  96: {
    label: "Thunderstorm",
    icon: "https://raw.githubusercontent.com/basmilius/weather-icons/refs/heads/dev/production/fill/all/thunderstorms.svg",
  },
  99: {
    label: "Thunderstorm",
    icon: "https://raw.githubusercontent.com/basmilius/weather-icons/refs/heads/dev/production/fill/all/thunderstorms.svg",
  },
};
const mapCode = (code?: number) => {
  const m = ICONS[Number(code) as keyof typeof ICONS];
  return { label: m?.label ?? "—", icon: m?.icon };
};
const readWx = (city: string): WeatherData => {
  try {
    const raw = localStorage.getItem(wxKey(city));
    if (!raw) return null;
    const { t, data } = JSON.parse(raw);
    if (Date.now() - t > WX_CACHE_MIN * 60 * 1000) return null;
    return data as WeatherData;
  } catch {
    return null;
  }
};
const saveWx = (city: string, data: WeatherData) => {
  try {
    localStorage.setItem(wxKey(city), JSON.stringify({ t: Date.now(), data }));
  } catch {}
};

async function fetchWeatherFront(city: string): Promise<WeatherData> {
  const cached = readWx(city);
  if (cached) return cached;

  const geo = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
      city
    )}&count=1&language=en&format=json`
  );
  if (!geo.ok) throw new Error("Geocoding failed");
  const g: OMGeo = await geo.json();
  const r = g.results?.[0];
  if (!r) throw new Error("City not found");

  const wx = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${r.latitude}&longitude=${r.longitude}&current_weather=true&timezone=auto`
  );
  if (!wx.ok) throw new Error("Weather fetch failed");
  const w: OMForecast = await wx.json();
  const cw = w.current_weather ?? {};
  const { label, icon } = mapCode(cw.weathercode);

  const data: WeatherData = {
    tempC:
      typeof cw.temperature === "number"
        ? Math.round(cw.temperature)
        : undefined,
    condition: label,
    iconUrl: icon,
  };
  saveWx(city, data);
  return data;
}

/* ──────────────────────────────────────────────────────────────
  Public Renderer
────────────────────────────────────────────────────────────── */
export function WidgetRenderer({ widget }: { widget?: WidgetConf | null }) {
  if (!widget) return null;
  if (widget.type === "clock") return <ClockWidget widget={widget} />;
  if (widget.type === "weather") return <WeatherWidget widget={widget} />;
  return null;
}

/* ──────────────────────────────────────────────────────────────
  CLOCK — dark glass, huge responsive digits
────────────────────────────────────────────────────────────── */
function ClockWidget({ widget }: { widget: WidgetConf }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const time = now.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: widget.hourCycle === 12,
  });
  const date = now.toLocaleDateString(undefined, {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  const city = widget.city?.toUpperCase();

  return (
    <div
      className={`absolute ${posClass(widget.position)} ${widthClass(
        widget.size
      )}`}
    >
      <div
        className={[
          "relative mx-auto rounded-3xl",
          "bg-black/55 backdrop-blur-2xl backdrop-saturate-150",
          "shadow-2xl shadow-black/40",
          "ring-1",
          ringFromAccent[widget.accent ?? "slate"],
"px-4 sm:px-6 lg:px-8 py-4 sm:py-5 lg:py-6",
          "text-white text-center",
        ].join(" ")}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 rounded-3xl"
          style={{
            background:
              "radial-gradient(70% 60% at 20% 50%, rgba(59,130,246,0.12), transparent 60%), radial-gradient(70% 60% at 80% 50%, rgba(244,63,94,0.14), transparent 60%)",
          }}
        />
        <div
          className={[
            "font-extrabold select-none tracking-tight",
"text-[clamp(38px,8.5vw,180px)] leading-none",
            "drop-shadow-[0_6px_18px_rgba(0,0,0,0.25)]",
          ].join(" ")}
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {time}
        </div>
<div className="mt-2 text-[clamp(12px,2vw,18px)] opacity-90">
          {date}
        </div>
        {city ? (
          <div className="mt-4 font-semibold text-[clamp(13px,2.2vw,22px)] opacity-90 truncate">
            {city}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
  WEATHER — dark glass, huge responsive temp, icon fallback
────────────────────────────────────────────────────────────── */
function WeatherWidget({ widget }: { widget: WidgetConf }) {
  const [data, setData] = useState<WeatherData>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [iconBroken, setIconBroken] = useState(false);

  useEffect(() => {
    let alive = true;
    async function load() {
      if (!widget.city) return;
      setLoading(true);
      setErr(null);
      setIconBroken(false);
      try {
        const w = await fetchWeatherFront(widget.city);
        if (!alive) return;
        setData(w);
      } catch (e: any) {
        if (!alive) return;
        setErr(e?.message || "Failed to load weather");
        setData(null);
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    const id = setInterval(load, 10 * 60 * 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [widget.city]);

  const tempText =
    data?.tempC != null && isFinite(data.tempC)
      ? `${Math.round(data.tempC)}°C`
      : "—";

  const emojiFallback = (label?: string) => {
    const s = String(label || "").toLowerCase();
    if (s.includes("clear")) return "🌙";
    if (s.includes("cloud")) return "⛅";
    if (s.includes("rain") || s.includes("shower")) return "🌧️";
    if (s.includes("snow")) return "❄️";
    if (s.includes("thunder")) return "⛈️";
    if (s.includes("fog")) return "🌫️";
    return "🌡️";
  };

  return (
    <div
      className={`absolute ${posClass(widget.position)} ${widthClass(
        widget.size
      )}`}
    >
      <div
        className={[
          "relative mx-auto rounded-3xl",
          "bg-black/55 backdrop-blur-2xl",
          "shadow-2xl shadow-black/40",
          "ring-1",
          ringFromAccent[widget.accent ?? "slate"],
          "px-6 sm:px-10 lg:px-14 py-8 sm:py-10 lg:py-12",
          "text-white text-center",
        ].join(" ")}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 rounded-3xl"
          style={{
            background:
              "radial-gradient(70% 60% at 20% 50%, rgba(59,130,246,0.12), transparent 60%), radial-gradient(70% 60% at 80% 50%, rgba(244,63,94,0.14), transparent 60%)",
          }}
        />

        {widget.city ? (
          <div className="opacity-90 text-[clamp(14px,2.4vw,28px)] mb-4 font-semibold truncate">
            {widget.city}
          </div>
        ) : null}

        <div className="flex items-center justify-center gap-5 mb-4">
          {(data?.iconUrl || !loading) && (
            <div className="hidden sm:flex items-center justify-center rounded-lg ring-1 ring-white/15 bg-white/10 w-[clamp(34px,5vw,52px)] h-[clamp(34px,5vw,52px)]">
              {data?.iconUrl && !iconBroken ? (
                <img
                  src={data.iconUrl}
                  alt=""
                  className="w-[70%] h-[70%] object-contain"
                  draggable={false}
                  onError={() => setIconBroken(true)}
                />
              ) : (
                <span className="text-[clamp(22px,4.8vw,30px)] leading-none">
                  {emojiFallback(data?.condition)}
                </span>
              )}
            </div>
          )}
          <div
            className={[
              "font-extrabold select-none tracking-tight",
              "text-[clamp(38px,8.5vw,170px)] leading-none",

              "drop-shadow-[0_6px_18px_rgba(0,0,0,0.25)]",
            ].join(" ")}
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {loading ? "…" : tempText}
          </div>
        </div>

        <div className="text-[clamp(14px,2.4vw,28px)] opacity-90">
          {err ? "—" : data?.condition || "—"}
        </div>
      </div>
    </div>
  );
}
