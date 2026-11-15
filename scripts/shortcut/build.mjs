#!/usr/bin/env node
// Writes and signs the Michael shortcut, so nobody builds it by hand (#303). It is the shortcut
// docs/sources/ios-shortcuts.md describes:
//
//   Receives Text and Apps.
//   If the input begins with mk_ (a device key, from the Connect link in the app):
//     save it to Shortcuts/Michael/key.txt, notify "Connected to Michael." and stop.
//   Otherwise (an App automation ran it):
//     read the key; if there is none, say how to connect and stop;
//     POST { app: <the app's name>, action: "open" } with "Authorization: Bearer <key>"
//     to <api>/v1/webhooks/ios-shortcuts.
//
// No key is ever in the file: the shortcut reads it on the phone when it runs.
//
//   node scripts/shortcut/build.mjs            the unsigned plist, scripts/shortcut/out/Michael.shortcut
//   node scripts/shortcut/build.mjs --sign     and the signed file, apps/web/public/Michael.shortcut
//   options: --api <base URL>  --out <unsigned path>  --signed <signed path>
//
// iOS only imports signed shortcuts and only macOS signs them (`shortcuts sign`, signed in to
// iCloud, online). `pnpm shortcut` is the one command.

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_API = "https://api-production-16521a26.up.railway.app";
/** apps/web/lib/one-tap.ts runs the shortcut by this name, and iOS names an import after its file. */
export const SHORTCUT_NAME = "Michael";
/** Inside the Shortcuts folder (iCloud Drive, or On My iPhone without it). */
export const KEY_PATH = "Michael/key.txt";
export const KEY_PREFIX = "mk_";
export const CONNECTED = "Connected to Michael.";
export const NOT_CONNECTED = "Open Michael, You, iPhone to connect.";
export const WEBHOOK_PATH = "/v1/webhooks/ios-shortcuts";

