import { useEffect } from "react";
import axios from "axios";
import { SendStatusApi } from "../../Api/Api";
import { loadDeviceState } from "../../utils/deviceState";

export function useStatusHeartbeat() {
  useEffect(() => {
    let intervalId: any;

    async function sendStatus() {
      const { screenId, token } = await loadDeviceState();

      if (!screenId || !token) {
        console.warn("⛔ Missing screenId or token, skipping status...");
        return;
      }

      try {
        // ✅ Correct endpoint: /status/{id}
        await axios.post(
          `${SendStatusApi()}${screenId}`,
          {},
          { headers: { Authorization: `Bearer ${token}` } }
        );

        console.log("📡 Status sent:", screenId);
      } catch (err) {
        console.error("❌ Status send failed:", err);
      }
    }

    // send immediately
    sendStatus();

    // repeat every 85 seconds
    intervalId = setInterval(sendStatus, 80 * 1000);

    return () => clearInterval(intervalId);
  }, []);
}
