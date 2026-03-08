export default function AboutPage() {
  return (
    <div className="min-h-screen bg-f1-dark">
      <div className="bg-f1-card border-b border-f1-border">
        <div className="max-w-3xl mx-auto px-6 py-8 flex items-center gap-4">
          <a href="/" className="text-f1-muted hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </a>
          <h1 className="text-2xl font-bold text-white">About</h1>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-12 space-y-8">
        <div className="bg-f1-card border border-f1-red/40 rounded-xl p-6">
          <h2 className="text-lg font-bold text-f1-red mb-3">Disclaimer</h2>
          <p className="text-f1-text leading-relaxed">
            F1 Replay Timing, FastF1, and this website are unofficial and are not associated in any way with the
            Formula 1 companies. F1, FORMULA ONE, FORMULA 1, FIA FORMULA ONE WORLD CHAMPIONSHIP, GRAND PRIX and
            related marks are trade marks of Formula One Licensing B.V.
          </p>
        </div>

        <div className="bg-f1-card border border-f1-border rounded-xl p-6">
          <h2 className="text-lg font-bold text-white mb-3">What is this?</h2>
          <p className="text-f1-text leading-relaxed">
            F1 Replay Timing is an independent project that lets you replay past Formula 1 sessions
            with track visualisation, driver positions, and timing data. It is built purely for educational and
            entertainment purposes.
          </p>
        </div>

        <div className="bg-f1-card border border-f1-border rounded-xl p-6">
          <h2 className="text-lg font-bold text-white mb-3">Data Sources</h2>
          <p className="text-f1-text leading-relaxed mb-4">
            All data is sourced from publicly available APIs. No proprietary or restricted data is used.
          </p>
          <p className="text-f1-text leading-relaxed">
            This project relies on underlying data provided by{" "}
            <a
              href="https://github.com/theOehrly/Fast-F1"
              target="_blank"
              rel="noopener noreferrer"
              className="text-f1-red hover:underline font-semibold"
            >
              FastF1
            </a>
            , an open-source Python library for accessing Formula 1 timing and telemetry data.
            Thanks to the FastF1 maintainers and contributors for making this possible.
          </p>
        </div>

        <div className="text-center pt-4">
          <a href="/" className="text-f1-muted hover:text-white transition-colors text-sm">
            Back to session picker
          </a>
        </div>
      </div>
    </div>
  );
}
