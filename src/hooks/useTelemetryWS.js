import { useEffect, useRef } from "react";
import { store, applyFrame } from "../store/telemetryStore";

const WS_URL = "ws://192.168.123.251:8055/ws/telemetry";
const RECONNECT_DELAY_MS = 3000;

/**
 * useTelemetryWS
 * Opens the WebSocket, parses every message into the mutable store.
 * Never calls setState — zero re-renders from this hook.
 * onStatusChange(connected: boolean) is called when connection state changes.
 */
export function useTelemetryWS(onStatusChange) {
  const wsRef      = useRef(null);
  const timerRef   = useRef(null);
  const mountedRef = useRef(true);

  useEffect(() => {
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
    };
  }, []);
}
