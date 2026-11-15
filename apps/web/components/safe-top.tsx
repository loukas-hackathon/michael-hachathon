import { SAFE_TOP_FN } from "@/lib/safe-top";

/**
 * Sets `--m-safe-top` (globals.css) for the installed app where iOS reports the status bar wrongly
 * (lib/safe-top.ts says when). Runs before the first paint, so nothing jumps, and again whenever the
 * viewport changes or the app comes back, since iOS can change its mind after a resume.
 */
const SCRIPT = `(function(){try{
var safeTopFor=${SAFE_TOP_FN};
var d=document.documentElement;
function run(){
var p=document.createElement("div");
p.style.cssText="position:fixed;top:0;height:env(safe-area-inset-top);visibility:hidden;pointer-events:none";
d.appendChild(p);var env=p.offsetHeight;p.remove();
var t=safeTopFor({standalone:matchMedia("(display-mode: standalone)").matches||navigator.standalone===true,env:env,innerHeight:innerHeight,innerWidth:innerWidth,screenHeight:screen.height});
if(t==null)d.style.removeProperty("--m-safe-top");else d.style.setProperty("--m-safe-top",t+"px");
}
run();addEventListener("resize",run);addEventListener("pageshow",run);
document.addEventListener("visibilitychange",function(){if(!document.hidden)run();});
}catch(e){}})()`;

export function SafeTopScript() {
  // biome-ignore lint/security/noDangerouslySetInnerHtml: static inline script, no user input
  return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}
