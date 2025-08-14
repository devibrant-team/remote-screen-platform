import { configureStore } from "@reduxjs/toolkit";

export const store = configureStore({
  reducer: {},        // add slices here
  devTools: true      // keep it simple; always enable DevTools
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
