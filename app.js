/* global React, ReactDOM */

const { useMemo, useState } = React;

const players = [
  {
    id: "p1",
    name: "Vanguard",
    color: "#e7656f",
    resources: { fusion: 98, terrain: 92, metal: 96, crystal: 87 },
    fleets: 12,
    systems: 6,
  },
  {
    id: "p2",
    name: "Zephyr Union",
    color: "#44d07f",
    resources: { fusion: 66, terrain: 64, metal: 60, crystal: 56 },
    fleets: 10,
    systems: 5,
  },
  {
    id: "p3",
    name: "Astral Pact",
    color: "#7cc6ff",
    resources: { fusion: 43, terrain: 53, metal: 47, crystal: 43 },
    fleets: 3,
    systems: 3,
  },
  {
    id: "p4",
    name: "Orion Syndicate",
    color: "#b487ff",
    resources: { fusion: 20, terrain: 25, metal: 22, crystal: 20 },
    fleets: 2,
    systems: 2,
  },
];

const systems = [
  { id: "s1", q: -5, r: 2, owner: "red", fleets: 8, label: "8", tag: "Home" },
  { id: "s2", q: -4, r: 1, owner: null, fleets: 0 },
  { id: "s3", q: -4, r: 2, owner: null, fleets: 0 },
  { id: "s4", q: -3, r: 1, owner: null, fleets: 0 },
  { id: "s5", q: -3, r: 2, owner: null, fleets: 0 },
  { id: "s6", q: -2, r: 0, owner: null, fleets: 0 },
  { id: "s7", q: -2, r: 1, owner: "red", fleets: 40, tag: "Core" },
  { id: "s8", q: -2, r: 2, owner: null, fleets: 0 },
  { id: "s9", q: -1, r: 0, owner: null, fleets: 0 },
  { id: "s10", q: -1, r: 1, owner: null, fleets: 5 },
  { id: "s11", q: -1, r: 2, owner: null, fleets: 0 },
  { id: "s12", q: 0, r: 0, owner: null, fleets: 0 },
  { id: "s13", q: 0, r: 1, owner: "green", fleets: 10, tag: "Outpost" },
  { id: "s14", q: 0, r: 2, owner: null, fleets: 0 },
  { id: "s15", q: 1, r: 0, owner: null, fleets: 0 },
  { id: "s16", q: 1, r: 1, owner: null, fleets: 0 },
  { id: "s17", q: 1, r: 2, owner: null, fleets: 0 },
  { id: "s18", q: 2, r: 0, owner: null, fleets: 0 },
  { id: "s19", q: 2, r: 1, owner: null, fleets: 0 },
  { id: "s20", q: 3, r: 0, owner: null, fleets: 0 },
  { id: "s21", q: 3, r: 1, owner: "green", fleets: 0, tag: "Home" },
  { id: "s22", q: 4, r: 0, owner: null, fleets: 0 },
  { id: "s23", q: 4, r: 1, owner: null, fleets: 0 },
];

const resources = [
  { key: "fusion", label: "Fusion", color: "var(--fusion)" },
  { key: "terrain", label: "Terrain", color: "var(--terrain)" },
  { key: "metal", label: "Metal", color: "var(--metal)" },
  { key: "crystal", label: "Crystal", color: "var(--crystal)" },
];

const powerups = [
  { id: "stellar", label: "Stellar Bomb", cost: "20 Metal" },
  { id: "terraform", label: "Terraform", cost: "20 Terrain" },
  { id: "defense", label: "Defense Net", cost: "20 Crystal" },
  { id: "wormhole", label: "Wormhole", cost: "20 Fusion" },
];

const HEX_SIZE = 52;

const ringOffsets = Array.from({ length: 18 }, (_, index) => {
  const angle = (Math.PI * 2 * index) / 18;
  const radius = HEX_SIZE * 0.78;
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  };
});

function axialToPixel(q, r, size) {
  const x = size * Math.sqrt(3) * (q + r / 2);
  const y = size * 1.5 * r;
  return { x, y };
}

function getResourceSnapshot(seed) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) % 97;
  }
  return resources.reduce((acc, resource, index) => {
    acc[resource.key] = 40 + ((hash + index * 13) % 31);
    return acc;
  }, {});
}

