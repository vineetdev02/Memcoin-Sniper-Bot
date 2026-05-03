"use client";

import { useEffect } from "react";
import { getSocket } from "@/lib/socket";
import { useFeedStore } from "@/lib/store";

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const addPool = useFeedStore((s) => s.addPool);
  const setStatus = useFeedStore((s) => s.setStatus);
  const setConnected = useFeedStore((s) => s.setConnected);
  const replacePools = useFeedStore((s) => s.replacePools);

  useEffect(() => {
    const socket = getSocket();

    const onConnect = () => {
      setConnected(true);
      socket.emit("pool:replay", 50, (events) => {
        replacePools(events);
      });
    };

    const onDisconnect = () => setConnected(false);

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("pool:new", addPool);
    socket.on("system:status", setStatus);

    if (socket.connected) onConnect();

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("pool:new", addPool);
      socket.off("system:status", setStatus);
    };
  }, [addPool, setStatus, setConnected, replacePools]);

  return <>{children}</>;
}
