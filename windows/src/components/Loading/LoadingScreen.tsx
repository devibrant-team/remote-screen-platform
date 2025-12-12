import React from "react";

const LoadingScreen: React.FC = () => {
  return (
    <main className="w-screen h-screen relative flex items-center justify-center bg-white">
      
      {/* Soft red background glow */}
      <div className="absolute -top-20 -left-20 w-72 h-72 bg-red-500/10 rounded-full blur-3xl" />
      <div className="absolute bottom-0 right-0 w-80 h-80 bg-red-500/10 rounded-full blur-3xl" />

      {/* Center loading indicator */}
      <div className="relative z-10 flex flex-col items-center text-red-500">
        <div className="w-14 h-14 border-4 border-red-500/20 border-t-red-500 rounded-full animate-spin" />
        <p className="mt-4 text-xl font-semibold">Loading…</p>
      </div>
    </main>
  );
};

export default LoadingScreen;
