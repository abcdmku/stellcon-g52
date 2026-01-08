import type { PowerupKey } from "@stellcon/shared";

export function PowerupIcon({ type, size = 18 }: { type: PowerupKey; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", "aria-hidden": true, focusable: false } as const;
  switch (type) {
    case "stellarBomb":
      return (
        <svg {...common}>
          <path
            fill="currentColor"
            d="M12 2.4c.5 0 .9.3 1 .8l.9 3.5 3.5-.9c.5-.1 1 .1 1.2.6.2.5 0 1-.4 1.3l-2.9 2.2 2.2 2.9c.3.4.3 1 0 1.3-.3.4-.8.6-1.3.4l-3.1-1.4-1.4 3.1c-.2.5-.7.8-1.2.7-.5 0-.9-.4-1-.9l-.3-3.6-3.6.3c-.5 0-1-.3-1.2-.8-.2-.5 0-1 .4-1.3l2.9-2.2-2.2-2.9c-.3-.4-.3-1 0-1.3.3-.4.8-.6 1.3-.4l3.1 1.4 1.4-3.1c.2-.4.6-.7 1.1-.7Z"
          />
        </svg>
      );
    case "terraform":
      return (
        <svg {...common}>
          <path
            fill="currentColor"
            d="M12 3c4.5 0 8.2 3.7 8.2 8.2 0 4.2-3.2 7.7-7.3 8.2V21c0 .6-.4 1-1 1s-1-.4-1-1v-1.6C6.8 18.9 3.6 15.4 3.6 11.2 3.6 6.7 7.3 3 11.8 3Zm.1 2c-3.4 0-6.2 2.8-6.2 6.2 0 3 2.1 5.5 5.1 6.1v-2.6c0-2.5 1.2-4.7 3.1-6.1.5-.3 1.1-.2 1.4.3.3.5.2 1.1-.3 1.4-1.3 1-2.1 2.5-2.1 4.2v2.8c2.8-.8 4.9-3.4 4.9-6.1 0-3.4-2.8-6.2-6.2-6.2Z"
          />
        </svg>
      );
    case "defenseNet":
      return (
        <svg {...common}>
          <path
            fill="currentColor"
            d="M12 2.6c.2 0 .4.1.6.2l7.2 3.2c.4.2.6.6.6 1v6.2c0 4.7-3.2 8.3-7.9 9.7h-.2c-.1 0-.3 0-.4-.1C7.2 21.6 4 18 4 13.2V7c0-.4.2-.8.6-1l7.2-3.2c.1-.1.3-.2.5-.2Zm0 2.2L6 7.3v5.9c0 3.7 2.4 6.6 6 7.6 3.6-1 6-3.9 6-7.6V7.3L12 4.8Z"
          />
        </svg>
      );
    case "wormhole":
      return (
        <svg {...common}>
          <path
            fill="currentColor"
            d="M12 3c5 0 9 4 9 9 0 4.4-3 8.1-7.2 8.8-1 .2-1.9-.5-1.9-1.5 0-.7.5-1.3 1.2-1.4 3.2-.5 5.7-3.3 5.7-6.6 0-3.9-3.1-7-7-7S5 7.1 5 11c0 2.9 1.8 5.5 4.5 6.5.7.2 1.1 1 .8 1.7-.2.6-1 .9-1.6.7C5.4 18.6 3 15 3 11c0-5 4-9 9-9Zm-.2 5.2c.6 0 1 .4 1 1v6.8c0 .6-.4 1-1 1s-1-.4-1-1V9.2c0-.6.4-1 1-1Z"
          />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" fill="currentColor" opacity="0.5" />
        </svg>
      );
  }
}

