// Draws the iOS launch screens in public/splash: the Mi mark, 96px wide, centred on --m-bg, in
// light and dark, for the iPhone sizes listed in components/splash.tsx. They match the first
// frame of the splash, so an installed Michael opens without a jump.
//
// Run from apps/web after changing the mark or the list: node scripts/startup-images.mjs
// Uses the sharp that Next.js already installs.
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sharp = require(require.resolve("sharp", { paths: [require.resolve("next")] }));

const SIZES = [
  [440, 956, 3],
  [430, 932, 3],
  [428, 926, 3],
  [414, 896, 2],
  [402, 874, 3],
  [393, 852, 3],
  [390, 844, 3],
  [375, 812, 3],
  [375, 667, 2],
];
// --m-bg and --m-label from app/globals.css.
const SCHEMES = { light: ["#ffffff", "#000000"], dark: ["#000000", "#ffffff"] };

const brand = readFileSync(new URL("../components/brand.tsx", import.meta.url), "utf8");
const mark = brand.match(/d="([^"]+)"/)[1]; // the first path is the Mi mark
const MARK_W = 96;
const [VB_W, VB_H] = [346, 209];

mkdirSync(new URL("../public/splash/", import.meta.url), { recursive: true });

for (const [w, h, r] of SIZES) {
  for (const [scheme, [bg, fg]] of Object.entries(SCHEMES)) {
    const scale = (MARK_W / VB_W) * r;
    const x = (w * r - VB_W * scale) / 2;
    const y = (h * r - VB_H * scale) / 2;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w * r}" height="${h * r}">
      <rect width="100%" height="100%" fill="${bg}"/>
      <path transform="translate(${x} ${y}) scale(${scale})" fill="${fg}" fill-rule="evenodd" d="${mark}"/>
    </svg>`;
    const out = new URL(`../public/splash/launch-${w}x${h}@${r}x-${scheme}.png`, import.meta.url);
    await sharp(Buffer.from(svg)).png({ palette: true, colours: 16 }).toFile(out.pathname);
  }
}
console.log(`Wrote ${SIZES.length * 2} launch images to public/splash`);
