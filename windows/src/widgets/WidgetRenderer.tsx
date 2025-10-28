import { useEffect, useState } from "react";

export type WidgetConf = {
  type: "clock" | "weather";
  city?: string; // comes from backend, shown as label
  position?: string; // "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center"
};

type WeatherData = {
  tempC?: number;
  condition?: string;
  iconUrl?: string;
} | null;

const posClass = (p?: string) => {
  switch ((p || "").toLowerCase()) {
    case "top-left":
      return "top-2 left-2";
    case "top-right":
      return "top-2 right-2";
    case "bottom-left":
      return "bottom-2 left-2";
    case "bottom-right":
      return "bottom-2 right-2";
    case "center":
      return "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2";
    default:
      return "top-2 right-2";
  }
};

export function WidgetRenderer({ widget }: { widget?: WidgetConf | null }) {
  if (!widget) return null;
  if (widget.type === "clock") return <ClockWidget widget={widget} />;
  if (widget.type === "weather") return <WeatherWidget widget={widget} />;
  return null;
}

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
  });

  return (
    <div
      className={`absolute ${posClass(
        widget.position
      )} px-3 py-2 bg-black/60 backdrop-blur-sm rounded-xl text-white text-sm leading-none`}
    >
      {widget.city ? (
        <div className="opacity-80 text-[11px] mb-0.5">{widget.city}</div>
      ) : null}
      <div className="font-semibold text-lg tracking-wide">{time}</div>
    </div>
  );
}

function WeatherWidget({ widget }: { widget: WidgetConf }) {
  const [data, setData] = useState<WeatherData>(null);

  useEffect(() => {
    let alive = true;

    async function load() {
      // 1) Try Electron bridge: window.signage.getWeather(city)
      try {
        const api = (window as any)?.signage;
        if (api?.getWeather && widget.city) {
          const w = await api.getWeather(widget.city);
          if (alive && w) {
            setData({
              tempC: Number(
                w?.tempC ?? w?.temp ?? w?.temperatureC ?? w?.temperature
              ),
              condition: String(w?.condition ?? w?.summary ?? ""),
              iconUrl: w?.iconUrl ? String(w.iconUrl) : undefined,
            });
            return;
          }
        }
      } catch {}

      // 2) Optional REST fallback if you add it later (/api/weather?city=…)
      try {
        if (widget.city) {
          const res = await fetch(
            `/api/weather?city=${encodeURIComponent(widget.city)}`,
            {
              cache: "no-store",
            }
          );
          if (res.ok) {
            const w = await res.json();
            if (alive && w) {
              setData({
                tempC: Number(
                  w?.tempC ?? w?.temp ?? w?.temperatureC ?? w?.temperature
                ),
                condition: String(w?.condition ?? w?.summary ?? ""),
                iconUrl: w?.iconUrl ? String(w.iconUrl) : undefined,
              });
            }
          }
        }
      } catch {}
    }

    load();

    // refresh every 10 minutes
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

  return (
    <div
      className={`absolute ${posClass(
        widget.position
      )} px-3 py-2 bg-black/60 backdrop-blur-sm rounded-xl text-white text-sm leading-tight`}
    >
      {widget.city ? (
        <div className="opacity-80 text-[11px] mb-0.5">{widget.city}</div>
      ) : null}
      <div className="flex items-center gap-2">
        {data?.iconUrl ? (
          <img src={data.iconUrl} alt="" className="w-5 h-5 object-contain" />
        ) : null}
        <span className="font-medium">{tempText}</span>
        <span className="opacity-80">{data?.condition || ""}</span>
      </div>
    </div>
  );
}
