// src/types/echo-reverb.d.ts
import "laravel-echo";

// نضيف 'reverb' كمفتاح مدعوم ضمن Broadcasters لـ laravel-echo
declare module "laravel-echo" {
  interface Broadcasters {
    reverb: {}; // ممكن تستخدم {} أو unknown
  }
}
