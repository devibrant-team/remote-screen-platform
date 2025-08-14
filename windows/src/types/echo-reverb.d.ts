import 'laravel-echo';

declare module 'laravel-echo' {
  // Tell Echo that 'reverb' is a valid broadcaster key
  interface Broadcasters {
    reverb: unknown;
  }
}