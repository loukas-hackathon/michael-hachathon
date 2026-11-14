"use server";

import {
  OffTheRecordUpdate,
  type PrivacyState,
  Source,
  type SourceSetting,
  SourceSettingUpdate,
} from "@michael/shared";
import { getPrivacy, patchSource, putOffTheRecord } from "./api";

// Server functions behind the You switches. The browser calls these; only the server talks to the
// API, with the signed-in user's token. Inputs come from the browser, so they are parsed first.

export async function readPrivacy(): Promise<PrivacyState> {
  return getPrivacy();
}

export async function saveOffTheRecord(on: boolean): Promise<PrivacyState> {
  return putOffTheRecord(OffTheRecordUpdate.parse({ off_the_record: on }).off_the_record);
}

export async function saveSource(source: Source, enabled: boolean): Promise<SourceSetting> {
  return patchSource(Source.parse(source), SourceSettingUpdate.parse({ enabled }).enabled);
}
