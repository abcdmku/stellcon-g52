import { RESOURCE_TYPES } from "@stellcon/shared";

export default function PlayerCard({ player, highlight }) {
  const fleets = player.fleetsToPlace ?? 0;
  const owned = player.systemCount ?? 0;

  return (
    <div className={`player-card ${highlight ? "active" : ""}`}>
      <div className="player-head">
        <span className="player-color" style={{ background: player.color }} />
        <div>
          <div className="player-name">{player.name}</div>
          <div className="player-meta">
            {owned} systems - {fleets} fleets
          </div>
        </div>
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
