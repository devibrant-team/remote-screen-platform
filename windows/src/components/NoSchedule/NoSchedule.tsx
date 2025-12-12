import React from "react";

const NoSchedule: React.FC = () => {
  return (
    <main className="w-screen h-screen relative overflow-hidden bg-white flex items-center justify-center px-6">

      {/* Soft red gradient background */}
      <div className="absolute inset-0 bg-gradient-to-br from-red-50 via-white to-red-100" />

      {/* Decorative soft blobs */}
      <div className="absolute -top-20 -left-20 w-96 h-96 bg-red-500/10 rounded-full blur-3xl" />
      <div className="absolute bottom-0 right-0 w-[28rem] h-[28rem] bg-red-500/10 rounded-full blur-3xl" />

      {/* Content */}
      <div className="relative z-10 max-w-5xl w-full text-center text-red-500">

        {/* Pulse indicator */}
        <div className="mx-auto mb-6 flex items-center justify-center gap-2">
          <span className="w-3 h-3 rounded-full bg-red-500 animate-ping" />
          <span className="text-sm font-semibold tracking-[0.2em] uppercase">
            IGUANA PLAYER
          </span>
        </div>

        {/* Main Title (bigger) */}
        <h1 className="text-4xl md:text-6xl font-extrabold leading-tight mb-4 drop-shadow-sm">
          This screen is ready
          <br />
          <span className="text-red-600">and waiting to be scheduled</span>
        </h1>

        {/* Subtitle */}
        <p className="text-lg md:text-2xl text-slate-700 max-w-2xl mx-auto leading-relaxed mt-4">
          The Iguana Player is active and standing by.
          Once you assign a schedule from the dashboard,
          it will automatically begin displaying your content.
        </p>

        {/* What to do next */}
        <div className="mt-10 max-w-xl mx-auto text-left text-slate-700 text-lg">
          <p className="font-semibold text-red-500 mb-2 text-xl">
            What should you do next?
          </p>
          <ul className="space-y-2 list-disc list-inside">
            <li>Log in to the Iguana dashboard.</li>
            <li>Select this screen from your list.</li>
            <li>Assign a schedule to start playback.</li>
          </ul>
        </div>

      
      </div>
    </main>
  );
};

export default NoSchedule;
