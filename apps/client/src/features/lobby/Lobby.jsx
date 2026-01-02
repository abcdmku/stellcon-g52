import { useEffect, useState } from "react";
import { MAP_SIZES, PLAYER_COLORS } from "@stellcon/shared";
import GamesList from "./GamesList.jsx";

export default function Lobby({ onCreate, onJoin, onWatch, isBusy, games }) {
  const [mode, setMode] = useState("join");
  const [name, setName] = useState(() => window.localStorage.getItem("stellcon.name") || "");
  const [color, setColor] = useState(() => window.localStorage.getItem("stellcon.color") || PLAYER_COLORS[0]);
  const [joinColors, setJoinColors] = useState({});
  const [maxPlayers, setMaxPlayers] = useState(2);
  const [mapSize, setMapSize] = useState("medium");
  const [isPrivate, setIsPrivate] = useState(false);
  const [maxTurns, setMaxTurns] = useState(20);
  const [turnSeconds, setTurnSeconds] = useState(90);

  const trimmedName = name.trim().replace(/\s+/g, " ");
  const nameValid = trimmedName.length >= 2;

  useEffect(() => {
    window.localStorage.setItem("stellcon.name", name);
  }, [name]);

  useEffect(() => {
    window.localStorage.setItem("stellcon.color", color);
  }, [color]);

  useEffect(() => {
    if (mode !== "join") return;
    setJoinColors((current) => {
      const next = { ...current };
      let changed = false;

      const gameIds = new Set((games || []).map((game) => game.gameId));
      for (const existing of Object.keys(next)) {
        if (!gameIds.has(existing)) {
          delete next[existing];
          changed = true;
        }
      }

      for (const game of games || []) {
        const available = Array.isArray(game.availableColors) ? game.availableColors : PLAYER_COLORS;
        const selected = next[game.gameId];
        const fallback = available.includes(color) ? color : available[0];

        if (!selected && fallback) {
          next[game.gameId] = fallback;
          changed = true;
          continue;
        }

        if (selected && !available.includes(selected)) {
          if (fallback) {
            next[game.gameId] = fallback;
          } else {
            delete next[game.gameId];
          }
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [color, games, mode]);

  const handleJoinColorPick = (gameId, nextColor) => {
    setColor(nextColor);
    setJoinColors((current) => ({ ...current, [gameId]: nextColor }));
  };

  return (
    <>
      <div className="lobby-title">StellCon Command Nexus</div>
      <p className="lobby-subtitle">Choose a callsign, then join a public game or create your own sector.</p>

      <div className="lobby-grid">
        <label>
          Commander Name (unique per game)
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Commander" />
        </label>
        {mode === "create" ? (
          <label className="color-picker">
            Color
            <div className="color-row" role="listbox" aria-label="Player color">
              {PLAYER_COLORS.map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`color-swatch ${color === value ? "active" : ""}`}
                  style={{ background: value }}
                  onClick={() => setColor(value)}
                  aria-label={`Color ${value}`}
                  aria-selected={color === value}
                  role="option"
                />
              ))}
            </div>
          </label>
        ) : null}
      </div>

      <div className="lobby-tabs" role="tablist" aria-label="Lobby mode">
        <button
          type="button"
          className={`lobby-tab ${mode === "join" ? "active" : ""}`}
          onClick={() => setMode("join")}
          role="tab"
          aria-selected={mode === "join"}
        >
          Join Game
        </button>
        <button
          type="button"
          className={`lobby-tab ${mode === "create" ? "active" : ""}`}
          onClick={() => setMode("create")}
          role="tab"
          aria-selected={mode === "create"}
        >
          Create Game
        </button>
      </div>

      {mode === "join" ? (
        <>
          <div className="panel-subtitle">Public Games</div>
          <GamesList
            games={games}
            onWatch={(target) => onWatch(target)}
            onJoin={(target, joinColor) => onJoin({ name: trimmedName, gameId: target, color: joinColor })}
            onPickColor={handleJoinColorPick}
            selectedColors={joinColors}
            disableJoin={!nameValid || isBusy}
          />
          <div className="muted" style={{ marginTop: 10 }}>
            Private games are joined via a shared link (the URL includes `?game=XXXXXX`).
          </div>
        </>
      ) : (
        <>
          <div className="lobby-grid">
            <label className="range">
              Players <span className="range-value">{maxPlayers}</span>
              <input
                type="range"
                min="2"
                max="6"
                step="1"
                value={maxPlayers}
                onChange={(event) => setMaxPlayers(Number(event.target.value))}
              />
              <div className="range-steps" aria-hidden="true">
                {[2, 3, 4, 5, 6].map((value) => (
                  <span key={value} className={value === maxPlayers ? "active" : ""} />
                ))}
              </div>
            </label>
            <label>
              Map Size
              <select value={mapSize} onChange={(event) => setMapSize(event.target.value)}>
                {Object.entries(MAP_SIZES).map(([key, value]) => (
                  <option key={key} value={key}>
                    {key} ({value.width}x{value.height})
                  </option>
                ))}
              </select>
            </label>
            <label className="toggle">
              Visibility: {isPrivate ? "Private" : "Public"}
              <input
                type="checkbox"
                checked={!isPrivate}
                onChange={(event) => setIsPrivate(!event.target.checked)}
              />
            </label>
            <label>
              Max Turns
              <input
                type="number"
                min="10"
                max="50"
                value={maxTurns}
                onChange={(event) => setMaxTurns(Number(event.target.value))}
              />
            </label>
            <label>
              Turn Seconds
              <input
                type="number"
                min="30"
                max="180"
                value={turnSeconds}
                onChange={(event) => setTurnSeconds(Number(event.target.value))}
              />
            </label>
          </div>
          <div className="lobby-actions">
            <button
              type="button"
              disabled={isBusy || !nameValid}
              onClick={() =>
                onCreate({
                  name: trimmedName,
                  color,
                  config: {
                    maxPlayers,
                    mapSize,
                    maxTurns,
                    turnSeconds,
                    isPrivate,
                  },
                })
              }
            >
              Create Game
            </button>
            <button type="button" className="secondary" onClick={() => setMode("join")}>
              Back
            </button>
          </div>
        </>
      )}
    </>
  );
}
