import express from "express";
import cors from "cors";
import path from "path";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use((req, res, next) => {
    const forwardedProto = req.get("x-forwarded-proto");
    const isHttps = req.secure || forwardedProto === "https";

    if (isHttps) {
      res.setHeader("Strict-Transport-Security", "max-age=31536000");
    }

    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Permissions-Policy", "camera=(), geolocation=(), microphone=()");

    next();
  });

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
