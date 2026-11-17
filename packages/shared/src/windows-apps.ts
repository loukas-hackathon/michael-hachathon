// ActivityWatch on Windows names an app by its process ("chrome.exe", "WINWORD.EXE"). This turns
// those into the names people know, the same names the Mac reports ("Google Chrome", "Microsoft
// Word"), so the categoriser, the timeline and Michael read one app the same on both computers.
// Only widely used products; anything else keeps its own name without ".exe".

const WINDOWS_PROCESSES: Record<string, string> = {
  // browsers
  chrome: "Google Chrome",
  msedge: "Microsoft Edge",
  firefox: "Firefox",
  brave: "Brave Browser",
  opera: "Opera",
  vivaldi: "Vivaldi",
  arc: "Arc",
  // editors, terminals and developer tools
  code: "Visual Studio Code",
  "code - insiders": "Visual Studio Code",
  cursor: "Cursor",
  windsurf: "Windsurf",
  zed: "Zed",
  devenv: "Visual Studio",
  sublime_text: "Sublime Text",
  idea64: "IntelliJ IDEA",
  pycharm64: "PyCharm",
  webstorm64: "WebStorm",
  goland64: "GoLand",
  studio64: "Android Studio",
  windowsterminal: "Windows Terminal",
  wt: "Windows Terminal",
  powershell: "PowerShell",
  pwsh: "PowerShell",
  cmd: "Command Prompt",
  wezterm: "WezTerm",
  "wezterm-gui": "WezTerm",
  alacritty: "Alacritty",
  githubdesktop: "GitHub Desktop",
  postman: "Postman",
  "docker desktop": "Docker Desktop",
  dbeaver: "DBeaver",
  // documents and planning
  winword: "Microsoft Word",
  excel: "Microsoft Excel",
  powerpnt: "Microsoft PowerPoint",
  onenote: "OneNote",
  notion: "Notion",
  obsidian: "Obsidian",
  figma: "Figma",
  linear: "Linear",
  todoist: "Todoist",
  // AI
  claude: "Claude",
  chatgpt: "ChatGPT",
  // communication
  outlook: "Microsoft Outlook",
  olk: "Microsoft Outlook",
  "ms-teams": "Microsoft Teams",
  teams: "Microsoft Teams",
  slack: "Slack",
  discord: "Discord",
  whatsapp: "WhatsApp",
  "whatsapp.root": "WhatsApp",
  telegram: "Telegram",
  zoom: "Zoom",
  signal: "Signal",
  skype: "Skype",
  // music and video
  spotify: "Spotify",
  vlc: "VLC",
  // the system
  explorer: "File Explorer",
  systemsettings: "Settings",
  taskmgr: "Task Manager",
};

/** "chrome.exe" -> "Google Chrome", "WINWORD.EXE" -> "Microsoft Word", "MyTool.exe" -> "MyTool". */
export function windowsAppName(process: string): string {
  const bare = process.trim().replace(/\.exe$/i, "");
  const key = bare.toLowerCase();
  return Object.hasOwn(WINDOWS_PROCESSES, key) ? (WINDOWS_PROCESSES[key] ?? bare) : bare;
}
