import { RESOURCE_TYPES } from "@stellcon/shared";

export default function PlayerCard({ player, highlight, diplomacy }) {
  const owned = player.systemCount ?? 0;
  const fleetsPerRound = Math.min(...RESOURCE_TYPES.map((key) => player.income?.[key] ?? 0));

  return (
    <div className={`player-card ${highlight ? "active" : ""}`}>
      <div className="player-head">
        <span className="player-color" style={{ background: player.color }} />
        <div className="player-name" title={player.name}>
          {player.name}
        </div>
        <div className="player-actions">
          {player.locked ? (
            <span className="player-lock" aria-label="Locked in" title="Locked in">
              Locked In
            </span>
          ) : null}
          {diplomacy ? (
            <button
              type="button"
              className={`player-diplomacy${diplomacy.label === "Accept" ? " player-diplomacy-accept" : ""}${diplomacy.label === "Retract" ? " player-diplomacy-retract" : ""}${diplomacy.label === "Declined" ? " player-diplomacy-declined" : ""}`}
              onClick={diplomacy.onClick}
              disabled={diplomacy.disabled}
              title={diplomacy.title}
            >
              {diplomacy.label}
            </button>
          ) : null}
        </div>
        <div className="player-metrics" aria-label="Commander stats">
          <div className="player-metric" aria-label={`${owned} systems`} title={`${owned} systems controlled`}>
            <div className="player-metric-value">{owned}</div>
            <div className="player-metric-label">Systems</div>
          </div>
          <div
            className="player-metric"
            aria-label={`${fleetsPerRound} fleets per round`}
            title={`${fleetsPerRound} fleets per round (based on your lowest resource income)`}
          >
            <div className="player-metric-value">+{fleetsPerRound}</div>
            <div className="player-metric-label">
              Fleets <span className="player-metric-label-sub">/ round</span>
            </div>
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
