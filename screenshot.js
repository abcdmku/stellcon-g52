const http = require("http");
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");

const mimeTypes = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
};

function startServer(rootDir) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(req.url.split("?")[0]);
      const safePath = urlPath === "/" ? "/index.html" : urlPath;
      const filePath = path.join(rootDir, safePath);

      if (!filePath.startsWith(rootDir)) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }

      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end("Not found");
          return;
        }
        const ext = path.extname(filePath).toLowerCase();
        const contentType = mimeTypes[ext] || "application/octet-stream";
        res.writeHead(200, { "Content-Type": contentType });
        res.end(data);
      });
    });

    server.on("error", reject);
    server.listen(0, () => {
      const { port } = server.address();
      resolve({ server, port });
    });
  });
}

async function run() {
  const rootDir = __dirname;
  const { server, port } = await startServer(rootDir);

  const browser = await puppeteer.launch({
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 2 });

  const url = `http://localhost:${port}/index.html`;
  await page.goto(url, { waitUntil: "networkidle0" });
  await page.waitForSelector(".board", { timeout: 20000 });
  await new Promise((resolve) => setTimeout(resolve, 800));

  await page.screenshot({ path: "screenshot.png", fullPage: true });

  await browser.close();
  server.close();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