// ---------- a tiny property list writer (XML, which `shortcuts sign` reads) ----------

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function plistValue(v, pad) {
  const inner = `${pad}\t`;
  if (v === true) return `${pad}<true/>`;
  if (v === false) return `${pad}<false/>`;
  if (typeof v === "number") {
    if (!Number.isInteger(v)) throw new Error("Only whole numbers are used here");
    return `${pad}<integer>${v}</integer>`;
  }
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
  throw new Error(`Cannot write ${String(v)} to a property list`);
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
// Where each shape was checked is in docs/sources/ios-shortcuts.md, "How the file is made".

/** The character that stands for a variable inside a text field. */
export const OBJ = "￼";

/** Read the variable as text (the "as Text" choice in the editor). */
const asText = { Type: "WFCoercionVariableAggrandizement", CoercionItemClass: "WFStringContentItem" };
/** The variable's Name, the one property every kind of input has (an app's name for an app). */
const itsName = {
  Type: "WFPropertyVariableAggrandizement",
  PropertyName: "Name",
  PropertyUserInfo: "WFItemName",
};

/** Shortcut Input: the key from the Connect link, or the app from the automation. */
const shortcutInput = (...aggrandizements) => ({
  Type: "ExtensionInput",
  ...(aggrandizements.length ? { Aggrandizements: aggrandizements } : {}),
});

/** The output of an earlier action (a magic variable). */
const actionOutput = (uuid, name, ...aggrandizements) => ({
  Type: "ActionOutput",
  OutputUUID: uuid,
  OutputName: name,
  ...(aggrandizements.length ? { Aggrandizements: aggrandizements } : {}),
});

/** A parameter that is one variable. */
const attachment = (variable) => ({ Value: variable, WFSerializationType: "WFTextTokenAttachment" });

/** A text field: plain text, with one variable for every OBJ in it. */
function text(template, ...variables) {
  const attachmentsByRange = {};
  let at = 0;
  let used = 0;
  // Positions count UTF-16 code units, as NSString does; OBJ is one unit.
  for (const ch of template) {
    if (ch === OBJ) attachmentsByRange[`{${at}, 1}`] = variables[used++];
    at += ch.length;
  }
  if (used !== variables.length) throw new Error("text(): one OBJ for every variable");
  return {
    Value: used ? { string: template, attachmentsByRange } : { string: template },
    WFSerializationType: "WFTextTokenString",
  };
}

/** A dictionary field (headers, JSON body): text keys with text values. */
const dictionary = (items) => ({
  Value: {
    WFDictionaryFieldValueItems: items.map(([key, value]) => ({
      WFItemType: 0,
      WFKey: text(key),
      WFValue: value,
    })),
  },
  WFSerializationType: "WFDictionaryFieldValue",
});

const action = (id, parameters = {}) => ({
  WFWorkflowActionIdentifier: `is.workflow.actions.${id}`,
  WFWorkflowActionParameters: parameters,
});

// If, Otherwise and End If are one action, three times, with the same GroupingIdentifier.
export const FLOW = { start: 0, otherwise: 1, end: 2 };
export const CONDITION = { beginsWith: 8, hasNoValue: 101 };

const ifStart = (group, variable, condition, string) =>
  action("conditional", {
    GroupingIdentifier: group,
    WFControlFlowMode: FLOW.start,
    WFCondition: condition,
    WFInput: { Type: "Variable", Variable: attachment(variable) },
    ...(string === undefined ? {} : { WFConditionalActionString: string }),
  });
const ifOtherwise = (group) =>
  action("conditional", { GroupingIdentifier: group, WFControlFlowMode: FLOW.otherwise });
const ifEnd = (group, uuid) =>
  action("conditional", { GroupingIdentifier: group, WFControlFlowMode: FLOW.end, UUID: uuid });

const notify = (body) =>
  action("notification", {
    WFNotificationActionTitle: SHORTCUT_NAME,
    WFNotificationActionBody: body,
    WFNotificationActionSound: false,
  });
const stop = () => action("exit");

// ---------- the shortcut ----------

const newUuid = () => randomUUID().toUpperCase();

/** The shortcut as a plain object. `uuid` can be passed in so a test gets the same file twice. */
export function michaelShortcut({ api = DEFAULT_API, uuid = newUuid } = {}) {
  const base = api.replace(/\/+$/, "");
  if (!/^https?:\/\/[^\s/]+/.test(base)) throw new Error(`--api must be a URL, got "${api}"`);
  const isKey = uuid();
  const noKey = uuid();
  const keyFile = uuid();
  // The saved key, read as text: the header and the "is there a key" check both use it.
  const key = () => actionOutput(keyFile, "File", asText);

  const actions = [
    // A device key from the Connect link: keep it, say so, stop.
    ifStart(isKey, shortcutInput(asText), CONDITION.beginsWith, KEY_PREFIX),
    action("documentpicker.save", {
      WFInput: attachment(shortcutInput()),
      WFAskWhereToSave: false,
      WFFileDestinationPath: KEY_PATH,
      WFSaveFileOverwrite: true,
      UUID: uuid(),
    }),
    notify(CONNECTED),
    stop(),
    ifOtherwise(isKey),
    // An app opened: read the key, or say how to connect.
    action("documentpicker.open", {
      WFGetFilePath: KEY_PATH,
      WFFileErrorIfNotFound: false,
      UUID: keyFile,
    }),
    ifStart(noKey, key(), CONDITION.hasNoValue),
    notify(NOT_CONNECTED),
    stop(),
    ifEnd(noKey, uuid()),
    action("downloadurl", {
      WFURL: `${base}${WEBHOOK_PATH}`,
      WFHTTPMethod: "POST",
      ShowHeaders: true,
      WFHTTPHeaders: dictionary([["Authorization", text(`Bearer ${OBJ}`, key())]]),
      WFHTTPBodyType: "JSON",
      WFJSONValues: dictionary([
        ["app", text(OBJ, shortcutInput(itsName))],
        ["action", text("open")],
      ]),
      UUID: uuid(),
    }),
    ifEnd(isKey, uuid()),
  ];

  // The name is not in the file: iOS names an imported shortcut after its file, Michael.shortcut.
  return {
    WFWorkflowMinimumClientVersionString: "900",
    WFWorkflowMinimumClientVersion: 900,
    // Hot pink, the default glyph.
    WFWorkflowIcon: { WFWorkflowIconStartColor: 3980825855, WFWorkflowIconGlyphNumber: 61440 },
    // A current version, so no old format migration rewrites the file actions. Signing replaces it
    // with the version of the Mac that signs.
    WFWorkflowClientVersion: "4018.0.4",
    WFWorkflowHasOutputFallback: false,
    WFWorkflowOutputContentItemClasses: [],
    // Text (the key from the Connect link) and Apps (from the App automation).
    WFWorkflowInputContentItemClasses: ["WFAppContentItem", "WFStringContentItem"],
    WFWorkflowImportQuestions: [],
    WFWorkflowTypes: [],
    WFQuickActionSurfaces: [],
    WFWorkflowHasShortcutInputVariables: true,
    WFWorkflowActions: actions,
  };
}

// ---------- the Michael Focus shortcut (#438) ----------
//
// Do Not Disturb, asked then done. Michael may not set a Focus himself (no app or server can), but
// a shortcut can, so the app hands over to this one with the time it should end:
//
//   Receives Text.
//   If the input begins with "check": stop (the set up step proves the shortcut is there).
//   If the input begins with "off":   Set Focus: turn Do Not Disturb off.
//   Otherwise (a date and time, "2026-11-17 14:00"): Set Focus: turn Do Not Disturb on until then.
//
// On the iPhone it runs from shortcuts://run-shortcut?name=Michael%20Focus&input=text&text=...
// (apps/web/lib/dnd.ts); on the Mac the collector runs `shortcuts run "Michael Focus"` with the
// same text. Focus is shared across the person's devices by default, so either one is enough.

export const FOCUS_SHORTCUT_NAME = "Michael Focus";
/** The signed file in apps/web/public. Its download is named after the shortcut (next.config.ts). */
export const FOCUS_SIGNED_FILE = "MichaelFocus.shortcut";
export const FOCUS_OFF = "off";
export const FOCUS_CHECK = "check";
/** Apple's own identifier for the Do Not Disturb Focus, the one every device has. */
export const DND_MODE = {
  Identifier: "com.apple.donotdisturb.mode.default",
  DisplayString: "Do Not Disturb",
};

const setFocus = (parameters) =>
  action("dnd.set", { Operation: "Turn", FocusModes: DND_MODE, ...parameters });

export function focusShortcut({ uuid = newUuid } = {}) {
  const isCheck = uuid();
  const isOff = uuid();
  const actions = [
    ifStart(isCheck, shortcutInput(asText), CONDITION.beginsWith, FOCUS_CHECK),
    stop(),
    ifEnd(isCheck, uuid()),
    ifStart(isOff, shortcutInput(asText), CONDITION.beginsWith, FOCUS_OFF),
    setFocus({ Enabled: false, UUID: uuid() }),
    ifOtherwise(isOff),
    // "Until": a time. The text is read as a date when the action runs.
    setFocus({
      Enabled: true,
      AssertionType: "Time",
      Time: text(OBJ, shortcutInput(asText)),
      UUID: uuid(),
    }),
    ifEnd(isOff, uuid()),
  ];
  return {
    WFWorkflowMinimumClientVersionString: "900",
    WFWorkflowMinimumClientVersion: 900,
    WFWorkflowIcon: { WFWorkflowIconStartColor: 3980825855, WFWorkflowIconGlyphNumber: 61440 },
    WFWorkflowClientVersion: "4018.0.4",
    WFWorkflowHasOutputFallback: false,
    WFWorkflowOutputContentItemClasses: [],
    WFWorkflowInputContentItemClasses: ["WFStringContentItem"],
    WFWorkflowImportQuestions: [],
    WFWorkflowTypes: [],
    WFQuickActionSurfaces: [],
    WFWorkflowHasShortcutInputVariables: true,
    WFWorkflowActions: actions,
  };
}

// ---------- command line ----------

function option(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

/** `shortcuts sign --mode anyone`: Apple signs it through iCloud so any iPhone may import it. */
export function sign(input, output) {
  if (process.platform !== "darwin")
    throw new Error("Signing needs macOS: `shortcuts sign` only exists there.");
  mkdirSync(dirname(output), { recursive: true });
  execFileSync("/usr/bin/shortcuts", ["sign", "--mode", "anyone", "--input", input, "--output", output], {
    stdio: "inherit",
  });
  chmodSync(output, 0o644);
  // A signed shortcut is an Apple Encrypted Archive; the bare plist starts with "<?xml".
  const magic = readFileSync(output).subarray(0, 4).toString("latin1");
  if (magic !== "AEA1") throw new Error(`${output} is not a signed shortcut (it starts with "${magic}").`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const here = dirname(fileURLToPath(import.meta.url));
  const out = resolve(option("out") ?? `${here}/out/${SHORTCUT_NAME}.shortcut`);
  const api = option("api") ?? DEFAULT_API;
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, toPlist(michaelShortcut({ api })));
  console.log(`Wrote ${out} (posts to ${api.replace(/\/+$/, "")}${WEBHOOK_PATH}).`);
  // Michael Focus sits next to it, under its own name (the name of the file is the shortcut's name).
  const focusOut = resolve(dirname(out), `${FOCUS_SHORTCUT_NAME}.shortcut`);
  writeFileSync(focusOut, toPlist(focusShortcut()));
  console.log(`Wrote ${focusOut}.`);
  if (process.argv.includes("--sign")) {
    const signed = resolve(option("signed") ?? `${here}/../../apps/web/public/${SHORTCUT_NAME}.shortcut`);
    // --only-focus: sign Michael Focus and leave the Michael shortcut's signed file as it is.
    if (!process.argv.includes("--only-focus")) {
      sign(out, signed);
      console.log(`Signed ${signed}. Commit it: the web app serves it at /${SHORTCUT_NAME}.shortcut.`);
    }
    // No space in the served file's name; the web app sends it as "Michael Focus.shortcut".
    const focusSigned = resolve(dirname(signed), FOCUS_SIGNED_FILE);
    sign(focusOut, focusSigned);
    console.log(`Signed ${focusSigned}. Commit it: the web app serves it at /${FOCUS_SIGNED_FILE}.`);
  }
}
