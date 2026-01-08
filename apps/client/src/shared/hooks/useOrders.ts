import { useCallback, useReducer } from "react";
import type { Orders, PowerupKey } from "@stellcon/shared";
import { emptyOrders } from "../lib/orders";

type OrdersAction =
  | { type: "reset" }
  | { type: "replace"; orders: Orders }
  | { type: "placement"; systemId: string; delta: number; fleetsToPlace: number }
  | { type: "queuePowerup"; powerup: Exclude<PowerupKey, "wormhole">; targetId: string }
  | { type: "queueWormhole"; fromId: string; toId: string }
  | { type: "queueMove"; fromId: string; toId: string; originFleets: number }
  | { type: "removeMove"; index: number }
  | { type: "adjustMove"; index: number; delta: number; originFleets: number };

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function ordersReducer(state: Orders, action: OrdersAction): Orders {
  switch (action.type) {
    case "reset":
      return emptyOrders();
    case "replace":
      return action.orders || emptyOrders();
    case "placement": {
      const next = { ...state, placements: { ...state.placements } };
      const currentValue = Number(next.placements[action.systemId] || 0);
      const totalPlacedNow = Object.values(state.placements || {}).reduce((sum, value) => sum + Number(value || 0), 0);
      const remainingNow = Math.max(0, Number(action.fleetsToPlace || 0) - totalPlacedNow);
      const updated = clamp(currentValue + action.delta, 0, currentValue + remainingNow);
      if (updated === 0) {
        delete next.placements[action.systemId];
      } else {
        next.placements[action.systemId] = updated;
      }
      return next;
    }
    case "queuePowerup":
      return {
        ...state,
        powerups: [...state.powerups, { type: action.powerup, targetId: action.targetId }],
      };
    case "queueWormhole": {
      const nextPowerups = state.powerups.filter(
        (entry) =>
          entry.type !== "wormhole" ||
          !(
            ("fromId" in entry && "toId" in entry && entry.fromId === action.fromId && entry.toId === action.toId) ||
            ("fromId" in entry && "toId" in entry && entry.fromId === action.toId && entry.toId === action.fromId)
          )
      );
      nextPowerups.push({ type: "wormhole", fromId: action.fromId, toId: action.toId });
      return { ...state, powerups: nextPowerups };
    }
    case "queueMove": {
      const moves = [...state.moves];
      const placement = Number(state.placements?.[action.fromId] || 0);
      const originTotal = Number(action.originFleets || 0) + placement;
      const queued = moves.reduce(
        (sum, move) => (move.fromId === action.fromId ? sum + Number(move.count || 0) : sum),
        0
      );
      const available = Math.max(0, originTotal - queued);
      if (available <= 0) return state;

      const existingIndex = moves.findIndex((move) => move.fromId === action.fromId && move.toId === action.toId);
      if (existingIndex !== -1) {
        const existing = moves[existingIndex];
        moves[existingIndex] = { ...existing, count: Number(existing.count || 0) + 1 };
        return { ...state, moves };
      }

      moves.push({ fromId: action.fromId, toId: action.toId, count: 1 });
      return { ...state, moves };
    }
    case "removeMove":
      return { ...state, moves: state.moves.filter((_, idx) => idx !== action.index) };
    case "adjustMove": {
      const moves = [...state.moves];
      const move = moves[action.index];
      if (!move) return state;
      const placement = Number(state.placements?.[move.fromId] || 0);
      const originTotal = Number(action.originFleets || 0) + placement;
      const queued = moves.reduce((sum, entry, idx) => {
        if (entry.fromId !== move.fromId) return sum;
        if (idx === action.index) return sum;
        return sum + Number(entry.count || 0);
      }, 0);
      const maxForThis = Math.max(0, originTotal - queued);
      const next = clamp(Number(move.count || 0) + action.delta, 0, maxForThis);
      if (next <= 0) {
        moves.splice(action.index, 1);
        return { ...state, moves };
      }
      moves[action.index] = { ...move, count: next };
      return { ...state, moves };
    }
    default:
      return state;
  }
}

export function useOrders(initialOrders: Orders) {
  const [orders, dispatch] = useReducer(ordersReducer, initialOrders);

  const resetOrders = useCallback(() => dispatch({ type: "reset" }), []);
  const replaceOrders = useCallback((next: Orders | null | undefined) => {
    dispatch({ type: "replace", orders: next || emptyOrders() });
  }, []);
  const applyPlacement = useCallback((systemId: string, delta: number, fleetsToPlace: number) => {
    dispatch({ type: "placement", systemId, delta, fleetsToPlace });
  }, []);
  const queuePowerup = useCallback((powerup: Exclude<PowerupKey, "wormhole">, targetId: string) => {
    dispatch({ type: "queuePowerup", powerup, targetId });
  }, []);
  const queueWormhole = useCallback((fromId: string, toId: string) => {
    dispatch({ type: "queueWormhole", fromId, toId });
  }, []);
  const queueMove = useCallback((fromId: string, toId: string, originFleets: number) => {
    dispatch({ type: "queueMove", fromId, toId, originFleets });
  }, []);
  const removeMove = useCallback((index: number) => dispatch({ type: "removeMove", index }), []);
  const adjustMove = useCallback((index: number, delta: number, originFleets: number) => {
    dispatch({ type: "adjustMove", index, delta, originFleets });
  }, []);

  return {
    orders,
    resetOrders,
    replaceOrders,
    applyPlacement,
    queuePowerup,
    queueWormhole,
    queueMove,
    removeMove,
    adjustMove,
  };
}
