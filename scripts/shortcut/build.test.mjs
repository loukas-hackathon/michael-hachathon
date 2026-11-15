import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  CONDITION,
  CONNECTED,
  DEFAULT_API,
  DND_MODE,
  FLOW,
  FOCUS_CHECK,
  FOCUS_OFF,
  FOCUS_SHORTCUT_NAME,
  focusShortcut,
  KEY_PATH,
  michaelShortcut,
  NOT_CONNECTED,
  OBJ,
  toPlist,
} from "./build.mjs";

// A small reader for the XML this builder writes, so the test proves the file parses on any machine.
function parsePlist(xml) {
  const tokens = xml.match(/<[^>]+>|[^<]+/g).filter((t) => t.trim() !== "" || !t.startsWith("<"));
  let i = tokens.findIndex((t) => t.startsWith("<plist")) + 1;
  const unesc = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  const skip = () => {
    while (tokens[i] !== undefined && !tokens[i].startsWith("<") && tokens[i].trim() === "") i++;
  };
  const leaf = (tag) => {
    const body = tokens[i].startsWith("<") ? "" : tokens[i++];
    assert.equal(tokens[i++], `</${tag}>`);
    return unesc(body);
  };
  function value() {
    skip();
    const t = tokens[i++];
    if (t === "<true/>") return true;
    if (t === "<false/>") return false;
    if (t === "<array/>") return [];
    if (t === "<dict/>") return {};
    if (t === "<string>") return leaf("string");
    if (t === "<integer>") return Number(leaf("integer"));
    if (t === "<array>") {
      const out = [];
      for (skip(); tokens[i] !== "</array>"; skip()) out.push(value());
      i++;
      return out;
    }
    if (t === "<dict>") {
      const out = {};
      for (skip(); tokens[i] !== "</dict>"; skip()) {
        assert.equal(tokens[i++], "<key>");
        const key = leaf("key");
        out[key] = value();
      }
      i++;
      return out;
    }
    throw new Error(`Unexpected ${t}`);
  }
  const root = value();
  skip();
  assert.equal(tokens[i], "</plist>");
  return root;
}

let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const build = (options = {}) => {
  n = 0;
  return michaelShortcut({ uuid, ...options });
};
const id = (a) => a.WFWorkflowActionIdentifier.replace("is.workflow.actions.", "");
const params = (a) => a.WFWorkflowActionParameters;
const items = (field) =>
  Object.fromEntries(
    field.Value.WFDictionaryFieldValueItems.map((it) => [it.WFKey.Value.string, it.WFValue.Value]),
  );

test("the property list parses back to the same shortcut", () => {
  const shortcut = build();
  const xml = toPlist(shortcut);
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.deepEqual(parsePlist(xml), shortcut);
  // The same input gives the same file.
  assert.equal(toPlist(build()), xml);
});

test("on a Mac, plutil accepts the file", { skip: process.platform !== "darwin" }, () => {
  const file = join(mkdtempSync(join(tmpdir(), "michael-shortcut-")), "Michael.shortcut");
  writeFileSync(file, toPlist(build()));
  assert.match(execFileSync("/usr/bin/plutil", ["-lint", file], { encoding: "utf8" }), /OK/);
});

test("it receives Text and Apps and reads its input", () => {
  const shortcut = build();
  assert.deepEqual(shortcut.WFWorkflowInputContentItemClasses, ["WFAppContentItem", "WFStringContentItem"]);
  assert.equal(shortcut.WFWorkflowHasShortcutInputVariables, true);
  assert.deepEqual(shortcut.WFWorkflowTypes, []);
  assert.equal(shortcut.WFWorkflowMinimumClientVersion, 900);
  assert.equal(typeof shortcut.WFWorkflowClientVersion, "string");
  assert.deepEqual(Object.keys(shortcut.WFWorkflowIcon).sort(), [
    "WFWorkflowIconGlyphNumber",
    "WFWorkflowIconStartColor",
  ]);
});

