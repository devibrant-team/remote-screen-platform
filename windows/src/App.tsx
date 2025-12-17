import { HashRouter, Routes, Route } from "react-router-dom";
import CreateScreen from "./Screen/CreateScreen";
import HomeScreen from "./Screen/HomeScreen";
import { useStatusHeartbeat } from "./Hook/Device/useStatusHeartbeat";
import { useScreenCheckGuardApi } from "./Hook/Device/useScreenCheckGuardApi";
import { ServerClockToast } from "./components/Alret/ServerClockToast";
import { Toaster } from "react-hot-toast";

import "./index.css"
export default function App() {
  useStatusHeartbeat();
  useScreenCheckGuardApi();
  return (
    <div className="w-screen h-screen overflow-hidden">
<Toaster
  position="top-center"
  containerStyle={{
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
  }}
  toastOptions={{
    duration: 4000,
    style: {
      background: "rgba(20, 20, 20, 0.95)",
      color: "#fff",
      padding: "20px 28px",
      fontSize: "18px",
      fontWeight: 600,
      borderRadius: "14px",
      boxShadow:
        "0 20px 50px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.05)",
      maxWidth: "90vw",
      textAlign: "center",
      minWidth: "320px",
      lineHeight: 1.4,
    },
  }}
/>


      <ServerClockToast />
      {" "}
      {/* full window container */}
      <HashRouter>
        {/* always mounted for background logic */}
        <CreateScreen />

        <Routes>
          <Route path="/" element={<HomeScreen />} />
          <Route path="/register" element={<CreateScreen />} />
        </Routes>
      </HashRouter>
    </div>
  );
}
