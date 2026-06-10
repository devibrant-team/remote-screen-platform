//src/Api/Api.ts
import { apiBase } from "../config/serverConfig";

export function http() {
  const baseUrl = apiBase();
  console.log("[WINDOWS API CONFIG]", { baseUrl });
  return baseUrl;
}

const endpoint = (path: string) => `${http()}${path}`;

export const CreateScreenApi = () => endpoint("create/screen/windows");
export const GetParentScheduleApi = () => endpoint("showschedule");
export const GetChildPlaylistApi = () => endpoint("showscheduleplaylist");
export const DefaultPlayListApi = () => endpoint("showsdefault");
export const SendStatusApi = () => endpoint("status/");
export const TimeClockApi = () => endpoint("servertime");
export const CheckScreenApi = () => endpoint("checkscreen/");
export const GetRotationApi = () => endpoint("showrotation");
