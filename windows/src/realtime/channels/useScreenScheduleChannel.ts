// src/realtime/channels/useScreenScheduleChannel.ts
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { subscribeScreenChannel } from "../../echo";

type Props = {
  screenId?: string | number;
};

export function useScreenScheduleChannel({ screenId }: Props) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!screenId) return;

    const unsub = subscribeScreenChannel(screenId, (e) => {
      // Payload متوقّع: { updated: true, screenId, scheduleId? }
      // 1) حدّث الجدول الأب (كل جداول اليوم)
      qc.invalidateQueries({ queryKey: ["parentSchedules", String(screenId)] });

      // 2) لو وصل scheduleId محدد، حدّث الـPlaylist تبعه فقط
      if (e?.scheduleId != null) {
        qc.invalidateQueries({
          queryKey: ["childPlaylist", String(e.scheduleId), String(screenId)],
        });
      }
      // وإلا: عند إعادة حساب activeScheduleId من parent سيتحمّل الـchild تلقائيًا
    });

    return () => unsub();
  }, [screenId, qc]);
}
