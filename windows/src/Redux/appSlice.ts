// src/Redux/appSlice.ts
import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

type AppState = {
  screenId?: string;
  code?: number | string;
};

const initialState: AppState = {};

const appSlice = createSlice({
  name: "app",
  initialState,
  reducers: {
    setScreenId(state, action: PayloadAction<string | undefined>) {
      state.screenId = action.payload;
    },
    setCode(state, action: PayloadAction<number | string | undefined>) {
      state.code = action.payload;
    },
  },
});

export const { setScreenId, setCode } = appSlice.actions;
export default appSlice.reducer;