test("the actions are the recipe, in order", () => {
  const actions = build().WFWorkflowActions;
  assert.deepEqual(actions.map(id), [
    "conditional", // If Shortcut Input begins with mk_
    "documentpicker.save",
    "notification",
    "exit",
    "conditional", // Otherwise
    "documentpicker.open",
    "conditional", // If there is no key
    "notification",
    "exit",
    "conditional", // End If
    "downloadurl",
    "conditional", // End If
  ]);
  // If, Otherwise and End If of one block share a grouping id; the inner block has its own.
  const flow = actions.filter((a) => id(a) === "conditional").map(params);
  assert.deepEqual(
    flow.map((p) => p.WFControlFlowMode),
    [FLOW.start, FLOW.otherwise, FLOW.start, FLOW.end, FLOW.end],
  );
  const [outer, otherwise, inner, innerEnd, outerEnd] = flow.map((p) => p.GroupingIdentifier);
  assert.equal(outer, otherwise);
  assert.equal(outer, outerEnd);
  assert.equal(inner, innerEnd);
  assert.notEqual(outer, inner);
});

test("a key that begins with mk_ is saved, with a notification, and nothing is sent", () => {
  const [ifKey, save, notify, stop] = build().WFWorkflowActions;
  assert.equal(params(ifKey).WFCondition, CONDITION.beginsWith);
  assert.equal(params(ifKey).WFConditionalActionString, "mk_");
  assert.equal(params(ifKey).WFInput.Type, "Variable");
  assert.equal(params(ifKey).WFInput.Variable.WFSerializationType, "WFTextTokenAttachment");
  assert.equal(params(ifKey).WFInput.Variable.Value.Type, "ExtensionInput");

  assert.equal(params(save).WFInput.Value.Type, "ExtensionInput");
  assert.equal(params(save).WFAskWhereToSave, false);
  assert.equal(params(save).WFSaveFileOverwrite, true);
  assert.equal(params(save).WFFileDestinationPath, KEY_PATH);
  assert.equal(KEY_PATH, "Michael/key.txt");

  assert.equal(params(notify).WFNotificationActionBody, CONNECTED);
  assert.equal(id(stop), "exit");
});

test("otherwise it reads the key and posts the app's name with it", () => {
  const actions = build().WFWorkflowActions;
  const [read, ifNoKey, notify, stop] = actions.slice(5, 9);
  const post = actions[10];

  assert.equal(params(read).WFGetFilePath, KEY_PATH);
  assert.equal(params(read).WFFileErrorIfNotFound, false);
  const fileUuid = params(read).UUID;

  // No key yet: say how to connect and stop before anything is sent.
  assert.equal(params(ifNoKey).WFCondition, CONDITION.hasNoValue);
  assert.equal(params(ifNoKey).WFInput.Variable.Value.OutputUUID, fileUuid);
  assert.equal(params(notify).WFNotificationActionBody, NOT_CONNECTED);
  assert.equal(id(stop), "exit");

  const p = params(post);
  assert.equal(p.WFURL, "https://api-production-16521a26.up.railway.app/v1/webhooks/ios-shortcuts");
  assert.equal(p.WFURL, `${DEFAULT_API}/v1/webhooks/ios-shortcuts`);
  assert.equal(p.WFHTTPMethod, "POST");
  assert.equal(p.WFHTTPBodyType, "JSON");
  assert.equal(p.WFHTTPHeaders.WFSerializationType, "WFDictionaryFieldValue");
  assert.equal(p.WFJSONValues.WFSerializationType, "WFDictionaryFieldValue");

  // Authorization: "Bearer " then the key file read as text, a magic variable of the read action.
  const headers = items(p.WFHTTPHeaders);
  assert.deepEqual(Object.keys(headers), ["Authorization"]);
  assert.equal(headers.Authorization.string, `Bearer ${OBJ}`);
  const key = headers.Authorization.attachmentsByRange["{7, 1}"];
  assert.equal(key.Type, "ActionOutput");
  assert.equal(key.OutputUUID, fileUuid);

  // { app: <Shortcut Input's Name>, action: "open" }
  const body = items(p.WFJSONValues);
  assert.deepEqual(Object.keys(body), ["app", "input", "action"]);
  assert.equal(body.app.string, OBJ);
  const app = body.app.attachmentsByRange["{0, 1}"];
  assert.equal(app.Type, "ExtensionInput");
  assert.equal(app.Aggrandizements[0].PropertyName, "Name");
  // { input: <Shortcut Input as Text> }: the app name a Text action typed in, as it is.
  const input = body.input.attachmentsByRange["{0, 1}"];
  assert.equal(input.Type, "ExtensionInput");
  assert.equal(input.Aggrandizements[0].CoercionItemClass, "WFStringContentItem");
  assert.deepEqual(body.action, { string: "open" });
});

