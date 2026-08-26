import { useEffect, useRef } from "react";
import { store, applyFrame } from "../store/telemetryStore";

const WS_URL =  import.meta.env.VITE_PATH;
const RECONNECT_DELAY_MS = 3000;

/**
 * useTelemetryWS
 * Opens the WebSocket, parses every message into the mutable store.
 * Never calls setState — zero re-renders from this hook.
 * onStatusChange(connected: boolean) is called when connection state changes.
 *
 * `running` is the Start/Stop/Resume control: while false, no socket is
 * open at all (no auto-connect on mount, no reconnect loop) — flipping it
 * true opens a fresh connection, flipping it back to false closes the
 * current one and cancels any pending reconnect. Data already in the store
 * is untouched either way; only App.jsx's "Start" (fresh) path clears it
 * via resetStore(), "Resume" just flips `running` back on.
 */
export function useTelemetryWS(running, onStatusChange) {
  const wsRef      = useRef(null);
  const timerRef   = useRef(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    if (!running) return;
    mountedRef.current = true;

    function connect() {
      if (!mountedRef.current) return;

      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        if (wsRef.current !== ws) return; // stale socket from a previous effect run
        store.connected = true;
        onStatusChange?.(true);
      };

      ws.onmessage = (event) => {
        if (wsRef.current !== ws) return; // stale socket from a previous effect run
        try {
          const data = JSON.parse(event.data);
          applyFrame(data);
        } catch {
          // malformed frame — skip silently
        }
      };

      ws.onerror = () => {
        // onerror always fires before onclose — let onclose handle reconnect
      };

      ws.onclose = () => {
        if (wsRef.current !== ws) return; // stale socket from a previous effect run — don't reconnect on its behalf
        store.connected = false;
        onStatusChange?.(false);
        if (mountedRef.current) {
          timerRef.current = setTimeout(connect, RECONNECT_DELAY_MS);
        }
      };
    }

    connect();

    return () => {
      mountedRef.current = false;
      clearTimeout(timerRef.current);
      wsRef.current?.close();
      wsRef.current = null;
      // The close() above fires its "close" event asynchronously, by which
      // point wsRef.current is already null — onclose's own stale-socket
      // guard would then skip updating status. Set it here instead, so
      // Stop reflects "disconnected" immediately rather than leaving the
      // indicator stuck on "Connected".
      store.connected = false;
      onStatusChange?.(false);
    };
  }, [running]);
}
