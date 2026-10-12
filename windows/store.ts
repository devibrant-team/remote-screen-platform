import { configureStore } from "@reduxjs/toolkit";
import scheduleTimelineReducer from './src/Redux/scheduleTimelineSlice'
export const store = configureStore({
  reducer: {
    scheduleTimeline: scheduleTimelineReducer,
  },
       
  devTools: true 
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
