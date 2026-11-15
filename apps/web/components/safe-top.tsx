/**
 * The status bar's height for the installed app, as `--m-safe-top` (globals.css). iOS normally
 * reports it as env(safe-area-inset-top), but some iPhones draw the installed app under the clock and
 * battery while reporting 0 (seen on a real iPhone, #448): the week strip then sat under the clock.
 * When the app fills the whole screen and the inset says 0, this sets the status bar height of that
 * iPhone instead. Runs before the first paint, so nothing jumps; a browser tab is never touched.
 */
const SCRIPT = `(function(){try{
var d=document.documentElement;
if(!(matchMedia("(display-mode: standalone)").matches||navigator.standalone))return;
var p=document.createElement("div");
p.style.cssText="position:fixed;top:0;height:env(safe-area-inset-top);visibility:hidden;pointer-events:none";
d.appendChild(p);var h=p.offsetHeight;p.remove();
if(h>0||innerHeight<screen.height-1||innerWidth>innerHeight)return;
var t={667:20,736:20,812:47,844:47,852:59,874:62,896:48,926:47,932:59,956:62}[screen.height]||47;
d.style.setProperty("--m-safe-top",t+"px");
}catch(e){}})()`;

export function SafeTopScript() {
  // biome-ignore lint/security/noDangerouslySetInnerHtml: static inline script, no user input
  return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}
