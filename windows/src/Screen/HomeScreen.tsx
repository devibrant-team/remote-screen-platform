import React from "react";

const HomeScreen: React.FC = () => {
  return (
    <main className="relative min-h-screen overflow-hidden bg-white">
      {/* Soft red glow */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(65%_35%_at_50%_0%,rgba(239,68,68,0.10),transparent_60%)]" />

      {/* Floating confetti */}
      <div className="pointer-events-none absolute inset-0">
        {Array.from({ length: 18 }).map((_, i) => (
          <span
            key={i}
            className="absolute h-2 w-2 rounded-sm bg-red-500/70"
            style={{
              left: `${(i * 53) % 100}%`,
              top: `${(i * 37) % 100}%`,
              transform: `rotate(${i * 20}deg)`,
              animation: `floaty ${6 + (i % 5)}s ease-in-out ${(i % 4) * 0.4}s infinite`,
            }}
          />
        ))}
      </div>

      {/* Center card */}
      <section className="relative z-10 mx-auto flex min-h-screen max-w-3xl items-center justify-center p-6">
        <div className="w-full rounded-2xl border border-red-500/20 bg-white/80 p-8 shadow-[0_10px_40px_-10px_rgba(239,68,68,0.35)] backdrop-blur">
          {/* Badge */}
          <div className="mb-6 flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-red-500 text-white shadow">
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
              >
                <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <span className="rounded-full border border-red-500/30 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-red-500">
              Success
            </span>
          </div>

          {/* Title */}
          <h1 className="text-4xl font-black leading-tight tracking-tight text-red-500 drop-shadow-sm sm:text-5xl">
            Welcome to <span className="underline decoration-red-500/30">Iguana</span>
          </h1>

          {/* Subtitle */}
          <p className="mt-3 text-base text-neutral-700 sm:text-lg">
            Your screen has been added <span className="font-semibold text-red-500">successfully</span>!
          </p>
        </div>
      </section>

      {/* Decorative corner ribbons */}
      <div className="pointer-events-none absolute -left-10 -top-10 h-40 w-40 rotate-12 bg-red-500/10 blur-2xl" />
      <div className="pointer-events-none absolute -bottom-10 -right-10 h-40 w-40 -rotate-12 bg-red-500/10 blur-2xl" />

      {/* Keyframes */}
      <style>{`
        @keyframes floaty {
          0% { transform: translateY(0) rotate(0deg); opacity: 0.9; }
          50% { transform: translateY(-10px) rotate(6deg); opacity: 1; }
          100% { transform: translateY(0) rotate(0deg); opacity: 0.9; }
        }
      `}</style>
    </main>
  );
};

export default HomeScreen;
