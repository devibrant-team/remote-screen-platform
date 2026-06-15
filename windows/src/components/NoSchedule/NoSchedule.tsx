import React from "react";
import iguanaLogo from "../../assets/Logo.png";

const NoSchedule: React.FC = () => {
  return (
    <main className="w-screen h-screen relative overflow-hidden bg-black flex items-center justify-center px-6">
      <div className="relative z-10 flex flex-col items-center text-center text-white">
        <img
          src={iguanaLogo}
          alt="Iguana"
          className="h-24 w-24 object-contain"
          draggable={false}
        />
        <h1 className="mt-5 text-2xl font-semibold">No content available</h1>
      </div>
    </main>
  );
};

export default NoSchedule;
