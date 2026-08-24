import { useEffect, useRef } from "react";
import { io } from "socket.io-client";
import { API_BASE_URL } from "./config";

// One shared Socket.IO connection for the whole app.
//
// Components used to call io(API_BASE_URL) individually — Chat and Header each
// opened their own — which meant several sockets per tab, several "register"
// handshakes, and no single place to listen for change events. This module
// owns the connection and hands out subscriptions.
let socket = null;

export function getSocket() {
  if (!socket) {
    socket = io(API_BASE_URL, {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 1000,
    });

    // Re-announce who we are after any reconnect, so the server can put this
    // socket back into its user room (used for direct messages and task
    // assignment notifications).
    const announce = () => {
      const userId = sessionStorage.getItem("userId");
      if (userId) socket.emit("register", Number(userId));
    };
    socket.on("connect", announce);
    announce();
  }
  return socket;
}

/**
 * Re-run `onChange` whenever the server reports that one of `resources`
 * changed anywhere in the system.
 *
 * The server sends only the resource name, never the record, so the callback
 * should refetch through the normal scoped endpoint — that keeps the
 * reporting-tree visibility rules in force.
 *
 *   useLiveUpdates(["leads"], fetchLeads);
 *
 * `resources` is compared by value, so an inline array is fine and will not
 * cause the effect to re-subscribe on every render.
 */
export function useLiveUpdates(resources, onChange) {
  const handlerRef = useRef(onChange);
  handlerRef.current = onChange;

  const key = Array.isArray(resources) ? resources.join(",") : String(resources);

  useEffect(() => {
    const wanted = key.split(",").filter(Boolean);
    if (wanted.length === 0) return undefined;

    const s = getSocket();
    const listener = (payload) => {
      if (!payload || !wanted.includes(payload.resource)) return;
      // Guarded: a throwing screen must not kill the socket for every other
      // screen sharing this connection.
      try {
        handlerRef.current(payload);
      } catch (err) {
        console.error("Live update handler failed:", err);
      }
    };

    s.on("data_changed", listener);
    return () => s.off("data_changed", listener);
  }, [key]);
}

export default useLiveUpdates;
