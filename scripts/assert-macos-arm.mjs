#!/usr/bin/env node
/* global console, process */

/**
 * Aladdeen ships one desktop target: a native macOS arm64 build for
 * M-series Apple silicon. Fail before electron-builder runs if packaging is
 * invoked from another OS, an Intel Mac, or a translated Node process.
 */
if (process.platform !== "darwin" || process.arch !== "arm64") {
  console.error(
    `Aladdeen release builds require native macOS arm64 (M-series Apple silicon); detected ${process.platform}/${process.arch}.`,
  );
  process.exit(1);
}

console.log("Aladdeen release target: macOS arm64 (M-series Apple silicon)");
