// Launch animation: the Mi settles, its dot lands, then the screen gives way to the app.
// Server rendered and driven by CSS so it paints with the first byte and needs no JavaScript to
// finish. The inline script only skips it when it has already played this visit, or when the
// visitor prefers reduced motion. The iOS launch images are plain background, so the installed app
// shows the full animation too. Mounted once from the root layout: in app navigations never replay it.
import "./splash.css";

const BODY =
  "M343.67 62.67 L342.83 61.83 L334.33 61.67 L334.17 61.50 L321.33 61.50 L321.17 61.33 L309.00 61.33 L308.83 61.50 L295.50 61.67 L293.83 61.83 L293.17 62.33 L293.00 62.83 L293.00 144.50 L293.17 144.67 L293.00 154.50 L292.83 155.33 L292.17 156.00 L291.67 156.17 L288.50 156.33 L286.83 156.67 L282.50 156.67 L279.00 155.83 L276.50 154.50 L274.17 152.17 L273.33 151.00 L272.00 148.50 L271.00 145.33 L271.00 143.67 L270.83 143.50 L270.83 44.67 L269.83 38.17 L269.00 35.83 L268.83 34.67 L268.00 33.00 L267.83 32.17 L265.67 28.00 L263.83 25.33 L259.50 20.83 L255.83 17.83 L252.17 15.33 L249.50 14.00 L248.67 13.83 L247.50 13.17 L245.50 12.67 L244.67 12.17 L236.83 10.17 L234.00 9.83 L231.33 9.83 L231.17 9.67 L224.33 9.67 L224.17 9.83 L221.83 9.83 L217.33 10.33 L209.67 12.17 L201.50 15.17 L194.33 19.17 L189.67 22.83 L184.33 28.17 L179.00 34.17 L172.67 43.50 L167.33 49.83 L162.00 57.17 L155.00 66.00 L148.17 75.50 L143.33 81.67 L140.83 85.50 L137.00 90.33 L136.17 91.00 L135.50 91.00 L135.00 90.67 L133.50 88.50 L129.00 83.00 L127.67 80.83 L117.67 67.50 L113.00 61.83 L107.50 54.00 L99.00 43.33 L94.67 37.17 L79.50 17.67 L73.50 10.33 L73.17 10.17 L54.67 10.17 L54.50 10.00 L51.83 10.00 L51.67 10.17 L1.50 10.00 L0.00 10.50 L0.00 202.83 L0.50 203.00 L46.33 203.00 L46.50 202.83 L61.83 203.00 L63.17 202.33 L63.33 202.00 L63.33 179.67 L63.17 179.50 L63.17 160.17 L63.00 160.00 L63.17 103.33 L63.33 103.17 L63.33 96.33 L63.67 93.50 L63.67 88.00 L64.00 87.50 L64.67 87.50 L65.83 88.67 L68.67 92.33 L75.00 99.67 L82.00 109.50 L85.67 113.67 L89.17 118.33 L91.50 121.00 L95.33 126.67 L98.83 131.00 L100.17 133.00 L106.00 140.33 L109.67 144.50 L113.00 149.50 L120.33 159.17 L123.00 162.17 L127.00 167.67 L129.83 170.83 L134.67 177.17 L135.33 177.67 L136.00 177.67 L140.17 173.00 L144.17 167.33 L146.33 164.83 L149.17 160.83 L156.33 152.00 L161.00 145.17 L165.00 140.50 L168.67 135.33 L174.67 127.83 L177.83 123.17 L181.00 119.33 L184.17 115.00 L189.00 109.33 L198.67 96.50 L202.50 92.17 L206.67 86.67 L208.17 85.33 L208.67 85.33 L209.17 86.33 L209.00 87.50 L209.17 144.00 L209.67 146.17 L209.67 148.33 L210.33 152.33 L212.00 158.83 L212.83 160.83 L213.17 162.33 L215.50 167.33 L218.17 172.17 L222.00 177.50 L225.00 181.00 L232.17 188.00 L238.83 192.67 L248.50 197.83 L257.00 200.83 L259.00 201.17 L260.17 201.67 L263.33 202.00 L266.17 202.67 L272.33 203.00 L272.50 203.17 L314.50 203.17 L314.67 203.00 L329.33 203.17 L329.50 203.00 L343.17 202.83 L343.83 202.17 L344.00 131.67 L343.83 131.50 L343.83 115.83 L343.67 115.67 L343.67 110.00 L343.83 109.83 L343.83 99.00 L343.67 98.83 L343.83 64.33Z";
