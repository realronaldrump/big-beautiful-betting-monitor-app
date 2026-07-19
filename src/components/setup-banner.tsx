export function SetupBanner() {
  return (
    <aside className="setup" aria-labelledby="setup-heading">
      <div className="setup__copy">
        <span className="setup__badge">Demo mode</span>
        <h2 id="setup-heading">You’re looking at sample data</h2>
        <p>
          Point the monitor at your real Polymarket US account in two steps —
          your key never leaves this machine.
        </p>
      </div>
      <ol className="setup__steps">
        <li>
          <a
            href="https://polymarket.us/developer"
            target="_blank"
            rel="noreferrer"
          >
            Create an API key ↗
          </a>
        </li>
        <li>
          <code>cp .env.local.example .env.local</code>
        </li>
      </ol>
    </aside>
  );
}
