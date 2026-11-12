import { existsSync, readFileSync } from "node:fs";

const url = process.argv[2];
if (!url) {
  console.error('Usage: node scripts/inspect-lesson.mjs "<lesson-url>"');
  process.exit(2);
}

let cookieHeader = "";
const storagePath = "data/browser/skilljar-storage.json";
if (existsSync(storagePath)) {
  const storage = JSON.parse(readFileSync(storagePath, "utf8"));
  cookieHeader = (storage.cookies || [])
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

const res = await fetch(url, {
  headers: {
    ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36",
  },
});

const html = await res.text();
console.log(`URL: ${url}`);
console.log(`HTTP Status: ${res.status} (${html.length} bytes)`);
console.log(`Has #details-pane-summary-content: ${html.includes('id="details-pane-summary-content"')}`);
console.log(`Has .course-text-content:          ${html.includes("course-text-content")}`);
console.log(`Has <sjwc-video>:                  ${/<sjwc-video\b/i.test(html)}`);
console.log(`Has videoJsArgs.assetJWPlayerUrl:  ${html.includes("assetJWPlayerUrl")}`);
console.log(`Has <video>:                       ${/<video\b/i.test(html)}`);

const sjwcMatch = /<sjwc-video\b[^>]*video-id="([^"]+)"[^>]*>/i.exec(html);
if (sjwcMatch) {
  console.log(`Detected <sjwc-video> video-id:    ${sjwcMatch[1]}`);
}
const jwMatch = /players\/([A-Za-z0-9]+)-[A-Za-z0-9]+\.js/.exec(html);
if (jwMatch) {
  console.log(`Detected JWPlayer mediaId:         ${jwMatch[1]}`);
}