function HexCell({ system, index, onSelect, selected }) {
  const { x, y } = axialToPixel(system.q, system.r, HEX_SIZE);
  const ringColors = ["var(--fusion)", "var(--terrain)", "var(--metal)", "var(--crystal)"];
  const seed = index % ringColors.length;
  const delay = (index % 10) * 0.05;

  return (
    <div
      className={`hex ${system.owner ? `owner-${system.owner}` : "owner-neutral"} ${
        selected ? "is-selected" : ""
      }`}
      style={{
        transform: `translate(-50%, -50%) translate(${x}px, ${y}px)`,
        animationDelay: `${delay}s`,
      }}
      onClick={() => onSelect(system.id)}
      role="button"
      aria-label={`System ${system.id}`}
    >
      <div className="hex-shape" />
      <div className="hex-core" />
      <div className="hex-value">{system.fleets}</div>
      {system.tag ? <div className="hex-tag">{system.tag}</div> : null}
      <div className="hex-ring">
        {ringOffsets.map((offset, dotIndex) => (
          <span
            key={dotIndex}
            className="hex-dot"
            style={{
              left: "50%",
              top: "50%",
              transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px)` ,
              background: ringColors[(dotIndex + seed) % ringColors.length],
            }}
          />
        ))}
      </div>
    </div>
  );
}

function PlayerCard({ player, rank }) {
  return (
    <div className="player-card" style={{ borderLeft: `3px solid ${player.color}` }}>
      <div className="player-header">
        <div className="player-rank">{rank}</div>
        <div>
          <div className="player-name">{player.name}</div>
      <div className="player-meta">
            {player.systems} systems - {player.fleets} fleets
          </div>
        </div>
      </div>
      <div className="player-bars">
        {resources.map((resource) => (
          <div key={resource.key} className="player-bar">
            <span className="bar-label">{player.resources[resource.key]}</span>
            <span className="bar-track">
              <span
                className="bar-fill"
                style={{ width: `${player.resources[resource.key]}%`, background: resource.color }}
              />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ResourcePanel({ selectedSystem }) {
  const snapshot = getResourceSnapshot(selectedSystem.id);
  return (
    <div className="panel right-panel">
      <div className="panel-title">System Focus</div>
      <div className="system-focus">
        <div>
          <div className="system-name">{selectedSystem.tag || "Unclaimed System"}</div>
          <div className="system-owner">
            Owner: {selectedSystem.owner ? selectedSystem.owner.toUpperCase() : "Unclaimed"}
          </div>
        </div>
        <div className="system-fleets">{selectedSystem.fleets}</div>
      </div>

      <div className="resource-stack">
        {resources.map((resource) => (
          <div key={resource.key} className="resource-row">
            <span className="resource-label">{resource.label}</span>
            <span className="resource-value" style={{ color: resource.color }}>
              {snapshot[resource.key]}
            </span>
          </div>
        ))}
      </div>

      <div className="panel-subtitle">Powerups Ready</div>
      <div className="powerup-grid">
        {powerups.map((powerup) => (
          <button key={powerup.id} className="powerup-card" type="button">
            <span>{powerup.label}</span>
            <span className="powerup-cost">{powerup.cost}</span>
          </button>
        ))}
      </div>

      <div className="turn-timer">
        <div>Turn Timer</div>
        <div className="timer">00:56</div>
      </div>
    </div>
  );
}

function Board({ systems, selectedId, onSelect }) {
  const sorted = useMemo(() => systems.map((system, index) => ({ system, index })), [systems]);

  return (
    <div className="board">
      <div className="board-tools">
        <button type="button">+</button>
        <button type="button">-</button>
        <button type="button">drag</button>
      </div>
      {sorted.map(({ system, index }) => (
        <HexCell
          key={system.id}
          system={system}
          index={index}
          onSelect={onSelect}
          selected={system.id === selectedId}
        />
      ))}
      <div className="board-overlay">
        <div className="turn-chip">Turn 7 / 20</div>
      </div>
    </div>
  );
}

function App() {
  const [selectedId, setSelectedId] = useState("s13");
  const selectedSystem = systems.find((system) => system.id === selectedId) || systems[0];

  return (
    <div className="app">
      <header className="top-bar">
        <div>
          <div className="title">Solar Dominion</div>
          <div className="subtitle">Simultaneous turns - Fleet placement - Research conversion</div>
        </div>
        <button className="primary-action" type="button">
          End Turn
        </button>
      </header>

      <main className="hud">
        <section className="panel left-panel">
          <div className="panel-title">Empire Standings</div>
          {players.map((player, index) => (
            <PlayerCard key={player.id} player={player} rank={index + 1} />
          ))}
        </section>

        <section className="board-area">
          <Board systems={systems} selectedId={selectedId} onSelect={setSelectedId} />
        </section>

        <ResourcePanel selectedSystem={selectedSystem} />
      </main>

      <footer className="bottom-bar">
        <div className="progress">
          <span className="progress-label">Research Conversion</span>
          <span className="progress-track">
            <span className="progress-fill" />
          </span>
        </div>
        <div className="turn-status">
          <span>Fleets to Place</span>
          <strong>6</strong>
        </div>
      </footer>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
