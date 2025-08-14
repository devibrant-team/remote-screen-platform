import { configureStore } from "@reduxjs/toolkit";
import app from './src/Redux/appSlice'
export const store = configureStore({
  reducer: { app },    
       
  devTools: true 
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
