// Friendly names for common bundle ids, on the Mac and the iPhone. Unknown ids fall back to the
// last part of the id ("com.example.SuperNotes" -> "SuperNotes").
const NAMES: Record<string, string> = {
  "com.google.Chrome": "Chrome",
  "com.google.chrome.ios": "Chrome",
  "com.apple.Safari": "Safari",
  "com.apple.mobilesafari": "Safari",
  "com.microsoft.VSCode": "VS Code",
  "net.whatsapp.WhatsApp": "WhatsApp",
  "com.spotify.client": "Spotify",
  "com.anthropic.claudefordesktop": "Claude",
  "com.anthropic.claude": "Claude",
  "com.openai.chat": "ChatGPT",
  "us.zoom.xos": "Zoom",
  "com.microsoft.Outlook": "Outlook",
  "com.apple.finder": "Finder",
  "com.apple.mail": "Mail",
  "com.apple.mobilemail": "Mail",
  "com.apple.MobileSMS": "Messages",
  "com.apple.iCal": "Calendar",
  "com.apple.mobilecal": "Calendar",
  "com.apple.Terminal": "Terminal",
  "com.apple.Preview": "Preview",
  "com.apple.Notes": "Notes",
  "com.apple.mobilenotes": "Notes",
  "com.apple.systempreferences": "System Settings",
  "com.apple.Preferences": "Settings",
  "com.apple.mobileslideshow": "Photos",
  "com.apple.camera": "Camera",
  "com.apple.mobilephone": "Phone",
  "com.apple.facetime": "FaceTime",
  "com.apple.Maps": "Maps",
  "com.apple.Music": "Music",
  "com.apple.podcasts": "Podcasts",
  "com.apple.Health": "Health",
  "com.burbn.instagram": "Instagram",
  "com.zhiliaoapp.musically": "TikTok",
  "com.google.ios.youtube": "YouTube",
  "com.atebits.Tweetie2": "X",
  "com.facebook.Facebook": "Facebook",
  "com.facebook.Messenger": "Messenger",
  "com.linkedin.LinkedIn": "LinkedIn",
  "ph.telegra.Telegraph": "Telegram",
  "ru.keepcoder.Telegram": "Telegram",
  "com.tinyspeck.slackmacgap": "Slack",
  "com.tinyspeck.chatlyio": "Slack",
  "notion.id": "Notion",
  "com.figma.Desktop": "Figma",
  "com.google.Gmail": "Gmail",
  "com.google.Maps": "Google Maps",
  "com.strava.stravaride": "Strava",
  "com.netflix.Netflix": "Netflix",
  "com.reddit.Reddit": "Reddit",
  "com.viber": "Viber",
  "com.hnc.Discord": "Discord",
};

export function appName(bundleId: string): string {
  const known = NAMES[bundleId];
  if (known) return known;
  // Chrome web apps look like com.google.Chrome.app.<hash>.
  if (bundleId.startsWith("com.google.Chrome.app.")) return "Chrome web app";
  const last = bundleId.split(".").filter(Boolean).pop() ?? bundleId;
  return last.charAt(0).toUpperCase() + last.slice(1);
}
