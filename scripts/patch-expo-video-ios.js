const fs = require("node:fs");
const path = require("node:path");

const file = path.join(__dirname, "..", "node_modules", "expo-video", "ios", "Records", "Tracks.swift");
if (!fs.existsSync(file)) process.exit(0);
const source = fs.readFileSync(file, "utf8");
const original = `    if let cgSize = try? await assetTrack.load(.naturalSize) {\n      size = VideoSize.from(cgSize)\n`;
const replacement = `    if let cgSize = try? await assetTrack.load(.naturalSize) {\n      // Encoded naturalSize may be landscape even when preferredTransform\n      // presents the video as portrait. Report presentation dimensions.\n      let transform = (try? await assetTrack.load(.preferredTransform)) ?? .identity\n      let presentationSize = cgSize.applying(transform)\n      size = VideoSize(width: Int(abs(presentationSize.width)), height: Int(abs(presentationSize.height)))\n`;
if (source.includes(replacement)) process.exit(0);
if (!source.includes(original)) {
  console.error("Unable to patch expo-video iOS Tracks.swift: expected source not found");
  process.exit(1);
}
fs.writeFileSync(file, source.replace(original, replacement));
console.log("Applied iOS video presentation-size orientation fix to expo-video");
