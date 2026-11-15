// Reads a shortcut property list through macOS' own Shortcuts frameworks, in memory, and prints
// how the system understands every action and parameter. Nothing is imported, saved or shown.
// It is the closest a machine gets to opening the file in the Shortcuts editor (#303):
//
//   osascript -l JavaScript scripts/shortcut/inspect.jxa.js scripts/shortcut/out/Michael.shortcut
//
// A star marks a parameter the file sets; the others show the system's default. A line "keys in
// the file that are not parameters" is fine for UUID and for If's own keys (GroupingIdentifier,
// WFControlFlowMode, WFCondition, WFInput, WFConditionalActionString: the system folds those into
// WFConditions). Anything else there is a key the system would ignore.
// These are private frameworks: if a macOS update moves them, this script breaks, the shortcut does not.

ObjC.import("Foundation");
for (const name of ["WorkflowKit", "ActionKit", "ContentKit"]) {
  $.NSBundle.bundleWithPath(`/System/Library/PrivateFrameworks/${name}.framework`).load;
}

const args = $.NSProcessInfo.processInfo.arguments;
const path = ObjC.unwrap(args.objectAtIndex(args.count - 1));
const data = $.NSData.dataWithContentsOfFile(path);
const text = (o) => {
  try {
    return ObjC.unwrap(o.description).replace(/\s+/g, " ");
  } catch {
    return String(o);
  }
};
const isNil = (o) => !o || (typeof o.isNil === "function" && o.isNil());
const className = (o) => ObjC.unwrap($.NSStringFromClass(o.class));

const error = Ref();
const file = $.NSClassFromString("WFWorkflowFile").alloc.initWithFileDataNameError(data, "Michael", error);
console.log(
  isNil(file) ? `The system could not read ${path}` : `The system reads ${path} as a shortcut file.`,
);

const plist = $.NSPropertyListSerialization.propertyListWithDataOptionsFormatError(data, 0, null, null);
console.log(`Receives: ${text(plist.objectForKey("WFWorkflowInputContentItemClasses"))}`);
const actions = plist.objectForKey("WFWorkflowActions");
const registry = $.NSClassFromString("WFActionRegistry").sharedRegistry;

for (let i = 0; i < actions.count; i++) {
  const entry = actions.objectAtIndex(i);
  const identifier = entry.objectForKey("WFWorkflowActionIdentifier");
  const given = entry.objectForKey("WFWorkflowActionParameters");
  const givenKeys = ObjC.unwrap(given.allKeys).map((k) => ObjC.unwrap(k));
  const action = registry.createActionWithIdentifierSerializedParameters(identifier, given);
  console.log(`#${i + 1} ${ObjC.unwrap(identifier)}: ${className(action)}, "${text(action.localizedName)}"`);
  const known = [];
  for (let j = 0; j < action.parameters.count; j++) {
    const parameter = action.parameters.objectAtIndex(j);
    const key = ObjC.unwrap(parameter.key);
    known.push(key);
    const state = action.parameterStateForKey(parameter.key);
    const shown = isNil(state) ? "not set" : `${className(state)} ${text(state.serializedRepresentation)}`;
    console.log(`    ${givenKeys.includes(key) ? "*" : " "} ${key} (${className(parameter)}): ${shown}`);
  }
  const extra = givenKeys.filter((k) => !known.includes(k));
  if (extra.length) console.log(`    keys in the file that are not parameters: ${extra.join(", ")}`);
}
