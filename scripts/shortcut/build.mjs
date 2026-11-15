#!/usr/bin/env node
// Writes Michael.shortcut, the shared shortcut behind one tap iPhone app opens (#303), exactly as
// docs/sources/ios-shortcuts.md describes it, so nobody builds it by hand:
//
//   Receives Text and Apps.
//   If the input begins with mk_ (a device key from Michael's Connect link):
//     save it to Shortcuts/Michael/key.txt, notify "Connected to Michael." and stop.
//   Otherwise (an App automation ran it):
//     read the key; if there is none, say how to connect and stop;
//     POST { app: <the app's name>, action: "open" } with "Authorization: Bearer <key>"
//     to <api>/v1/webhooks/ios-shortcuts.
//
// The file is an unsigned plist. iOS only imports signed shortcuts, and only macOS can sign:
// run scripts/shortcut/sign.sh on a Mac signed in to iCloud (it calls this script first).
//
//   node scripts/shortcut/build.mjs [--api https://api.example.com] [--out path/Michael.shortcut]

import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_API = "https://api-production-16521a26.up.railway.app";
export const SHORTCUT_NAME = "Michael"; // apps/web/lib/one-tap.ts runs it by this name
export const KEY_PATH = "Michael/key.txt"; // inside the Shortcuts folder in iCloud Drive
export const CONNECTED = "Connected to Michael.";
export const NOT_CONNECTED = "Open Michael, You, iPhone, and tap Connect the shortcut.";

// ---------- a tiny plist writer (XML, the format `shortcuts sign` reads) ----------

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function plistValue(v, pad) {
  const inner = `${pad}\t`;
  if (v === true) return `${pad}<true/>`;
  if (v === false) return `${pad}<false/>`;
  if (typeof v === "number")
    return Number.isInteger(v) ? `${pad}<integer>${v}</integer>` : `${pad}<real>${v}</real>`;
  if (typeof v === "string") return `${pad}<string>${esc(v)}</string>`;
  if (Array.isArray(v)) {
    if (v.length === 0) return `${pad}<array/>`;
    return [`${pad}<array>`, ...v.map((x) => plistValue(x, inner)), `${pad}</array>`].join("\n");
  }
  if (v && typeof v === "object") {
    const entries = Object.entries(v);
    if (entries.length === 0) return `${pad}<dict/>`;
    return [
      `${pad}<dict>`,
      ...entries.flatMap(([k, x]) => [`${inner}<key>${esc(k)}</key>`, plistValue(x, inner)]),
      `${pad}</dict>`,
    ].join("\n");
  }
  throw new Error(`Cannot write ${String(v)} to a plist`);
}

export const toPlist = (root) =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    plistValue(root, ""),
    "</plist>",
    "",
  ].join("\n");

// ---------- Shortcuts' own value shapes ----------

const OBJ = "￼"; // where a variable sits inside a text field

/** Shortcut Input, optionally one of its properties (an App's Name). */
const shortcutInput = (property) => ({
  Type: "ExtensionInput",
  ...(property ? { Aggrandizements: [{ Type: "WFPropertyVariableAggrandizement", PropertyName: property }] } : {}),
});

/** The output of an earlier action. */
const actionOutput = (uuid, name) => ({ Type: "ActionOutput", OutputUUID: uuid, OutputName: name });

/** A whole parameter that is one variable. */
const variable = (value) => ({ Value: value, WFSerializationType: "WFTextTokenAttachment" });

/** A text field: plain text, with `parts` that are variables placed where OBJ stands. */
function text(template, ...parts) {
  const attachmentsByRange = {};
  let at = 0;
  let i = 0;
  // Positions count UTF-16 code units, as NSString does; OBJ is one unit.
  for (const ch of template) {
    if (ch === OBJ) attachmentsByRange[`{${at}, 1}`] = parts[i++];
    at += ch.length;
  }
  if (i !== parts.length) throw new Error("text(): one OBJ per part");
  return {
    Value: i ? { string: template, attachmentsByRange } : { string: template },
    WFSerializationType: "WFTextTokenString",
  };
}

/** A dictionary field (headers, JSON body): text keys to text values. */
const dictionary = (items) => ({
  Value: {
    WFDictionaryFieldValueItems: items.map(([key, value]) => ({ WFItemType: 0, WFKey: text(key), WFValue: value })),
  },
  WFSerializationType: "WFDictionaryFieldValue",
});

const action = (id, params = {}) => ({
  WFWorkflowActionIdentifier: `is.workflow.actions.${id}`,
  WFWorkflowActionParameters: params,
});

