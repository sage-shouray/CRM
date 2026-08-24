import { useEffect, useRef } from "react";
import axios from "axios";
import { API_BASE_URL } from "./config";

// Reports presence while the app is open.
//
// The point is to distinguish working from merely signed in, so a beat is only
// marked "active" when the browser saw real mouse, keyboard, scroll or touch
// input in the last IDLE_AFTER_MS. A tab left open on an empty desk keeps
// beating, but every beat says "idle" — which is exactly the distinction that
// login/logout times can never make.
//
// Nothing about what the user typed or looked at is sent: a state, and the
// route name so a manager can see which screens the time went to.
const BEAT_MS = 60 * 1000;
const IDLE_AFTER_MS = 2 * 60 * 1000;

export default function useHeartbeat() {
  const lastInputAt = useRef(Date.now());

  useEffect(() => {
    const markInput = () => {
      lastInputAt.current = Date.now();
    };

    const events = ["mousemove", "mousedown", "keydown", "scroll", "touchstart"];
    events.forEach((e) =>
      window.addEventListener(e, markInput, { passive: true })
    );

    const beat = async () => {
      const token = sessionStorage.getItem("token");
      if (!token) return;
      // A hidden tab is not work, whatever the input timer says.
      if (document.visibilityState === "hidden") return;

      const state =
        Date.now() - lastInputAt.current < IDLE_AFTER_MS ? "active" : "idle";

      try {
        await axios.post(`${API_BASE_URL}/api/activity/heartbeat`, {
          state,
          page: window.location.pathname,
        });
      } catch (err) {
        // Presence is best-effort; never surface a failure to the user.
      }
    };

    beat();
    const timer = setInterval(beat, BEAT_MS);

    return () => {
      clearInterval(timer);
      events.forEach((e) => window.removeEventListener(e, markInput));
    };
  }, []);
}