const DOT =
  "M311.67 0.00 L311.67 0.33 L311.00 0.83 L309.67 1.00 L308.00 1.83 L305.83 2.50 L303.00 4.17 L299.83 6.50 L297.17 9.17 L294.33 13.17 L292.17 17.83 L291.17 22.00 L291.00 29.00 L292.17 34.67 L294.33 39.50 L298.17 44.67 L302.67 48.33 L306.67 50.67 L312.00 52.50 L315.67 53.00 L322.83 52.83 L327.17 51.83 L330.33 50.67 L334.33 48.33 L340.00 43.00 L341.83 40.50 L343.67 36.67 L344.83 32.67 L345.33 29.83 L345.83 29.50 L345.83 23.17 L345.33 22.83 L345.00 21.83 L344.67 19.67 L343.50 16.00 L342.17 13.33 L340.50 10.83 L337.67 7.83 L333.00 4.17 L329.00 2.00 L327.00 1.17 L325.33 0.83 L324.50 0.00Z";

// Runs before first paint. Storage can throw in private modes: then the splash simply plays.
// Plays on every open: a cold start, a new tab, or coming back to the installed app after 15
// minutes away (iOS resumes it without a reload, so the script replays it). A reload within the
// same visit skips it. done() also clears data-splashing on <html>, which starts the score count
// up (count-up.tsx). The splash holds while a skeleton is on screen (splash.css), at most 3.5s.
// Showing the element again restarts its CSS animations, which is how the replay works.
const SCRIPT = `(function(){var e=document.getElementById("m-splash");if(!e)return;var d=document.documentElement,t;function done(){clearTimeout(t);e.setAttribute("data-done","");d.removeAttribute("data-splashing")}function play(){e.removeAttribute("data-done");clearTimeout(t);t=setTimeout(done,3500)}var still=false;try{still=matchMedia("(prefers-reduced-motion: reduce)").matches}catch(_){}if(still){done();return}try{if(sessionStorage.getItem("m-splash")){done()}else{sessionStorage.setItem("m-splash","1");play()}}catch(_){play()}e.addEventListener("animationend",function(v){if(v.target===e)done()});var away=0;document.addEventListener("visibilitychange",function(){if(document.hidden){away=Date.now();return}if(away&&Date.now()-away>9e5)play()})})()`;

// Layout inline, so the mark is centred on the very first paint even before the stylesheet lands.
const FRAME = {
  position: "fixed",
  inset: 0,
  zIndex: 100,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "var(--m-bg, #fff)",
  pointerEvents: "none",
} as const;

// iOS launch screens for an installed Michael, light and dark, matching the splash pixel for pixel.
// [css width, css height, pixel ratio]
const STARTUP: [number, number, number][] = [
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

export function Splash() {
  return (
    <>
      {STARTUP.flatMap(([w, h, r]) =>
        (["light", "dark"] as const).map((scheme) => (
          <link
            key={`${w}-${h}-${scheme}`}
            rel="apple-touch-startup-image"
            href={`/splash/launch-${w}x${h}@${r}x-${scheme}.png`}
            media={`(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${r}) and (orientation: portrait) and (prefers-color-scheme: ${scheme})`}
          />
        )),
      )}
      <div id="m-splash" aria-hidden="true" suppressHydrationWarning style={FRAME}>
        <svg viewBox="0 0 346 209" className="m-splash-mark" aria-hidden="true" width={96} height={58}>
          <path className="m-splash-body" fill="currentColor" fillRule="evenodd" d={BODY} />
          <path className="m-splash-dot" fill="currentColor" d={DOT} />
        </svg>
      </div>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static inline script, no user input */}
      <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />
    </>
  );
}
