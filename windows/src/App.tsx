import { HashRouter, Routes, Route } from "react-router-dom";
import CreateScreen from "./components/CreateScreen/CreateScreen";
import HomeScreen from "./Screen/HomeScreen";
import { useStatusHeartbeat } from "./features/schedule/hooks/useStatusHeartbeat";
import { useScreenCheckGuardApi } from "./Hook/useScreenCheckGuardApi";
import { ServerClockToast } from "./components/Alret/ServerClockToast";

export default function App() {
  useStatusHeartbeat();
  // useScreenCheckGuardApi();
  return (
    <div className="w-screen h-screen overflow-hidden">
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
