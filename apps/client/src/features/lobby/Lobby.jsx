import { useState } from "react";
import { MAP_SIZES, PLAYER_COLORS } from "@stellcon/shared";
import GamesList from "./GamesList.jsx";

export default function Lobby({ onCreate, onJoin, onWatch, isBusy, games, name: controlledName, color: controlledColor, onNameChange, onColorChange }) {
  const [mode, setMode] = useState("join");
  const [uncontrolledName, setUncontrolledName] = useState(() => window.localStorage.getItem("stellcon.name") || "");
  const [uncontrolledColor, setUncontrolledColor] = useState(() => window.localStorage.getItem("stellcon.color") || PLAYER_COLORS[0]);
  const [joinColors, setJoinColors] = useState({});
  const [maxPlayers, setMaxPlayers] = useState(2);
  const [mapSize, setMapSize] = useState("medium");
  const [isPrivate, setIsPrivate] = useState(false);
  const [maxTurns, setMaxTurns] = useState(20);
  const [turnSeconds, setTurnSeconds] = useState(90);

  const name = controlledName ?? uncontrolledName;
  const color = controlledColor ?? uncontrolledColor;

  const trimmedName = name.trim().replace(/\s+/g, " ");
  const nameValid = trimmedName.length >= 2;

  const setNameValue = (nextName) => {
    if (controlledName == null) setUncontrolledName(nextName);
    window.localStorage.setItem("stellcon.name", nextName);
    onNameChange?.(nextName);
  };

  const setColorValue = (nextColor) => {
    if (controlledColor == null) setUncontrolledColor(nextColor);
    window.localStorage.setItem("stellcon.color", nextColor);
    onColorChange?.(nextColor);
  };

  const handleJoinColorPick = (gameId, nextColor) => {
    setJoinColors((current) => ({ ...current, [gameId]: nextColor }));
  };

  return (
    <>
      {mode === "create" ? (
        <div className="lobby-header">
          <div className="lobby-title">Create Game</div>
          <label className="visibility-toggle" title="Public games show up in the lobby list">
            Public
            <input
              type="checkbox"
              checked={!isPrivate}
              onChange={(event) => setIsPrivate(!event.target.checked)}
            />
          </label>
        </div>
      ) : (
        <div className="lobby-title">Lobby</div>
      )}
      <div className="lobby-grid">
        <label className="name-row">
          Commander Name (unique per game)
          <div className="name-input-row">
            <input value={name} onChange={(event) => setNameValue(event.target.value)} placeholder="Commander" />
            {mode === "create" ? (
              <div className="color-row-inline" role="listbox" aria-label="Player color">
                {PLAYER_COLORS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={`color-hex ${color === value ? "active" : ""}`}
                    style={{ "--swatch-color": value }}
                    onClick={() => setColorValue(value)}
                    aria-label={`Color ${value}`}
                    aria-selected={color === value}
                    role="option"
                  />
                ))}
              </div>
            ) : null}
          </div>
        </label>
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
          <div className="lobby-actions">
            <button type="button" className="secondary" onClick={() => setMode("create")}>
              Create New Game
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="create-header">
            <div className="lobby-subtitle">Game settings</div>
          </div>

          <div className="lobby-grid create-grid">
            <div className="players-row" role="group" aria-label="Max players">
              <div className="players-row-label">
                Players <span className="players-value">{maxPlayers}</span>
              </div>
              <div className="players-segment" role="radiogroup" aria-label="Players">
                {[2, 3, 4, 5, 6, 7, 8].map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={`players-pill ${value === maxPlayers ? "active" : ""}`}
                    onClick={() => setMaxPlayers(value)}
                    aria-pressed={value === maxPlayers}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>

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
              Turn Length (s)
              <input
                type="number"
                min="30"
                max="180"
                value={turnSeconds}
                onChange={(event) => setTurnSeconds(Number(event.target.value))}
              />
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
