// FIRST, before any other module can run top-level code and throw with no
// record. See src/lib/crashRecorder.ts — order is the entire point.
import './src/lib/crashRecorder';
import { registerRootComponent } from 'expo';
import App from './src/App.tsx';

registerRootComponent(App);
