import { configureStore } from "@reduxjs/toolkit";
import app from './src/Redux/appSlice'
import scheduleTimelineReducer from './src/Redux/scheduleTimelineSlice'
export const store = configureStore({
  reducer: { 
    scheduleTimeline: scheduleTimelineReducer,
    app },    
       
  devTools: true 
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