test("the API base is an argument, and no key is ever in the file", () => {
  const shortcut = build({ api: "https://api.example.com/" });
  assert.equal(
    params(shortcut.WFWorkflowActions[10]).WFURL,
    "https://api.example.com/v1/webhooks/ios-shortcuts",
  );
  assert.throws(() => build({ api: "not a url" }));
  // The only mk_ in the file is the prefix the shortcut tests for.
  assert.deepEqual(toPlist(build()).match(/mk_\w*/g), ["mk_"]);
});

// ---------- Michael Focus (#447) ----------

const buildFocus = () => {
  n = 0;
  return focusShortcut({ uuid });
};

test("Michael Focus: the file parses back, plutil accepts it, and it receives Text", () => {
  const shortcut = buildFocus();
  const xml = toPlist(shortcut);
  assert.deepEqual(parsePlist(xml), shortcut);
  assert.equal(toPlist(buildFocus()), xml);
  assert.deepEqual(shortcut.WFWorkflowInputContentItemClasses, ["WFStringContentItem"]);
  assert.equal(shortcut.WFWorkflowHasShortcutInputVariables, true);
  // The web app and the collector run it by this name; iOS names an import after its file.
  assert.equal(FOCUS_SHORTCUT_NAME, "Michael Focus");
  if (process.platform === "darwin") {
    const file = join(mkdtempSync(join(tmpdir(), "michael-shortcut-")), "Michael Focus.shortcut");
    writeFileSync(file, xml);
    assert.match(execFileSync("/usr/bin/plutil", ["-lint", file], { encoding: "utf8" }), /OK/);
  }
});

test("Michael Focus: check stops, off turns Do Not Disturb off, anything else turns it on until that time", () => {
  const actions = buildFocus().WFWorkflowActions;
  assert.deepEqual(actions.map(id), [
    "conditional", // If the input begins with check
    "exit",
    "conditional", // End If
    "conditional", // If the input begins with off
    "dnd.set",
    "conditional", // Otherwise
    "dnd.set",
    "conditional", // End If
  ]);
  const [ifCheck, , , ifOff, off, , on] = actions;
  assert.equal(params(ifCheck).WFCondition, CONDITION.beginsWith);
  assert.equal(params(ifCheck).WFConditionalActionString, FOCUS_CHECK);
  assert.equal(params(ifOff).WFConditionalActionString, FOCUS_OFF);
  assert.equal(params(ifOff).WFInput.Variable.Value.Type, "ExtensionInput");

  // Only ever Do Not Disturb, the Focus every device has, and only ever "Turn" (never "Toggle").
  for (const a of [off, on]) {
    assert.equal(params(a).Operation, "Turn");
    assert.deepEqual(params(a).FocusModes, DND_MODE);
  }
  assert.equal(DND_MODE.Identifier, "com.apple.donotdisturb.mode.default");
  assert.equal(params(off).Enabled, false);
  assert.equal(params(off).AssertionType, undefined);

  // On, until a time: the input itself, read as text. Never "until turned off".
  assert.equal(params(on).Enabled, true);
  assert.equal(params(on).AssertionType, "Time");
  assert.equal(params(on).Time.WFSerializationType, "WFTextTokenString");
  assert.equal(params(on).Time.Value.string, OBJ);
  assert.equal(params(on).Time.Value.attachmentsByRange["{0, 1}"].Type, "ExtensionInput");
});

test("Michael Focus: it sends nothing anywhere and reads no file", () => {
  const ids = buildFocus().WFWorkflowActions.map(id);
  for (const forbidden of ["downloadurl", "documentpicker.open", "documentpicker.save", "notification"]) {
    assert.ok(!ids.includes(forbidden), forbidden);
  }
});
