import type { NetMode } from "../../utils/netHealth";

export type NoScheduleProps = {
  screenId?: string | number;
  isOnline: boolean;
  netMode: NetMode;
  onRefetch?: () => void;
};

export default function NoSchedule({
  screenId,
  isOnline,
  netMode,
  onRefetch,
}: NoScheduleProps) {
  return (
    <div className="w-screen h-[100dvh] bg-black text-white grid place-items-center p-6">
      <div className="max-w-[720px] w-full border border-white/10 rounded-2xl bg-white/5 p-6">
        <h1 className="text-xl font-semibold mb-2">
          No schedule & no default playlist
        </h1>
        <p className="text-white/80 mb-4">
          This screen is linked but the server didn’t provide an active schedule,
          and there’s no default playlist to show.
        </p>

        <div className="text-sm text-white/70 space-y-1 mb-6">
          <div><span className="text-white/50">Screen ID:</span> {String(screenId ?? "—")}</div>
          <div><span className="text-white/50">Network:</span> {isOnline ? "Online" : "Offline"} ({netMode})</div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => onRefetch?.()}
            className="px-4 py-2 rounded-lg bg-white text-black font-medium hover:bg-white/90 transition"
          >
            Try refresh
          </button>
        </div>

        <hr className="border-white/10 my-6" />

        <h2 className="text-lg font-semibold mb-2">لا يوجد جدول ولا بلاي ليست افتراضي</h2>
        <p className="text-white/80">
          الجهاز مرتبط لكن لا يوجد جدول (Schedule) فعّال من السيرفر، ولا يوجد بلاي ليست افتراضي
          للعرض. من فضلك أضِف جدولاً للشاشة أو حدِّد بلاي ليست افتراضي.
        </p>
      </div>
    </div>
  );
}
