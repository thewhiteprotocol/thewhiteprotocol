#!/usr/bin/env node
/**
 * Download circuit artifacts from external storage.
 *
 * Usage:
 *   CIRCUITS_BASE_URL=https://your-cdn.example.com/circuits node tools/download-circuits.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(PROJECT_ROOT, 'circuits', 'manifest.json');
const BASE_URL = process.env.CIRCUITS_BASE_URL || '';

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const file = fs.createWriteStream(dest);
    client
      .get(url, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode} for ${url}`));
          return;
        }
        response.pipe(file);
        file.on('finish', () => {
          file.close(resolve);
        });
      })
      .on('error', reject);
  });
}

async function main() {
  if (!BASE_URL) {
    console.error('Error: CIRCUITS_BASE_URL is not set.');
    console.error('Set it to the base URL where your circuit artifacts are hosted.');
    process.exit(1);
  }

  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error(`Manifest not found: ${MANIFEST_PATH}`);
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  let downloaded = 0;
  let skipped = 0;

  for (const artifact of manifest.artifacts) {
    const localPath = path.join(PROJECT_ROOT, artifact.path);
    const relativeUrl = artifact.path.replace(/^(circuits|frontend\/public\/circuits)\//, '');
    const url = `${BASE_URL}/${relativeUrl}`.replace(/\/+/g, '/').replace(':/', '://');

    if (fs.existsSync(localPath)) {
      const stats = fs.statSync(localPath);
      if (stats.size === artifact.size) {
        skipped++;
        continue;
      }
      console.log(`Size mismatch for ${artifact.path}, re-downloading...`);
    }

    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    console.log(`Downloading ${artifact.path}...`);
    try {
      await downloadFile(url, localPath);
      downloaded++;
    } catch (err) {
      console.error(`Failed to download ${artifact.path}: ${err.message}`);
      if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
    }
  }

  console.log(`\nDone. Downloaded: ${downloaded}, Skipped (already present): ${skipped}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
