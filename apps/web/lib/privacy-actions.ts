"use server";

import {
  OffTheRecordUpdate,
  type PrivacyState,
  Source,
  type SourceSetting,
  SourceSettingUpdate,
} from "@michael/shared";
import { ApiFailure, getPrivacy, patchSource, putOffTheRecord } from "./api";
import { demoRefusal } from "./demo-refusal";

// Server functions behind the You switches. The browser calls these; only the server talks to the
// API, with the signed-in user's token. Inputs come from the browser, so they are parsed first.

export async function readPrivacy(): Promise<PrivacyState> {
  return getPrivacy();
}

/** The new state, or `refused` with Michael's line when the API refuses a demo visitor (403). */
export async function saveOffTheRecord(on: boolean): Promise<PrivacyState | { refused: string }> {
  try {
    return await putOffTheRecord(OffTheRecordUpdate.parse({ off_the_record: on }).off_the_record);
  } catch (err) {
    const refused = await demoRefusal(err instanceof ApiFailure ? err.status : undefined);
    if (refused) return { refused };
    throw err;
  }
}

export async function saveSource(source: Source, enabled: boolean): Promise<SourceSetting> {
  return patchSource(Source.parse(source), SourceSettingUpdate.parse({ enabled }).enabled);
}
