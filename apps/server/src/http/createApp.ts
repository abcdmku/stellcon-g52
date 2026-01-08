import express from "express";
import cors from "cors";
import path from "path";

export function createApp() {
  const app = express();
  app.use(cors());
  app.get("/health", (req, res) => {
    res.json({ ok: true });
  });

  // Serve static files in production
  if (process.env.NODE_ENV === "production") {
    const publicPath = path.join(process.cwd(), "..", "..", "public");
    app.use(express.static(publicPath));

    // SPA fallback - serve index.html for all non-API routes
    app.get("*", (req, res) => {
      res.sendFile(path.join(publicPath, "index.html"));
    });
  }

  return app;
}
