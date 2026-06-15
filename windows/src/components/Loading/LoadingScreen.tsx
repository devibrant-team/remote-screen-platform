import React from "react";
import iguanaLogo from "../../assets/Logo.png";

const LoadingScreen: React.FC = () => {
  return (
    <main className="w-screen h-screen relative flex items-center justify-center bg-black">
      <div className="relative z-10 flex flex-col items-center text-white">
        <img
          src={iguanaLogo}
          alt="Iguana"
          className="h-24 w-24 object-contain"
          draggable={false}
        />
        <p className="mt-5 text-xl font-semibold">Preparing content...</p>
      </div>
    </main>
  );
};

export default LoadingScreen;
