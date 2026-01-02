const http = require("http");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const puppeteer = require("puppeteer");
const { PNG } = require("pngjs");

const rootDir = path.resolve(__dirname, "..", "..");
const clientDir = path.join(rootDir, "apps", "client");
const distDir = path.join(clientDir, "dist");
const outputPath = path.join(__dirname, "screenshot.png");
const referencePath = path.join(rootDir, "game.PNG");

function buildClient() {
  execSync("pnpm --filter @stellcon/shared build", { stdio: "inherit", cwd: rootDir });
  execSync("pnpm --filter client build", { stdio: "inherit", cwd: rootDir });
}

function readPngSize(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const data = fs.readFileSync(filePath);
  const png = PNG.sync.read(data);
  return { width: png.width, height: png.height };
}

function startServer(root) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(req.url.split("?")[0]);
      const safePath = urlPath === "/" ? "/index.html" : urlPath;
      const filePath = path.join(root, safePath);
      if (!filePath.startsWith(root)) {
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
        const contentType =
          ext === ".html"
            ? "text/html"
            : ext === ".js"
              ? "text/javascript"
              : ext === ".css"
                ? "text/css"
                : "application/octet-stream";
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
  buildClient();
  const { server, port } = await startServer(distDir);

  const viewportFromRef = readPngSize(referencePath);
  const viewport = viewportFromRef || { width: 1280, height: 720 };

  const browser = await puppeteer.launch({
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: viewport.width, height: viewport.height, deviceScaleFactor: 1 });

  await page.goto(`http://localhost:${port}/index.html?demo=1`, { waitUntil: "networkidle0" });
  await page.waitForSelector(".board", { timeout: 20000 });
  await new Promise((resolve) => setTimeout(resolve, 800));

  await page.screenshot({ path: outputPath, fullPage: true });

  await browser.close();
  server.close();

  console.log(`Saved screenshot to ${outputPath}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
