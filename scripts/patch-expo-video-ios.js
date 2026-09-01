const fs = require("node:fs");
const path = require("node:path");

const iosDir = path.join(__dirname, "..", "node_modules", "expo-video", "ios");
const tracksFile = path.join(iosDir, "Records", "Tracks.swift");
const observerFile = path.join(iosDir, "VideoPlayerObserver.swift");
if (!fs.existsSync(tracksFile) || !fs.existsSync(observerFile)) process.exit(0);

function replaceOnce(file, original, replacement, label) {
  const source = fs.readFileSync(file, "utf8");
  if (source.includes(replacement) || (label === "HLS presentation size" && source.includes("let matchedTrack = lastLog?.matchToVideoTrack"))) return;
  if (!source.includes(original)) {
    console.error(`Unable to patch expo-video iOS ${label}: expected source not found`);
    process.exit(1);
  }
  fs.writeFileSync(file, source.replace(original, replacement));
}

replaceOnce(
  tracksFile,
  `    if let cgSize = try? await assetTrack.load(.naturalSize) {\n      size = VideoSize.from(cgSize)\n`,
  `    if let cgSize = try? await assetTrack.load(.naturalSize) {\n      // Encoded naturalSize may be landscape even when preferredTransform\n      // presents the video as portrait. Report presentation dimensions.\n      let transform = (try? await assetTrack.load(.preferredTransform)) ?? .identity\n      let presentationSize = cgSize.applying(transform)\n      size = VideoSize(width: Int(abs(presentationSize.width)), height: Int(abs(presentationSize.height)))\n`,
  "track presentation size",
);

replaceOnce(
  observerFile,
  `          self.currentVideoTrack = lastLog?.matchToVideoTrack(videoTracks: tracks, itemUrl: itemUri)\n`,
  `          let matchedTrack = lastLog?.matchToVideoTrack(videoTracks: tracks, itemUrl: itemUri)\n          // HLS playlists can report encoded landscape dimensions even when\n          // AVPlayer presents the stream as portrait after its track transform.\n          let presentationSize = videoPlayerItem.presentationSize\n          if presentationSize.width > 0 && presentationSize.height > 0 {\n            self.currentVideoTrack = VideoTrack(id: matchedTrack?.id, size: VideoSize.from(presentationSize), mimeType: matchedTrack?.mimeType, bitrate: matchedTrack?.bitrate, isSupported: matchedTrack?.isSupported ?? true, frameRate: matchedTrack?.frameRate)\n          } else {\n            self.currentVideoTrack = matchedTrack\n          }\n`,
  "HLS presentation size",
);

console.log("Applied iOS video presentation-size orientation fixes to expo-video");
