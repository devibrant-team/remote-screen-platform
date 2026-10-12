//src/ReactQuery/CreateScreen/CreateScreen.ts
import axios, { AxiosError } from "axios";
import { useMutation, type UseMutationOptions } from "@tanstack/react-query";
import { CreateScreenApi } from "../../Api/Api"; // e.g. "http://.../api/screens"

// --- API response as your backend returns it ---
export interface ApiCreateScreenResponse {
  id: number;
  name: string;
  code: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

// --- Mapped shape your UI can use directly ---
export interface CreateScreenResponse {
  screenId: string;           // mapped from raw.id
  code: number;               // pairing code to display
  raw: ApiCreateScreenResponse;
}

// POST with no body; map the response
async function createScreenRequest(): Promise<CreateScreenResponse> {
  const res = await axios.post<ApiCreateScreenResponse>(CreateScreenApi(), {});
  const raw = res.data;
  return { screenId: String(raw.id), code: Number(raw.code), raw };
}

// Save to Electron's persistent store (via preload API)
async function saveToDevice(screenId: string) {
  const api = window.signage;
  if (api?.saveScreenId) {
    const result = await api.saveScreenId(screenId);
    if (result?.ok !== true) {
      throw new Error("Could not persist the paired screen ID");
    }
  }
}

// Hook with built-in onSuccess logic; also calls user-provided onSuccess if given
export function useCreateScreen(
  options?: UseMutationOptions<CreateScreenResponse, AxiosError, void>
) {
  const { onSuccess, ...rest } = options ?? {};
  return useMutation<CreateScreenResponse, AxiosError, void>({
    mutationKey: ["createScreen"],
    mutationFn: createScreenRequest,
    onSuccess: async (data, variables, context, mutationContext) => {
      await saveToDevice(data.screenId);       // <-- auto-save to electron-store
      onSuccess?.(data, variables, context, mutationContext);   // <-- still allow custom handler
    },
    ...rest,
  });
}
