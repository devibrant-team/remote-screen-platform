import { HashRouter, Routes, Route } from "react-router-dom";
import CreateScreen from "./components/CreateScreen/CreateScreen";
import HomeScreen from "./Screen/HomeScreen";

export default function App() {
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
