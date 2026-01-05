import { RESOURCE_TYPES } from "@stellcon/shared";

export default function PlayerCard({ player, highlight, diplomacy }) {
  const fleets = player.fleetsToPlace ?? 0;
  const owned = player.systemCount ?? 0;

  return (
    <div className={`player-card ${highlight ? "active" : ""}`}>
      <div className="player-head">
        <span className="player-color" style={{ background: player.color }} />
        <div className="player-head-main">
          <div className="player-name">{player.name}</div>
          <div className="player-meta">
            {owned} systems - {fleets} fleets
          </div>
        </div>
        {diplomacy ? (
          <button
            type="button"
            className="player-diplomacy"
            onClick={diplomacy.onClick}
            disabled={diplomacy.disabled}
            title={diplomacy.title}
          >
            {diplomacy.label}
          </button>
        ) : null}
      </div>
      <div className="player-bars">
        {RESOURCE_TYPES.map((key) => (
          <div className="bar" key={key}>
            <span>{player.income?.[key] ?? 0}</span>
            <div className="bar-track">
              <div
                className="bar-fill"
                style={{
                  width: `${Math.min(100, (player.income?.[key] ?? 0) * 6)}%`,
                  background: `var(--${key})`,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
