import { PLAYER_COLORS } from "@stellcon/shared";

export default function GamesList({ games, onWatch, onJoin, onPickColor, selectedColors, disableJoin }) {
  if (!games?.length) {
    return <div className="muted">No public games right now. Create one!</div>;
  }

  return (
    <div className="games-list">
      {games.map((game) => {
        const availableColors = Array.isArray(game.availableColors) ? game.availableColors : PLAYER_COLORS;
        const selectedColor = selectedColors?.[game.gameId];
        const joinColor = selectedColor && availableColors.includes(selectedColor) ? selectedColor : availableColors[0];
        const hasColors = availableColors.length > 0;

        return (
          <div key={game.gameId} className="game-row">
            <div>
              <div className="game-code">{game.gameId}</div>
              <div className="muted">
                {game.players}/{game.maxPlayers} players - {game.mapSize} - turn {game.turn} ({game.phase})
              </div>
            </div>
            <div className="game-right">
              {hasColors ? (
                <div className="game-color-row" role="listbox" aria-label={`Available colors for game ${game.gameId}`}>
                  {availableColors.map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={`color-swatch ${joinColor === value ? "active" : ""}`}
                      style={{ background: value }}
                      onClick={() => onPickColor?.(game.gameId, value)}
                      aria-label={`Color ${value}`}
                      aria-selected={joinColor === value}
                      role="option"
                    />
                  ))}
                </div>
              ) : (
                <div className="muted">No colors left</div>
              )}
              <div className="game-actions">
                <button type="button" onClick={() => onWatch(game.gameId)}>
                  Watch
                </button>
                <button
                  type="button"
                  onClick={() => onJoin(game.gameId, joinColor)}
                  disabled={disableJoin || game.players >= game.maxPlayers || !hasColors}
                  title={disableJoin ? "Enter a unique commander name to join." : undefined}
                >
                  Join
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
