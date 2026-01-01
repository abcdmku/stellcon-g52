const fs = require("fs");
const path = require("path");
const pixelmatch = require("pixelmatch").default;
const { PNG } = require("pngjs");

const rootDir = path.resolve(__dirname, "..", "..");
const referencePath = path.join(rootDir, "game.PNG");
const screenshotPath = path.join(__dirname, "screenshot.png");
const diffPath = path.join(__dirname, "diff.png");

function loadPng(filePath) {
  const data = fs.readFileSync(filePath);
  return PNG.sync.read(data);
}

if (!fs.existsSync(referencePath)) {
  console.error("Missing game.PNG reference image.");
  process.exit(1);
}

if (!fs.existsSync(screenshotPath)) {
  console.error("Missing screenshot.png. Run pnpm screenshot first.");
  process.exit(1);
}

const reference = loadPng(referencePath);
const screenshot = loadPng(screenshotPath);

if (reference.width !== screenshot.width || reference.height !== screenshot.height) {
  console.error(
    `Size mismatch. Reference ${reference.width}x${reference.height}, screenshot ${screenshot.width}x${screenshot.height}.`
  );
  process.exit(1);
}

const diff = new PNG({ width: reference.width, height: reference.height });
const mismatched = pixelmatch(
  reference.data,
  screenshot.data,
  diff.data,
  reference.width,
  reference.height,
  { threshold: 0.2 }
);

fs.writeFileSync(diffPath, PNG.sync.write(diff));
const total = reference.width * reference.height;
const ratio = ((mismatched / total) * 100).toFixed(2);

console.log(`Mismatch: ${ratio}% (${mismatched} pixels). Diff saved to ${diffPath}`);
