"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ConnectionState, Room, RoomEvent, Track, type RemoteTrack, type Track as LiveTrack } from "livekit-client";
import { getSupabaseClient } from "@/lib/supabase/client";

export type KinfolkCall = {
  id: string;
  conversation_id: string;
  caller_id: string;
  callee_id: string;
  call_type: "audio" | "video";
  status: "ringing" | "active" | "declined" | "missed" | "ended";
  created_at: string;
  accepted_at: string | null;
  ended_at?: string | null;
};

function MediaTrack({ track, muted = false }: { track: LiveTrack | null; muted?: boolean }) {
  const holder = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!track || !holder.current) return;
    const element = track.attach();
    if (element instanceof HTMLMediaElement) {
      element.autoplay = true;
      element.muted = muted;
    }
    if (element instanceof HTMLVideoElement) element.playsInline = true;
    holder.current.appendChild(element);
    return () => {
      track.detach(element);
      element.remove();
    };
  }, [track, muted]);
  return <div ref={holder} className={track?.kind === Track.Kind.Audio ? "call-audio" : "call-video-track"} />;
}

export default function CallWindow({
  call,
  peerName,
  onEnd,
  onError,
}: {
  call: KinfolkCall;
  peerName: string;
  onEnd: () => void;
  onError: (message: string) => void;
}) {
  const supabase = useMemo(() => getSupabaseClient(), []);
  const [room, setRoom] = useState<Room | null>(null);
  const [roomConnected, setRoomConnected] = useState(false);
  const [connection, setConnection] = useState("Connecting securely…");
  const [remoteVideo, setRemoteVideo] = useState<RemoteTrack | null>(null);
  const [remoteAudio, setRemoteAudio] = useState<RemoteTrack[]>([]);
  const [localVideo, setLocalVideo] = useState<LiveTrack | null>(null);
  const [muted, setMuted] = useState(false);
  const [cameraOn, setCameraOn] = useState(call.call_type === "video");
  const [callError, setCallError] = useState("");
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    const liveRoom = new Room({ adaptiveStream: true, dynacast: true });
    setRoom(liveRoom);
    setRoomConnected(false);
    liveRoom.on(RoomEvent.TrackSubscribed, (track) => {
      if (track.kind === Track.Kind.Video) setRemoteVideo(track);
      if (track.kind === Track.Kind.Audio) setRemoteAudio((tracks) => tracks.includes(track) ? tracks : [...tracks, track]);
    });
    liveRoom.on(RoomEvent.TrackUnsubscribed, (track) => {
      if (track.kind === Track.Kind.Video) setRemoteVideo((current) => current === track ? null : current);
      if (track.kind === Track.Kind.Audio) setRemoteAudio((tracks) => tracks.filter((item) => item !== track));
    });
    liveRoom.on(RoomEvent.ConnectionStateChanged, (state) => {
      setConnection(state === ConnectionState.Connected ? "Connected" : state === ConnectionState.Reconnecting ? "Reconnecting…" : state === ConnectionState.Disconnected ? "Disconnected" : "Connecting…");
      setRoomConnected(state === ConnectionState.Connected);
    });
    void (async () => {
      try {
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError || !sessionData.session?.access_token) throw new Error("Sign in again before placing a call.");
        const response = await fetch("/api/livekit/token", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${sessionData.session.access_token}` },
          body: JSON.stringify({ callSessionId: call.id }),
        });
        const data = await response.json().catch(() => null) as { serverUrl?: string; roomName?: string; participantToken?: string; error?: string } | null;
        if (!response.ok) throw new Error(`Call token request failed (${response.status}): ${data?.error ?? response.statusText ?? "unknown server error"}`);
        if (!data?.serverUrl || !data.roomName || !data.participantToken) throw new Error(data?.error ?? "Call token response is missing the room URL, room name, or participant token.");
        if (data.roomName !== call.id) throw new Error("Call token was issued for a different room. Refresh the call and try again.");
        let endpoint: URL;
        try { endpoint = new URL(data.serverUrl); }
        catch { throw new Error("Call service returned an invalid LiveKit URL."); }
        if (!["wss:", "ws:"].includes(endpoint.protocol)) throw new Error("Call service returned a URL that is not a WebSocket endpoint.");
        if (cancelled) return;
        await liveRoom.connect(data.serverUrl, data.participantToken);
        if (!cancelled) {
          setRoomConnected(true);
          setConnection(call.status === "active" ? "Connected" : "Ringing…");
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : "Could not connect this call.";
          setCallError(message);
          onError(message);
        }
      }
    })();
    return () => {
      cancelled = true;
      for (const publication of liveRoom.localParticipant.trackPublications.values()) publication.track?.stop();
      void liveRoom.disconnect(true);
      liveRoom.removeAllListeners();
    };
  }, [call.id, supabase, onError]);

  useEffect(() => {
    if (!room || !roomConnected || call.status !== "active") return;
    let cancelled = false;
    void (async () => {
      try {
        await room.localParticipant.setMicrophoneEnabled(true);
        if (call.call_type === "video") {
          await room.localParticipant.setCameraEnabled(true);
          if (cancelled) return;
          setLocalVideo(room.localParticipant.getTrackPublication(Track.Source.Camera)?.track ?? null);
        }
      } catch (error) {
        const message = error instanceof Error && error.name === "NotAllowedError"
          ? "Camera or microphone permission was denied. Allow access in your browser settings and try again."
          : error instanceof Error ? error.message : "Could not access your camera or microphone.";
        setCallError(message);
        onError(message);
      }
    })();
    return () => { cancelled = true; };
  }, [room, roomConnected, call.status, call.call_type, onError]);

  useEffect(() => {
    if (call.status !== "active" || !call.accepted_at) { setElapsed(0); return; }
    const update = () => setElapsed(Math.max(0, Math.floor((Date.now() - new Date(call.accepted_at!).getTime()) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [call.status, call.accepted_at]);

  useEffect(() => {
    if (!room || call.status !== "active" || !supabase) return;
    const heartbeat = () => { void supabase.rpc("touch_direct_call", { target_call: call.id }); };
    heartbeat();
    const timer = window.setInterval(heartbeat, 20_000);
    return () => window.clearInterval(timer);
  }, [room, call.id, call.status, supabase]);

  async function toggleMute() {
    if (!room) return;
    try {
      await room.localParticipant.setMicrophoneEnabled(muted);
      setMuted(!muted);
    } catch (error) { setCallError(error instanceof Error ? error.message : "Could not change microphone state."); }
  }

  async function toggleCamera() {
    if (!room || call.call_type !== "video") return;
    try {
      await room.localParticipant.setCameraEnabled(!cameraOn);
      setCameraOn(!cameraOn);
      setLocalVideo(!cameraOn ? room.localParticipant.getTrackPublication(Track.Source.Camera)?.track ?? null : null);
    } catch (error) { setCallError(error instanceof Error ? error.message : "Could not change camera state."); }
  }

  const duration = `${Math.floor(elapsed / 60).toString().padStart(2, "0")}:${(elapsed % 60).toString().padStart(2, "0")}`;
  return <section className="call-window" role="dialog" aria-modal="true" aria-label={`${call.call_type} call with ${peerName}`}>
    <header className="call-topbar"><div><strong>{peerName}</strong><small>{call.status === "active" ? `${connection} · ${duration}` : connection}</small></div><button onClick={onEnd} aria-label="End call">×</button></header>
    <div className={`call-stage ${call.call_type}`}>
      {call.call_type === "video" && remoteVideo ? <MediaTrack track={remoteVideo} /> : <div className="call-avatar">{peerName.trim().slice(0, 1).toUpperCase() || "K"}</div>}
      {remoteAudio.map((track, index) => <MediaTrack key={`${track.sid}-${index}`} track={track} />)}
      {call.call_type === "video" && localVideo && <div className="call-local"><MediaTrack track={localVideo} muted /></div>}
      {!callError && call.status === "ringing" && <p className="call-ringing">Calling {peerName}…</p>}
      {callError && <p className="call-error">{callError}</p>}
    </div>
    <footer className="call-controls">
      <button onClick={() => void toggleMute()} disabled={!room || call.status !== "active"}>{muted ? "Unmute" : "Mute"}</button>
      {call.call_type === "video" && <button onClick={() => void toggleCamera()} disabled={!room || call.status !== "active"}>{cameraOn ? "Camera off" : "Camera on"}</button>}
      <button className="call-end" onClick={onEnd}>End call</button>
    </footer>
  </section>;
}