// If/Otherwise/End If share a grouping id; mode 0 opens, 1 is Otherwise, 2 closes.
const CONDITION = { beginsWith: 8, hasNoValue: 101 };
const ifStart = (group, input, condition, string) =>
  action("conditional", {
    GroupingIdentifier: group,
    WFControlFlowMode: 0,
    WFCondition: condition,
    WFInput: { Type: "Variable", Variable: input },
    ...(string === undefined ? {} : { WFConditionalActionString: string }),
  });
const ifOtherwise = (group) => action("conditional", { GroupingIdentifier: group, WFControlFlowMode: 1 });
const ifEnd = (group, uuid) =>
  action("conditional", { GroupingIdentifier: group, WFControlFlowMode: 2, UUID: uuid ?? randomUUID().toUpperCase() });

const notify = (body) => action("notification", { WFNotificationActionBody: body, WFNotificationActionSound: false });
const stop = () => action("exit");

// ---------- the shortcut ----------

/** The shortcut as a plain object. `uuid` is injectable so tests get a stable file. */
export function michaelShortcut({ api = DEFAULT_API, uuid = () => randomUUID().toUpperCase() } = {}) {
  const webhook = `${api.replace(/\/$/, "")}/v1/webhooks/ios-shortcuts`;
  const isKey = uuid();
  const noKey = uuid();
  const file = uuid();
  const keyText = uuid();
  const post = uuid();

  const actions = [
    // A device key from the Connect link: keep it, say so, stop.
    ifStart(isKey, variable(shortcutInput()), CONDITION.beginsWith, "mk_"),
    action("documentpicker.save", {
      WFInput: variable(shortcutInput()),
      WFAskWhereToSave: false,
      WFFileDestinationPath: text(KEY_PATH),
      WFSaveFileOverwrite: true,
    }),
    notify(CONNECTED),
    stop(),
    ifOtherwise(isKey),
    // An app opened: read the key, or say how to connect.
    action("documentpicker.open", {
      UUID: file,
      WFGetFilePath: text(KEY_PATH),
      WFFileErrorIfNotFound: false,
      WFShowFilePicker: false,
    }),
    action("detect.text", { UUID: keyText, WFInput: variable(actionOutput(file, "File")) }),
    ifStart(noKey, variable(actionOutput(keyText, "Text")), CONDITION.hasNoValue),
    notify(NOT_CONNECTED),
    stop(),
    ifEnd(noKey),
    action("downloadurl", {
      UUID: post,
      WFURL: webhook,
      WFHTTPMethod: "POST",
      ShowHeaders: true,
      WFHTTPHeaders: dictionary([["Authorization", text(`Bearer ${OBJ}`, actionOutput(keyText, "Text"))]]),
      WFHTTPBodyType: "JSON",
      WFJSONValues: dictionary([
        ["app", text(OBJ, shortcutInput("Name"))],
        ["action", text("open")],
      ]),
    }),
    ifEnd(isKey),
  ];

  return {
    WFWorkflowName: SHORTCUT_NAME,
    WFWorkflowClientVersion: "2607.0.2",
    WFWorkflowMinimumClientVersion: 900,
    WFWorkflowMinimumClientVersionString: "900",
    WFWorkflowIcon: { WFWorkflowIconStartColor: 463140863, WFWorkflowIconGlyphNumber: 59511 },
    WFWorkflowImportQuestions: [],
    // Text (the key from the Connect link) and Apps (from the App automation).
    WFWorkflowInputContentItemClasses: ["WFStringContentItem", "WFAppContentItem"],
    WFWorkflowOutputContentItemClasses: [],
    WFWorkflowHasOutputFallback: false,
    WFWorkflowHasShortcutInputVariables: true,
    WFWorkflowNoInputBehavior: { Name: "WFWorkflowNoInputBehaviorDoNothing", Parameters: {} },
    WFWorkflowTypes: [],
    WFQuickActionSurfaces: [],
    WFWorkflowActions: actions,
  };
}

// ---------- command line ----------

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const here = dirname(fileURLToPath(import.meta.url));
  const out = resolve(arg("out") ?? `${here}/out/Michael.shortcut`);
  const api = arg("api") ?? process.env.MICHAEL_API_URL ?? DEFAULT_API;
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, toPlist(michaelShortcut({ api })));
  console.log(`Wrote ${out} (posts to ${api}). Sign it on a Mac: scripts/shortcut/sign.sh`);
}
