import { HashRouter, Routes, Route } from "react-router-dom";
import CreateScreen from "./components/CreateScreen/CreateScreen";
import HomeScreen from "./Screen/HomeScreen";
import { useStatusHeartbeat } from "./features/schedule/hooks/useStatusHeartbeat";

export default function App() {
    useStatusHeartbeat();
  return (
    <div className="w-screen h-screen overflow-hidden"> {/* full window container */}
      <HashRouter>
        {/* always mounted for background logic */}
        <CreateScreen />

        <Routes>
          <Route path="/" element={<HomeScreen />} />
        </Routes>
      </HashRouter>
    </div>
  );
}
