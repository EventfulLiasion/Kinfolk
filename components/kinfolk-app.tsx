"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabaseClient } from "@/lib/supabase/client";
import CallWindow, { type KinfolkCall } from "@/components/call-window";

type Profile = { id: string; display_name: string; avatar_path?: string | null; bio?: string | null; avatarUrl?: string };
type MainTab = "chats" | "calls" | "updates" | "media" | "profile";
type StatusUpdate = { id: string; user_id: string; conversation_id: string; body: string; media_path: string | null; content_type: "text" | "image" | "video"; created_at: string; expires_at: string; mediaUrl?: string; mediaError?: string; mediaLoading?: boolean; mediaRetryAttempted?: boolean; mediaSignedAt?: number };
type CallLog = KinfolkCall & { ended_at: string | null };
type Conversation = {
  id: string;
  created_at: string;
  peer: Profile | null;
  lastMessage: Message | null;
};
type Message = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  content_type: "text" | "image" | "video" | "audio" | "file";
  storage_path: string | null;
  attachment_name: string | null;
  mime_type: string | null;
  file_size: number | null;
  deleted_at: string | null;
  mediaUrl?: string;
};

const EMOJI_CATEGORIES = [
  { label: "Smileys", icon: "😊", items: "😀 😃 😄 😁 😆 😅 😂 🤣 🥲 ☺️ 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😙 😚 😋 😛 😜 🤪 😎 🥳 🥹 🥺 😏 😴 😭 😢 😤 😡 🤗 🤔 🫠 🫶" },
  { label: "People", icon: "👋", items: "👋 🤚 🖐️ ✋ 🖖 🫱 🫲 🫳 🫴 👌 🤌 🤏 ✌️ 🤞 🫰 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 👐 🤲 🙏 💅 💪 🦾 🧠 👀 🫂" },
  { label: "Nature", icon: "🌿", items: "🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🐧 🐦 🦋 🐢 🐬 🐳 🦄 🌸 🌼 🌻 🌷 🌹 🪻 🌱 🍀 🌿 🌵 🌴 🍁 🍂 🌈 ☀️ 🌙 ⭐ ✨ 🌧️ ❄️" },
  { label: "Food", icon: "🍓", items: "🍎 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🥑 🍕 🍔 🍟 🌮 🍜 🍣 🍩 🍪 🎂 🍰 🧁 🍫 🍿 ☕ 🧋 🥤 🍵 🥐 🥨 🧀 🍯" },
  { label: "Activities", icon: "🎉", items: "⚽ 🏀 🏈 ⚾ 🎾 🏐 🎱 🏓 🏸 🥊 🏆 🥇 🎮 🕹️ 🎲 🧩 🎨 🎭 🎤 🎧 🎼 🎹 🎸 🎻 🎬 🎟️ 🎉 🎊 🎈 🪩" },
  { label: "Travel", icon: "🚗", items: "🚗 🚕 🚌 🚎 🚲 🛵 🛴 🚂 ✈️ 🚀 🛸 🚁 ⛵ 🚤 🚢 🗺️ 🏕️ 🏖️ 🏝️ 🏠 🏡 🏙️ 🌃 🌉 🗼 🗽 🏰 ⛺ 🧳" },
  { label: "Objects", icon: "💡", items: "💌 💝 💖 💗 💓 💞 💕 ❤️ 🧡 💛 💚 💙 💜 🤍 🤎 🖤 💔 💬 🗨️ 💭 🔥 💫 💡 📸 🎁 🧸 🪄 🔑 📚 📝 🪴 🕯️" },
  { label: "Symbols", icon: "✅", items: "✅ ☑️ ✔️ ❌ ❎ ➕ ➖ ➰ 🔁 🔔 🔕 💯 ❗ ❓ ‼️ ♻️ ❤️‍🔥 💘 💟 ✨ ⭐ 🌟 ☮️ ☯️ ♾️" },
].map((category) => ({ ...category, emojis: category.items.split(" ") }));
const STICKER_EMOJIS = ["🥰", "🫶", "😂", "🥹", "😹", "🙈", "🤗", "😘", "😍", "🤩", "😎", "🥳", "😴", "🤔", "😱", "😭", "💖", "💕", "✨", "🌸", "🐱", "🐻", "🦄", "🎉", "👋", "🙏", "💐", "🍓", "☕", "🌈"];
const CHAT_WALLPAPERS = [
  { id: "paper", label: "Warm paper", color: "#f8f7f1" },
  { id: "sage", label: "Soft sage", color: "#edf5eb" },
  { id: "dusk", label: "Evening dusk", color: "#f1eef8" },
  { id: "blush", label: "Rosewater", color: "#fbefeb" },
  { id: "ocean", label: "Quiet ocean", color: "#edf4f8" },
  { id: "midnight", label: "Midnight", color: "#25332d" },
];
const STICKER_SET = new Set(STICKER_EMOJIS);
function isStickerMessage(body: string) { return STICKER_SET.has(body.trim()); }

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "K";
}
function errorText(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  return "Something went wrong. Please try again.";
}
function missingSocialSchema(error: { code?: string; message?: string } | null | undefined) {
  return Boolean(error && (error.code === "PGRST204" || error.code === "PGRST205" || error.code === "42703"
    || /status_updates|avatar_path|bio/i.test(error.message ?? "") && /schema cache|column|table|not find|does not exist/i.test(error.message ?? "")));
}
function socialMigrationHint(feature: string) {
  return `${feature} needs the Kinfolk social-features migration. In Supabase SQL Editor, run supabase/migrations/20261010050000_social_features.sql, then refresh this page.`;
}
function logStatusMediaProblem(operation: string, error: unknown) {
  const value = error && typeof error === "object" ? error as { code?: unknown; status?: unknown; message?: unknown } : {};
  const message = String(value.message ?? "Unknown storage error")
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[URL redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[token redacted]")
    .slice(0, 240);
  console.warn("Kinfolk status media issue", { operation, code: value.code ?? null, status: value.status ?? null, message });
}
function timeLabel(value: string) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}
function dateLabel(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}
function avatarColors(name: string) {
  const colors = ["sage", "peach", "lilac", "blue"];
  return colors[name.charCodeAt(0) % colors.length];
}
function Avatar({ name, src, className = "" }: { name: string; src?: string | null; className?: string }) {
  return <span className={`avatar ${className || avatarColors(name)} ${src ? "avatar-photo" : ""}`}>{src ? <img src={src} alt="" /> : initials(name)}</span>;
}
function messagePreview(message: Message) {
  if (message.content_type === "image") return "▧ Photo";
  if (message.content_type === "video") return "▶ Video";
  if (message.content_type === "audio") return "♫ Voice message";
  if (message.content_type === "file") return "↧ " + (message.attachment_name ?? "File");
  return message.body;
}
function readSavedConversation(userId: string) {
  try { return window.localStorage.getItem(`kinfolk:lastConversation:${userId}`) ?? ""; }
  catch { return ""; }
}
function saveConversation(userId: string, conversationId: string | null) {
  try {
    const key = `kinfolk:lastConversation:${userId}`;
    if (conversationId) window.localStorage.setItem(key, conversationId);
    else window.localStorage.removeItem(key);
  } catch { /* Conversation selection remains usable when browser storage is unavailable. */ }
}

export default function KinfolkApp() {
  const supabase = useMemo(() => getSupabaseClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [activeTab, setActiveTab] = useState<MainTab>("chats");
  const [inviteCode, setInviteCode] = useState("");
  const [authBusy, setAuthBusy] = useState(true);
  const [busy, setBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [notice, setNotice] = useState("");
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [openMessageMenu, setOpenMessageMenu] = useState("");
  const [draft, setDraft] = useState("");
  const [composerPanel, setComposerPanel] = useState<"emoji" | "stickers" | "wallpaper" | null>(null);
  const [emojiCategory, setEmojiCategory] = useState(0);
  const [chatWallpapers, setChatWallpapers] = useState<Record<string, string>>({});
  const [wallpaperPrefsReady, setWallpaperPrefsReady] = useState(false);
  const [connection, setConnection] = useState<"idle" | "connecting" | "connected" | "offline">("idle");
  const [connectionWarningDismissed, setConnectionWarningDismissed] = useState(false);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState("");
  const [messageError, setMessageError] = useState("");
  const [deletingMessageId, setDeletingMessageId] = useState("");
  const [incomingCall, setIncomingCall] = useState<KinfolkCall | null>(null);
  const [activeCall, setActiveCall] = useState<KinfolkCall | null>(null);
  const activeCallRef = useRef<KinfolkCall | null>(null);
  const incomingCallRef = useRef<KinfolkCall | null>(null);
  activeCallRef.current = activeCall;
  incomingCallRef.current = incomingCall;
  const [uploadProgress, setUploadProgress] = useState("");
  const [inviteInput, setInviteInput] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [mobileChat, setMobileChat] = useState(false);
  const [copied, setCopied] = useState(false);
  const [callLogs, setCallLogs] = useState<CallLog[]>([]);
  const [callLogsLoading, setCallLogsLoading] = useState(false);
  const [statuses, setStatuses] = useState<StatusUpdate[]>([]);
  const [statusesLoading, setStatusesLoading] = useState(false);
  const [statusComposerOpen, setStatusComposerOpen] = useState(false);
  const [statusCaption, setStatusCaption] = useState("");
  const [statusFile, setStatusFile] = useState<File | null>(null);
  const [statusPosting, setStatusPosting] = useState(false);
  const [deletingStatusId, setDeletingStatusId] = useState("");
  const [mediaLibrary, setMediaLibrary] = useState<Message[]>([]);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [profileNameDraft, setProfileNameDraft] = useState("");
  const [profileBioDraft, setProfileBioDraft] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [tabError, setTabError] = useState("");
  const [socialSchemaReady, setSocialSchemaReady] = useState(false);
  const statusMediaRefreshes = useRef(new Set<string>());

  useEffect(() => {
    setWallpaperPrefsReady(false);
    if (!user) {
      setChatWallpapers({});
      return;
    }
    try {
      const saved = window.localStorage.getItem(`kinfolk:chat-wallpapers:${user.id}`);
      const parsed = saved ? JSON.parse(saved) as Record<string, unknown> : {};
      setChatWallpapers(Object.fromEntries(Object.entries(parsed).filter(([, wallpaper]) => CHAT_WALLPAPERS.some((choice) => choice.id === wallpaper))) as Record<string, string>);
    } catch {
      setChatWallpapers({});
    }
    setWallpaperPrefsReady(true);
  }, [user?.id]);

  useEffect(() => {
    if (!user || !wallpaperPrefsReady) return;
    try { window.localStorage.setItem(`kinfolk:chat-wallpapers:${user.id}`, JSON.stringify(chatWallpapers)); }
    catch { /* Wallpaper choice remains usable for this session if storage is unavailable. */ }
  }, [chatWallpapers, user?.id, wallpaperPrefsReady]);

  useEffect(() => {
    if (!supabase) {
      setAuthBusy(false);
      return;
    }
    let alive = true;
    supabase.auth.getSession().then(({ data, error }) => {
      if (!alive) return;
      if (error) setAuthError(error.message);
      setUser(data.session?.user ?? null);
      setAuthBusy(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setAuthBusy(false);
      setAuthError("");
      setNotice("");
    });
    return () => {
      alive = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  const loadConversations = useCallback(async (userId: string) => {
    if (!supabase) return [];
    setDataLoading(true);
    setDataError("");
    try {
      let [profileResult, inviteResult, conversationResult] = await Promise.all([
        supabase.from("profiles").select("id,display_name,avatar_path,bio").eq("id", userId).single(),
        supabase.rpc("get_my_invite_code"),
        supabase.from("conversations").select("id,created_at").order("created_at", { ascending: false }),
      ]);
      if (missingSocialSchema(profileResult.error)) {
        setSocialSchemaReady(false);
        profileResult = await supabase.from("profiles").select("id,display_name").eq("id", userId).single();
      } else if (!profileResult.error) setSocialSchemaReady(true);
      if (profileResult.error) throw profileResult.error;
      if (inviteResult.error) throw inviteResult.error;
      if (conversationResult.error) throw conversationResult.error;
      const ownProfile = profileResult.data as unknown as Profile;
      const ownAvatar = ownProfile.avatar_path
        ? await supabase.storage.from("kinfolk-avatars").createSignedUrl(ownProfile.avatar_path, 3600)
        : null;
      setProfile({ ...ownProfile, avatarUrl: ownAvatar?.data?.signedUrl });
      setInviteCode(String(inviteResult.data ?? ""));
      const rows = (conversationResult.data ?? []) as { id: string; created_at: string }[];
      if (rows.length === 0) {
        setConversations([]);
        setSelectedId("");
        setMessages([]);
        saveConversation(userId, null);
        return [];
      }
      const ids = rows.map((row) => row.id);
      const [membersResult, messagesResult, hiddenResult] = await Promise.all([
        supabase.from("conversation_members").select("conversation_id,user_id").in("conversation_id", ids),
        supabase.from("messages").select("id,conversation_id,sender_id,body,created_at,content_type,storage_path,attachment_name,mime_type,file_size,deleted_at").in("conversation_id", ids).order("created_at", { ascending: false }),
        supabase.from("message_deletions").select("message_id").eq("user_id", userId),
      ]);
      if (membersResult.error) throw membersResult.error;
      if (messagesResult.error) throw messagesResult.error;
      if (hiddenResult.error) throw hiddenResult.error;
      const members = (membersResult.data ?? []) as { conversation_id: string; user_id: string }[];
      const peers = [...new Set(members.filter((member) => member.user_id !== userId).map((member) => member.user_id))];
      let profileRows: Profile[] = [];
      if (peers.length) {
        const profilesResult = await supabase.from("profiles").select("id,display_name,avatar_path,bio").in("id", peers);
        if (missingSocialSchema(profilesResult.error)) {
          setSocialSchemaReady(false);
          const legacyProfiles = await supabase.from("profiles").select("id,display_name").in("id", peers);
          if (legacyProfiles.error) throw legacyProfiles.error;
          profileRows = (legacyProfiles.data ?? []) as Profile[];
        } else {
          if (profilesResult.error) throw profilesResult.error;
          profileRows = (profilesResult.data ?? []) as Profile[];
        }
      }
      const peerProfiles = await Promise.all(profileRows.map(async (peer) => {
        if (!peer.avatar_path) return peer;
        const { data } = await supabase.storage.from("kinfolk-avatars").createSignedUrl(peer.avatar_path, 3600);
        return { ...peer, avatarUrl: data?.signedUrl };
      }));
      const peerById = new Map(peerProfiles.map((peer) => [peer.id, peer]));
      const messageRows = (messagesResult.data ?? []) as Message[];
      const hiddenIds = new Set((hiddenResult.data ?? []).map((item) => (item as { message_id: string }).message_id));
      const latestByConversation = new Map<string, Message>();
      for (const message of messageRows) if (!message.deleted_at && !hiddenIds.has(message.id) && !latestByConversation.has(message.conversation_id)) latestByConversation.set(message.conversation_id, message);
      const next = rows.map((row) => {
        const peerId = members.find((member) => member.conversation_id === row.id && member.user_id !== userId)?.user_id;
        const latest = latestByConversation.get(row.id);
        return { ...row, peer: peerId ? peerById.get(peerId) ?? null : null, lastMessage: latest ?? null };
      });
      setConversations(next);
      const savedId = readSavedConversation(userId);
      const restoredId = next.some((conversation) => conversation.id === savedId) ? savedId : "";
      setSelectedId(restoredId);
      setMobileChat(Boolean(restoredId));
      if (restoredId) saveConversation(userId, restoredId);
      else if (savedId) {
        saveConversation(userId, null);
        setNotice("Your previous conversation is no longer available to this account.");
      }
      return next;
    } catch (error) {
      setDataError(errorText(error));
      return [];
    } finally {
      setDataLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    setConversations([]);
    setMessages([]);
    setProfile(null);
    setInviteCode("");
    if (!user) {
      setSelectedId("");
      setMobileChat(false);
      return;
    }
    void loadConversations(user.id);
  }, [user?.id, loadConversations]);

  useEffect(() => {
    if (!user) return;
    const restoreAndVerify = () => {
      if (document.visibilityState === "visible") void loadConversations(user.id);
    };
    document.addEventListener("visibilitychange", restoreAndVerify);
    window.addEventListener("pageshow", restoreAndVerify);
    return () => {
      document.removeEventListener("visibilitychange", restoreAndVerify);
      window.removeEventListener("pageshow", restoreAndVerify);
    };
  }, [user?.id, loadConversations]);

  const activeConversation = conversations.find((conversation) => conversation.id === selectedId) ?? null;
  const activeWallpaper = activeConversation ? chatWallpapers[activeConversation.id] ?? "paper" : "paper";

  useEffect(() => {
    setProfileNameDraft(profile?.display_name ?? "");
    setProfileBioDraft(profile?.bio ?? "");
  }, [profile?.id, profile?.display_name, profile?.bio]);

  useEffect(() => {
    if (!supabase || !user) return;
    let cancelled = false;
    setTabError("");
    if (activeTab === "calls") {
      setCallLogsLoading(true);
      void supabase.from("call_sessions")
        .select("id,conversation_id,caller_id,callee_id,call_type,status,created_at,accepted_at,ended_at")
        .or(`caller_id.eq.${user.id},callee_id.eq.${user.id}`)
        .order("created_at", { ascending: false }).limit(60)
        .then(({ data, error }) => {
          if (cancelled) return;
          if (error) setTabError(`Could not load call history: ${error.message}`);
          else setCallLogs((data ?? []) as CallLog[]);
          setCallLogsLoading(false);
        });
    } else if (activeTab === "updates") {
      setStatusesLoading(true);
      void supabase.from("status_updates")
        .select("id,user_id,conversation_id,body,media_path,content_type,created_at,expires_at")
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false }).limit(60)
        .then(async ({ data, error }) => {
          if (cancelled) return;
          if (error) {
            if (missingSocialSchema(error)) {
              setSocialSchemaReady(false);
              setTabError(socialMigrationHint("Status updates"));
            } else setTabError(`Could not load updates: ${error.message}`);
          }
          else {
            const rows = (data ?? []) as StatusUpdate[];
            const signedRows = await Promise.all(rows.map(async (item) => {
              if (!item.media_path) return item;
              const { data: signed, error: signedError } = await supabase.storage.from("kinfolk-media").createSignedUrl(item.media_path, 3600);
              if (signedError || !signed?.signedUrl) {
                logStatusMediaProblem("sign status media", signedError ?? new Error("Storage returned no signed URL"));
                return { ...item, mediaError: "This private media could not be opened. Try refreshing its secure link." };
              }
              return { ...item, mediaUrl: signed.signedUrl, mediaError: undefined, mediaRetryAttempted: false, mediaSignedAt: Date.now() };
            }));
            if (!cancelled) setStatuses(signedRows);
          }
          if (!cancelled) setStatusesLoading(false);
        });
    } else if (activeTab === "media") {
      setMediaLoading(true);
      const conversationIds = conversations.map((item) => item.id);
      if (!conversationIds.length) {
        setMediaLibrary([]);
        setMediaLoading(false);
      } else {
        void supabase.from("messages")
          .select("id,conversation_id,sender_id,body,created_at,content_type,storage_path,attachment_name,mime_type,file_size,deleted_at")
          .in("conversation_id", conversationIds).not("storage_path", "is", null).is("deleted_at", null)
          .order("created_at", { ascending: false }).limit(100)
          .then(async ({ data, error }) => {
            if (cancelled) return;
            if (error) setTabError(`Could not load shared media: ${error.message}`);
            else {
              const rows = (data ?? []) as Message[];
              const signedRows = await Promise.all(rows.map(async (item) => {
                if (!item.storage_path) return item;
                const { data: signed } = await supabase.storage.from("kinfolk-media").createSignedUrl(item.storage_path, 600);
                return { ...item, mediaUrl: signed?.signedUrl };
              }));
              if (!cancelled) setMediaLibrary(signedRows);
            }
            if (!cancelled) setMediaLoading(false);
          });
      }
    }
    return () => { cancelled = true; };
  }, [activeTab, conversations, supabase, user?.id]);

  useEffect(() => {
    if (!supabase || !user) return;
    const channel = supabase.channel(`kinfolk-call-sessions-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "call_sessions" }, (payload) => {
        const session = payload.new as KinfolkCall;
        if (!session?.id) return;
        if (payload.eventType === "INSERT" && session.callee_id === user.id && session.status === "ringing") {
          if (activeCallRef.current || incomingCallRef.current) {
            void supabase.rpc("decline_direct_call", { target_call: session.id });
            setNotice("An incoming call was declined because this account is already handling a call.");
          } else setIncomingCall(session);
          return;
        }
        if (payload.eventType !== "UPDATE") return;
        if (session.status === "active") {
          if (session.caller_id === user.id || session.callee_id === user.id) setActiveCall(session);
          setIncomingCall((current) => current?.id === session.id ? null : current);
        } else if (["declined", "missed", "ended"].includes(session.status)) {
          setActiveCall((current) => current?.id === session.id ? null : current);
          setIncomingCall((current) => current?.id === session.id ? null : current);
          if (session.status === "declined") setNotice("The call was declined.");
          else if (session.status === "missed") setNotice("The call was not answered.");
          else setNotice("The call ended.");
        }
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [supabase, user?.id]);

  useEffect(() => {
    if (!supabase || !incomingCall || incomingCall.status !== "ringing") return;
    const expiry = Math.max(0, 60_000 - (Date.now() - new Date(incomingCall.created_at).getTime()));
    const timeout = window.setTimeout(async () => {
      const { data, error } = await supabase.rpc("expire_direct_call", { target_call: incomingCall.id });
      if (error) setNotice(`Could not update the missed call: ${error.message}`);
      else if (data) setIncomingCall((current) => current?.id === incomingCall.id ? null : current);
    }, expiry);
    return () => window.clearTimeout(timeout);
  }, [supabase, incomingCall?.id, incomingCall?.created_at, incomingCall?.status]);

  useEffect(() => {
    if (!supabase || !user) return;
    let cancelled = false;
    void supabase.from("call_sessions").select("id,conversation_id,caller_id,callee_id,call_type,status,created_at,accepted_at")
      .in("status", ["ringing", "active"])
      .or(`caller_id.eq.${user.id},callee_id.eq.${user.id}`)
      .order("created_at", { ascending: false }).limit(1).maybeSingle()
      .then(({ data }) => {
        if (cancelled || !data) return;
        const session = data as KinfolkCall;
        if (session.status === "active" || session.caller_id === user.id) setActiveCall(session);
        else if (session.callee_id === user.id) setIncomingCall(session);
      });
    return () => { cancelled = true; };
  }, [supabase, user?.id]);

  const loadMessages = useCallback(async (conversationId: string, userId: string) => {
    if (!supabase) return;
    setDataLoading(true);
    setDataError("");
    const { data, error } = await supabase.from("messages")
      .select("id,conversation_id,sender_id,body,created_at,content_type,storage_path,attachment_name,mime_type,file_size,deleted_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });
    if (error) setDataError(error.message);
    else {
      const { data: hiddenRows, error: hiddenError } = await supabase.from("message_deletions").select("message_id").eq("user_id", userId);
      if (hiddenError) {
        setDataError(hiddenError.message);
        setDataLoading(false);
        return;
      }
      const hiddenIds = new Set((hiddenRows ?? []).map((item) => (item as { message_id: string }).message_id));
      const rows = ((data ?? []) as Message[]).filter((message) => !hiddenIds.has(message.id));
      const savedRows = await Promise.all(rows.map(async (message) => {
        if (!message.storage_path) return message;
        const { data: signed, error: signedError } = await supabase.storage.from("kinfolk-media").createSignedUrl(message.storage_path, 600);
        if (signedError || !signed?.signedUrl) {
          setMessageError("A media attachment could not be opened. Check the private storage policies.");
          return message;
        }
        return { ...message, mediaUrl: signed.signedUrl };
      }));
      setMessages(() => {
        const merged = new Map(savedRows.map((message) => [message.id, message]));
        return [...merged.values()].sort((left, right) => left.created_at.localeCompare(right.created_at));
      });
    }
    setDataLoading(false);
  }, [supabase]);

  useEffect(() => {
    setMessages([]);
    setMessageError("");
    if (!supabase || !activeConversation) {
      setConnection("idle");
      return;
    }
    void loadMessages(activeConversation.id, user!.id);
    setConnection("connecting");
    const channel = supabase.channel(`kinfolk-messages-${activeConversation.id}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `conversation_id=eq.${activeConversation.id}`,
      }, async (payload) => {
        let incoming = payload.new as Message;
        if (incoming.storage_path) {
          const { data: signed } = await supabase.storage.from("kinfolk-media").createSignedUrl(incoming.storage_path, 600);
          if (signed?.signedUrl) incoming = { ...incoming, mediaUrl: signed.signedUrl };
        }
        setMessages((current) => current.some((message) => message.id === incoming.id) ? current : [...current, incoming]);
        setConversations((current) => current.map((conversation) => conversation.id === incoming.conversation_id
          ? { ...conversation, lastMessage: incoming }
          : conversation));
      })
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "messages",
        filter: `conversation_id=eq.${activeConversation.id}`,
      }, (payload) => {
        const updated = payload.new as Message;
        setMessages((current) => current.map((message) => message.id === updated.id ? updated : message));
        setConversations((current) => current.map((conversation) => conversation.id === updated.conversation_id
          ? { ...conversation, lastMessage: updated }
          : conversation));
      })
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "message_deletions",
        filter: `user_id=eq.${user!.id}`,
      }, (payload) => {
        const deletion = payload.new as { message_id: string };
        setMessages((current) => current.filter((message) => message.id !== deletion.message_id));
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setConnection("connected");
          setConnectionWarningDismissed(false);
          void loadMessages(activeConversation.id, user!.id);
        }
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") setConnection("offline");
      });
    return () => { void supabase.removeChannel(channel); };
  }, [supabase, activeConversation?.id, loadMessages, user?.id]);

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setAuthError("");
    setNotice("");
    const result = authMode === "signup"
      ? await supabase.auth.signUp({ email: email.trim(), password, options: { data: { display_name: displayName.trim() } } })
      : await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (result.error) {
      setAuthError(result.error.message);
      return;
    }
    if (authMode === "signup" && !result.data.session) {
      setNotice("Check your email for a confirmation link, then come back here to sign in.");
    }
  }

  async function connectByInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setDataError("");
    const { data, error } = await supabase.rpc("create_direct_conversation", { requested_invite: inviteInput.trim() });
    setBusy(false);
    if (error) {
      setDataError(error.message);
      return;
    }
    const createdId = String(data);
    const latest = await loadConversations(user!.id);
    setSelectedId(createdId);
    saveConversation(user!.id, createdId);
    if (!latest.some((conversation) => conversation.id === createdId)) {
      setDataError("Conversation created, but it could not be loaded. Check the database policies and try again.");
    }
    setInviteOpen(false);
    setInviteInput("");
    setMobileChat(true);
  }

  async function sendTextMessage(value: string, clearDraft = false) {
    const body = value.trim();
    if (!supabase || !user || !activeConversation || !body || busy) return;
    setBusy(true);
    setMessageError("");
    const { data, error } = await supabase.from("messages").insert({
      conversation_id: activeConversation.id,
      sender_id: user.id,
      body,
    }).select("id,conversation_id,sender_id,body,created_at,content_type,storage_path,attachment_name,mime_type,file_size,deleted_at").single();
    setBusy(false);
    if (error) {
      setMessageError(error.message);
      return;
    }
    const saved = data as Message;
    setMessages((current) => current.some((message) => message.id === saved.id) ? current : [...current, saved]);
    setConversations((current) => current.map((conversation) => conversation.id === saved.conversation_id
      ? { ...conversation, lastMessage: saved }
      : conversation));
    if (clearDraft) setDraft("");
    setComposerPanel(null);
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await sendTextMessage(draft, true);
  }

  async function uploadMedia(file: File) {
    if (!supabase || !user || !activeConversation || busy) return;
    const maxBytes = 50 * 1024 * 1024;
    const supported = /^(image\/(jpeg|png|webp|gif)|video\/(mp4|webm|quicktime)|audio\/(mpeg|mp4|webm|wav)|application\/pdf|text\/plain)$/;
    if (file.size < 1 || file.size > maxBytes) {
      setMessageError("Choose a file smaller than 50 MB.");
      return;
    }
    if (!supported.test(file.type)) {
      setMessageError("That file type is not supported yet.");
      return;
    }
    setBusy(true);
    setMessageError("");
    setUploadProgress("Uploading privately…");
    const safeName = file.name.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 120) || "shared-file";
    const storagePath = activeConversation.id + "/" + user.id + "/" + crypto.randomUUID() + "-" + safeName;
    const { error: uploadError } = await supabase.storage.from("kinfolk-media").upload(storagePath, file, {
      cacheControl: "3600",
      contentType: file.type,
      upsert: false,
    });
    if (uploadError) {
      setMessageError(`Storage upload failed: ${uploadError.message}`);
      setUploadProgress("");
      setBusy(false);
      return;
    }
    const contentType: Message["content_type"] = file.type.startsWith("image/")
      ? "image"
      : file.type.startsWith("video/")
        ? "video"
        : file.type.startsWith("audio/")
          ? "audio"
          : "file";
    const { data, error: messageInsertError } = await supabase.from("messages").insert({
      conversation_id: activeConversation.id,
      sender_id: user.id,
      body: draft.trim() || file.name,
      content_type: contentType,
      storage_path: storagePath,
      attachment_name: file.name,
      mime_type: file.type,
      file_size: file.size,
    }).select("id,conversation_id,sender_id,body,created_at,content_type,storage_path,attachment_name,mime_type,file_size,deleted_at").single();
    if (messageInsertError) {
      const { error: cleanupError } = await supabase.storage.from("kinfolk-media").remove([storagePath]);
      setMessageError(cleanupError
        ? `Message record insert failed: ${messageInsertError.message} The private upload could not be cleaned up; remove it from the kinfolk-media bucket.`
        : `Message record insert failed: ${messageInsertError.message}`);
      setUploadProgress("");
      setBusy(false);
      return;
    }
    const saved = data as Message;
    const { data: signed } = await supabase.storage.from("kinfolk-media").createSignedUrl(storagePath, 600);
    const displayed = signed?.signedUrl ? { ...saved, mediaUrl: signed.signedUrl } : saved;
    setMessages((current) => current.some((message) => message.id === displayed.id) ? current : [...current, displayed]);
    setConversations((current) => current.map((conversation) => conversation.id === displayed.conversation_id
      ? { ...conversation, lastMessage: displayed }
      : conversation));
    setDraft("");
    setUploadProgress("");
    setBusy(false);
  }

  async function deleteForMe(message: Message) {
    if (!supabase || !user || deletingMessageId) return;
    setDeletingMessageId(message.id);
    setMessageError("");
    const { error } = await supabase.from("message_deletions").insert({ message_id: message.id, user_id: user.id });
    setDeletingMessageId("");
    if (error) {
      setMessageError(`Could not delete this message for you: ${error.message}`);
      return;
    }
    setMessages((current) => current.filter((item) => item.id !== message.id));
    await loadConversations(user.id);
  }

  async function deleteForEveryone(message: Message) {
    if (!supabase || !user || message.sender_id !== user.id || deletingMessageId) return;
    if (!window.confirm("Delete this message for everyone? This cannot be undone.")) return;
    setDeletingMessageId(message.id);
    setMessageError("");
    const { data: cleanupPath, error } = await supabase.rpc("delete_message_for_everyone", { target_message: message.id });
    setDeletingMessageId("");
    if (error) {
      setMessageError(`Could not delete this message for everyone: ${error.message}`);
      return;
    }
    const tombstone: Message = {
      ...message,
      body: "This message was deleted",
      content_type: "text",
      storage_path: null,
      attachment_name: null,
      mime_type: null,
      file_size: null,
      mediaUrl: undefined,
      deleted_at: new Date().toISOString(),
    };
    setMessages((current) => current.map((item) => item.id === message.id ? tombstone : item));
    setConversations((current) => current.map((conversation) => conversation.id === message.conversation_id
      ? { ...conversation, lastMessage: tombstone }
      : conversation));
    if (typeof cleanupPath === "string" && cleanupPath) {
      const { error: cleanupError } = await supabase.storage.from("kinfolk-media").remove([cleanupPath]);
      if (cleanupError) setMessageError(`Message deleted for everyone, but its private media object could not be removed: ${cleanupError.message}`);
    }
  }

  async function startCall(callType: "audio" | "video") {
    if (!supabase || !user || !activeConversation || activeCall || incomingCall || busy) return;
    setBusy(true);
    setNotice("");
    const { data: callId, error } = await supabase.rpc("start_direct_call", {
      target_conversation: activeConversation.id,
      requested_type: callType,
    });
    if (error) {
      setBusy(false);
      setNotice(error.message);
      return;
    }
    const { data: session, error: sessionError } = await supabase.from("call_sessions")
      .select("id,conversation_id,caller_id,callee_id,call_type,status,created_at,accepted_at")
      .eq("id", String(callId)).single();
    setBusy(false);
    if (sessionError || !session) {
      setNotice(sessionError?.message ?? "The call started but its session could not be loaded.");
      return;
    }
    setActiveCall(session as KinfolkCall);
  }

  async function acceptCall() {
    if (!supabase || !incomingCall) return;
    const requested = incomingCall;
    setBusy(true);
    const { data, error } = await supabase.rpc("accept_direct_call", { target_call: requested.id });
    if (error) {
      setBusy(false);
      setNotice(`Could not accept the call: ${error.message}`);
      return;
    }
    if (!data) {
      setBusy(false);
      setIncomingCall(null);
      setNotice("This call has expired or ended.");
      return;
    }
    const { data: session, error: sessionError } = await supabase.from("call_sessions")
      .select("id,conversation_id,caller_id,callee_id,call_type,status,created_at,accepted_at")
      .eq("id", requested.id).single();
    setBusy(false);
    if (sessionError || !session) {
      setNotice(sessionError?.message ?? "The accepted call session could not be loaded.");
      return;
    }
    setIncomingCall(null);
    setActiveCall(session as KinfolkCall);
  }

  async function declineCall() {
    if (!supabase || !incomingCall) return;
    const { error } = await supabase.rpc("decline_direct_call", { target_call: incomingCall.id });
    if (error) {
      setNotice(`Could not decline the call: ${error.message}`);
      return;
    }
    setIncomingCall(null);
  }

  const endActiveCall = useCallback(async () => {
    if (!supabase || !activeCall) return;
    const { error } = await supabase.rpc("end_direct_call", { target_call: activeCall.id });
    if (error) {
      setNotice(`Could not end the call: ${error.message}`);
      return;
    }
    setActiveCall(null);
  }, [supabase, activeCall?.id]);

  const reportCallError = useCallback((message: string) => setNotice(message), []);

  function navigateTab(tab: MainTab) {
    setActiveTab(tab);
    setMobileChat(false);
    setNotice("");
    setTabError("");
  }

  async function refreshStatusMedia(statusId: string, mediaPath: string, force = false) {
    if (!supabase || statusMediaRefreshes.current.has(statusId)) return;
    const current = statuses.find((item) => item.id === statusId);
    const signedLinkExpired = Boolean(current?.mediaSignedAt && Date.now() - current.mediaSignedAt > 55 * 60 * 1000);
    if (current?.mediaRetryAttempted && !force && !signedLinkExpired) {
      logStatusMediaProblem("video playback", new Error("Playback failed after refreshing the signed URL"));
      setStatuses((items) => items.map((item) => item.id === statusId
        ? { ...item, mediaLoading: false, mediaError: item.content_type === "video" ? "This video could not be played on this device. It may use an unsupported video format." : "This photo could not be displayed. Try refreshing its private link." }
        : item));
      return;
    }
    statusMediaRefreshes.current.add(statusId);
    setStatuses((items) => items.map((item) => item.id === statusId ? { ...item, mediaLoading: true, mediaError: undefined } : item));
    try {
      const { data, error } = await supabase.storage.from("kinfolk-media").createSignedUrl(mediaPath, 3600);
      if (error || !data?.signedUrl) {
        logStatusMediaProblem("refresh status media URL", error ?? new Error("Storage returned no signed URL"));
        setStatuses((items) => items.map((item) => item.id === statusId
          ? { ...item, mediaLoading: false, mediaError: "This private media could not be opened. Try refreshing its secure link." }
          : item));
      } else {
        setStatuses((items) => items.map((item) => item.id === statusId
          ? { ...item, mediaUrl: data.signedUrl, mediaLoading: false, mediaError: undefined, mediaRetryAttempted: true, mediaSignedAt: Date.now() }
          : item));
      }
    } catch (error) {
      logStatusMediaProblem("refresh status media URL", error);
      setStatuses((items) => items.map((item) => item.id === statusId
        ? { ...item, mediaLoading: false, mediaError: "This private media could not be opened. Try refreshing its secure link." }
        : item));
    } finally {
      statusMediaRefreshes.current.delete(statusId);
    }
  }

  async function publishStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !user || statusPosting) return;
    const conversationId = activeConversation?.id ?? conversations[0]?.id;
    if (!conversationId) {
      setTabError("Connect with your sister first to share an update in your private space.");
      return;
    }
    if (statusFile && (!/^image\/(jpeg|png|webp|gif)$|^video\/(mp4|webm|quicktime)$/.test(statusFile.type) || statusFile.size > 50 * 1024 * 1024)) {
      setTabError("Choose an image or video smaller than 50 MB.");
      return;
    }
    setStatusPosting(true);
    setTabError("");
    let mediaPath: string | null = null;
    let contentType: StatusUpdate["content_type"] = "text";
    if (statusFile) {
      const safeName = statusFile.name.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 100) || "status-media";
      mediaPath = `${conversationId}/${user.id}/${crypto.randomUUID()}-${safeName}`;
      contentType = statusFile.type.startsWith("video/") ? "video" : "image";
      const { error } = await supabase.storage.from("kinfolk-media").upload(mediaPath, statusFile, { contentType: statusFile.type, upsert: false });
      if (error) {
        setStatusPosting(false);
        setTabError(`Could not upload this update: ${error.message}`);
        return;
      }
    }
    const { data, error } = await supabase.from("status_updates").insert({
      user_id: user.id,
      conversation_id: conversationId,
      body: statusCaption.trim(),
      media_path: mediaPath,
      content_type: contentType,
    }).select("id,user_id,conversation_id,body,media_path,content_type,created_at,expires_at").single();
    if (error || !data) {
      if (mediaPath) await supabase.storage.from("kinfolk-media").remove([mediaPath]);
      setStatusPosting(false);
      setTabError(missingSocialSchema(error)
        ? socialMigrationHint("Status updates")
        : `Could not publish this update: ${error?.message ?? "No update was returned."}`);
      return;
    }
    let posted = data as StatusUpdate;
    if (mediaPath) {
      const { data: signed, error: signedError } = await supabase.storage.from("kinfolk-media").createSignedUrl(mediaPath, 3600);
      if (signedError || !signed?.signedUrl) {
        logStatusMediaProblem("sign newly published status media", signedError ?? new Error("Storage returned no signed URL"));
        posted = { ...posted, mediaError: "Your update is saved, but its private media link could not be opened. Try refreshing it." };
      } else posted = { ...posted, mediaUrl: signed.signedUrl, mediaSignedAt: Date.now(), mediaRetryAttempted: false };
    }
    setStatuses((current) => [posted, ...current]);
    setStatusCaption("");
    setStatusFile(null);
    setStatusComposerOpen(false);
    setStatusPosting(false);
  }

  async function deleteStatus(item: StatusUpdate) {
    if (!supabase || !user || item.user_id !== user.id || deletingStatusId) return;
    if (!window.confirm("Remove this status update? This cannot be undone.")) return;

    setDeletingStatusId(item.id);
    setTabError("");
    const { data, error } = await supabase.from("status_updates")
      .delete()
      .eq("id", item.id)
      .eq("user_id", user.id)
      .select("id")
      .maybeSingle();

    if (error || !data) {
      setTabError(error
        ? `Could not remove this update: ${error.message}`
        : "This update was not removed. It may have already expired or you may not have permission to remove it.");
      setDeletingStatusId("");
      return;
    }

    setStatuses((items) => items.filter((status) => status.id !== item.id));
    if (item.media_path) {
      const { error: cleanupError } = await supabase.storage.from("kinfolk-media").remove([item.media_path]);
      if (cleanupError) {
        logStatusMediaProblem("delete status media", cleanupError);
        setTabError(`Status removed, but its private media file could not be cleaned up: ${cleanupError.message}`);
      }
    }
    setDeletingStatusId("");
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !user || profileSaving) return;
    const name = profileNameDraft.trim();
    if (!name) return;
    setProfileSaving(true);
    setTabError("");
    const { error } = await supabase.from("profiles").update({ display_name: name, bio: profileBioDraft.trim() }).eq("id", user.id);
    setProfileSaving(false);
    if (error) {
      setTabError(missingSocialSchema(error)
        ? socialMigrationHint("Profile editing")
        : `Could not save your profile: ${error.message}`);
      return;
    }
    setProfile((current) => current ? { ...current, display_name: name, bio: profileBioDraft.trim() } : current);
    setConversations((current) => current.map((item) => item.peer?.id === user.id ? { ...item, peer: item.peer ? { ...item.peer, display_name: name } : null } : item));
    setNotice("Your profile is up to date.");
  }

  async function uploadAvatar(file: File) {
    if (!supabase || !user || profileSaving) return;
    if (!socialSchemaReady) {
      setTabError(socialMigrationHint("Profile photos"));
      return;
    }
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 8 * 1024 * 1024) {
      setTabError("Choose a JPG, PNG, or WebP photo smaller than 8 MB.");
      return;
    }
    setProfileSaving(true);
    setTabError("");
    const path = `${user.id}/${crypto.randomUUID()}-profile.${file.type.split("/")[1]}`;
    const { error: uploadError } = await supabase.storage.from("kinfolk-avatars").upload(path, file, { contentType: file.type, upsert: false });
    if (uploadError) {
      setProfileSaving(false);
      setTabError(`Could not upload your profile photo: ${uploadError.message}`);
      return;
    }
    const { error: updateError } = await supabase.from("profiles").update({ avatar_path: path }).eq("id", user.id);
    if (updateError) {
      await supabase.storage.from("kinfolk-avatars").remove([path]);
      setProfileSaving(false);
      setTabError(`Could not save your profile photo: ${updateError.message}`);
      return;
    }
    if (profile?.avatar_path) await supabase.storage.from("kinfolk-avatars").remove([profile.avatar_path]);
    const { data: signed } = await supabase.storage.from("kinfolk-avatars").createSignedUrl(path, 3600);
    setProfile((current) => current ? { ...current, avatar_path: path, avatarUrl: signed?.signedUrl } : current);
    await loadConversations(user.id);
    setProfileSaving(false);
  }

  async function signOut() {
    if (!supabase) return;
    setBusy(true);
    const { error } = await supabase.auth.signOut();
    setBusy(false);
    if (error) setAuthError(error.message);
  }

  async function copyInvite() {
    if (!inviteCode) return;
    try {
      await navigator.clipboard.writeText(inviteCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setNotice(`Your invite code: ${inviteCode}`);
    }
  }

  if (!supabase) {
    return (
      <main className="setup-screen">
        <div className="setup-card">
          <div className="brand"><span className="brand-mark">k</span><span>kinfolk</span></div>
          <p className="eyebrow">SUPABASE SETUP NEEDED</p>
          <h1>Connect your private space.</h1>
          <p>Copy <code>.env.example</code> to <code>.env.local</code>, add your Supabase project URL and publishable key, then restart the app.</p>
          <p className="muted">No messages are stored locally or sent until Supabase is configured.</p>
        </div>
      </main>
    );
  }

  if (authBusy) return <main className="setup-screen"><div className="setup-card"><div className="brand"><span className="brand-mark">k</span><span>kinfolk</span></div><p className="muted">Checking your secure session…</p></div></main>;

  if (!user) {
    return (
      <main className="setup-screen">
        <section className="auth-card">
          <div className="brand"><span className="brand-mark">k</span><span>kinfolk</span></div>
          <p className="eyebrow">A PRIVATE SPACE FOR YOUR PEOPLE</p>
          <h1>{authMode === "signin" ? "Welcome back." : "Make room for your people."}</h1>
          <p className="auth-copy">Sign in on your device to pick up where you left off.</p>
          <form className="auth-form" onSubmit={submitAuth}>
            {authMode === "signup" && <label>Your name<input autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} required maxLength={60} /></label>}
            <label>Email address<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
            <label>Password<input type="password" autoComplete={authMode === "signin" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required /></label>
            {authError && <p className="form-error" role="alert">{authError}</p>}
            {notice && <p className="form-notice" role="status">{notice}</p>}
            <button className="auth-submit" disabled={busy}>{busy ? "Please wait…" : authMode === "signin" ? "Sign in" : "Create account"}</button>
          </form>
          <button className="auth-switch" onClick={() => { setAuthMode(authMode === "signin" ? "signup" : "signin"); setAuthError(""); setNotice(""); }}>
            {authMode === "signin" ? "New to Kinfolk? Create an account" : "Already have an account? Sign in"}
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className={`shell ${mobileChat ? "mobile-chat" : ""} ${activeTab !== "chats" ? "page-view" : ""}`}>
      <aside className="rail">
        <div className="brand"><span className="brand-mark">k</span><span>kinfolk</span></div>
        <p className="tagline">close, wherever</p>
        <nav aria-label="Main navigation">
          <button className={`nav-item ${activeTab === "chats" ? "selected" : ""}`} onClick={() => navigateTab("chats")}><span>◉</span> Messages</button>
          <button className={`nav-item ${activeTab === "calls" ? "selected" : ""}`} onClick={() => navigateTab("calls")}><span>⌁</span> Calls</button>
          <button className={`nav-item ${activeTab === "updates" ? "selected" : ""}`} onClick={() => navigateTab("updates")}><span>◌</span> Updates</button>
          <button className={`nav-item ${activeTab === "media" ? "selected" : ""}`} onClick={() => navigateTab("media")}><span>▧</span> Shared media</button>
          <button className={`nav-item ${activeTab === "profile" ? "selected" : ""}`} onClick={() => navigateTab("profile")}><span>☺</span> My profile</button>
        </nav>
        <div className="profile">
          <button className="profile-open" onClick={() => navigateTab("profile")} aria-label="Open your profile"><Avatar name={profile?.display_name ?? user.email ?? "K"} src={profile?.avatarUrl} className="me" /><span><strong>{profile?.display_name ?? "Your profile"}</strong><small>View your profile</small></span></button>
          <button className="dots signout" onClick={() => void signOut()} disabled={busy} aria-label="Sign out">↗</button>
        </div>
      </aside>

      <section className="inbox" id="messages">
        <header className="inbox-header"><div><p className="eyebrow">YOUR LITTLE CIRCLE</p><h1>Messages</h1></div><button className="new-chat" aria-label="Connect by invite code" onClick={() => { setInviteOpen(!inviteOpen); setDataError(""); }}>＋</button></header>
        {inviteOpen && <form className="invite-form" onSubmit={connectByInvite}><label htmlFor="invite-code">Connect with your sister’s invite code</label><div><input id="invite-code" value={inviteInput} onChange={(event) => setInviteInput(event.target.value)} placeholder="Paste invite code" required /><button disabled={busy}>{busy ? "…" : "Connect"}</button></div></form>}
        <label className="search"><span>⌕</span><input placeholder="Search conversations" aria-label="Search conversations" /></label>
        <div className="updates"><button className="story add" onClick={() => { navigateTab("updates"); setStatusComposerOpen(true); }}><span className="story-ring add-ring"><Avatar name={profile?.display_name ?? "You"} src={profile?.avatarUrl} /></span><span>Your update</span></button>{statuses.slice(0, 3).map((item) => {
          const conversation = conversations.find((entry) => entry.id === item.conversation_id);
          const name = item.user_id === user.id ? "You" : conversation?.peer?.display_name ?? "Sister";
          const image = item.user_id === user.id ? profile?.avatarUrl : conversation?.peer?.avatarUrl;
          return <button key={item.id} className="story" onClick={() => navigateTab("updates")}><span className="story-ring"><Avatar name={name} src={image} /></span><span>{name.split(" ")[0]}</span></button>;
        })}</div>
        <div className="section-label">CONVERSATIONS</div>
        {dataLoading && conversations.length === 0 && <div className="inbox-state">Loading your conversations…</div>}
        {!dataLoading && conversations.length === 0 && <div className="inbox-state">No conversations yet. Share your invite code or connect with your sister’s code to begin.</div>}
        {conversations.length > 0 && <div className="people">{conversations.map((conversation) => {
          const name = conversation.peer?.display_name ?? "Kinfolk member";
          return <button key={conversation.id} onClick={() => { setSelectedId(conversation.id); saveConversation(user.id, conversation.id); setMobileChat(true); }} className={`person ${conversation.id === selectedId ? "person-active" : ""}`}>
            <Avatar name={name} src={conversation.peer?.avatarUrl} />
            <span className="person-copy"><strong>{name}</strong><small>{conversation.lastMessage ? messagePreview(conversation.lastMessage) : "Say hello to begin."}</small></span>
            <span className="time">{conversation.lastMessage ? timeLabel(conversation.lastMessage.created_at) : ""}</span>
          </button>;
        })}</div>}
        {dataError && <p className="form-error inbox-error" role="alert">{dataError}<button className="dismiss-error" onClick={() => setDataError("")} aria-label="Dismiss error">×</button></p>}
        {notice && <p className="form-notice inbox-notice" role="status">{notice}<button onClick={() => setNotice("")} aria-label="Dismiss">×</button></p>}
      </section>

      {activeTab === "chats" ? <section className="welcome chat-panel">
        {activeConversation ? <>
          <header className="chat-header">
            <button className="back-button" onClick={() => setMobileChat(false)} aria-label="Back to conversations">‹</button>
            <Avatar name={activeConversation.peer?.display_name ?? "K"} src={activeConversation.peer?.avatarUrl} />
            <div className="chat-peer-copy"><strong>{activeConversation.peer?.display_name ?? "Kinfolk member"}</strong><small className={`connection ${connection}`}>● {connection === "connected" ? "Live connection" : connection === "connecting" ? "Connecting…" : connection === "offline" ? "Reconnecting unavailable" : "Loading chat"}</small></div>
            <div className="chat-call-actions"><button className="wallpaper-toggle" onClick={() => setComposerPanel((panel) => panel === "wallpaper" ? null : "wallpaper")} aria-label="Choose chat wallpaper" title="Chat wallpaper">◐</button><button onClick={() => void startCall("audio")} disabled={busy || Boolean(activeCall || incomingCall)} aria-label="Start audio call" title="Audio call">☎</button><button onClick={() => void startCall("video")} disabled={busy || Boolean(activeCall || incomingCall)} aria-label="Start video call" title="Video call">▣</button></div>
          </header>
          <div className={`chat-messages wallpaper-${activeWallpaper}`} aria-live="polite">
            {dataLoading && messages.length === 0 && <div className="chat-state">Loading your conversation…</div>}
            {!dataLoading && messages.length === 0 && <div className="chat-state empty-chat"><span>✿</span><strong>A fresh little start.</strong><small>Send the first message to your sister.</small></div>}
            {messages.map((message) => <article key={message.id} className={`bubble ${message.sender_id === user.id ? "out" : "in"} ${message.deleted_at ? "bubble-deleted" : ""} ${message.content_type === "text" && isStickerMessage(message.body) ? "bubble-sticker" : ""}`}>
              {message.storage_path && message.mediaUrl && message.content_type === "image" && <a href={message.mediaUrl} target="_blank" rel="noreferrer"><img className="chat-image" src={message.mediaUrl} alt={message.attachment_name ?? "Shared photo"} /></a>}
              {message.storage_path && message.mediaUrl && message.content_type === "video" && <video className="chat-video" src={message.mediaUrl} controls preload="metadata" aria-label={message.attachment_name ?? "Shared video"} />}
              {message.storage_path && message.mediaUrl && message.content_type === "audio" && <audio className="chat-audio" src={message.mediaUrl} controls preload="metadata" />}
              {message.storage_path && message.mediaUrl && message.content_type === "file" && <a className="file-attachment" href={message.mediaUrl} target="_blank" rel="noreferrer" download={message.attachment_name ?? undefined}>↧ {message.attachment_name}</a>}
              {message.content_type === "text" && <p>{message.body}</p>}
              {message.content_type !== "text" && message.body !== message.attachment_name && <p>{message.body}</p>}
              {message.storage_path && !message.mediaUrl && <p className="media-unavailable">Attachment unavailable</p>}
              <time>{timeLabel(message.created_at)}{message.sender_id === user.id ? " · sent" : ""}</time>
              {!message.deleted_at && <details className="message-actions">
                <summary aria-label="Message actions">⋯</summary>
                <div className="message-action-menu">
                  <button onClick={() => void deleteForMe(message)} disabled={deletingMessageId === message.id}>{deletingMessageId === message.id ? "Deleting…" : "Delete for me"}</button>
                  {message.sender_id === user.id && <button onClick={() => void deleteForEveryone(message)} disabled={deletingMessageId === message.id}>Delete for everyone</button>}
                </div>
              </details>}
            </article>)}
          </div>
          {dataError && <p className="form-error chat-error" role="alert">{dataError}<button className="dismiss-error" onClick={() => setDataError("")} aria-label="Dismiss error">×</button></p>}
          {messageError && <p className="form-error chat-error" role="alert">{messageError}<button className="dismiss-error" onClick={() => setMessageError("")} aria-label="Dismiss error">×</button></p>}
          {connection === "offline" && !connectionWarningDismissed && <p className="connection-warning" role="status">Realtime disconnected. Messages still require a confirmed database save.<button className="dismiss-error" onClick={() => setConnectionWarningDismissed(true)} aria-label="Dismiss connection warning">×</button></p>}
          {uploadProgress && <p className="upload-progress" role="status">{uploadProgress}</p>}
          <form className="message-composer" onSubmit={sendMessage}>
            {composerPanel && <div className={`chat-popover ${composerPanel === "wallpaper" ? "wallpaper-popover" : ""}`}>
              {composerPanel === "emoji" && <>
                <div className="emoji-category-row" role="tablist" aria-label="Emoji categories">{EMOJI_CATEGORIES.map((category, index) => <button key={category.label} type="button" className={emojiCategory === index ? "picker-active" : ""} onClick={() => setEmojiCategory(index)} role="tab" aria-selected={emojiCategory === index} aria-label={category.label} title={category.label}>{category.icon}</button>)}</div>
                <div className="emoji-grid">{EMOJI_CATEGORIES[emojiCategory].emojis.map((emoji, index) => <button key={`${emoji}-${index}`} type="button" onClick={() => setDraft((value) => value + emoji)} aria-label={`Insert ${emoji}`}>{emoji}</button>)}</div>
              </>}
              {composerPanel === "stickers" && <>
                <div className="picker-heading"><strong>Little stickers</strong><span>Tap one to send</span></div>
                <div className="sticker-grid">{STICKER_EMOJIS.map((emoji, index) => <button key={`${emoji}-${index}`} type="button" onClick={() => void sendTextMessage(emoji)} aria-label={`Send ${emoji} sticker`}>{emoji}</button>)}</div>
              </>}
              {composerPanel === "wallpaper" && <>
                <div className="picker-heading"><strong>Chat wallpaper</strong><span>Just for this device</span></div>
                <div className="wallpaper-grid">{CHAT_WALLPAPERS.map((wallpaper) => <button key={wallpaper.id} type="button" onClick={() => { if (activeConversation) setChatWallpapers((current) => ({ ...current, [activeConversation.id]: wallpaper.id })); setComposerPanel(null); }} className={activeWallpaper === wallpaper.id ? "wallpaper-selected" : ""} aria-label={wallpaper.label} title={wallpaper.label}><span style={{ background: wallpaper.color }} />{wallpaper.label}</button>)}</div>
              </>}
            </div>}
            <button type="button" className={`composer-tool ${composerPanel === "emoji" ? "tool-active" : ""}`} onClick={() => setComposerPanel((panel) => panel === "emoji" ? null : "emoji")} aria-label="Choose emoji" title="Emoji">☺</button>
            <button type="button" className={`composer-tool ${composerPanel === "stickers" ? "tool-active" : ""}`} onClick={() => setComposerPanel((panel) => panel === "stickers" ? null : "stickers")} aria-label="Choose sticker" title="Stickers">▧</button>
            <label className="attach-media" title="Share a photo, video, audio, or file">
              <input type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime,audio/mpeg,audio/mp4,audio/webm,audio/wav,application/pdf,text/plain" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void uploadMedia(file); }} disabled={busy} />
              <span aria-hidden="true">＋</span>
            </label>
            <input aria-label="Write a message or media caption" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Message or add a media caption…" maxLength={4000} disabled={busy} />
            <button className="send-button" disabled={busy || !draft.trim()} aria-label="Send message" title="Send message">{busy ? "…" : "↑"}</button>
          </form>
        </> : <><div className="welcome-art"><div className="sun"></div><div className="hill hill-back"></div><div className="hill hill-front"></div><div className="art-flower">✳</div><div className="art-spark">✦</div></div>
          <p className="eyebrow">A SPACE FOR YOUR PEOPLE</p><h2>Close, wherever.</h2><p className="welcome-copy">A little place to share the everyday things with the people who make them matter.</p>
          <div className="foundation-note"><span>✿</span><div><strong>Private by design</strong><small>Messages are stored in Supabase and visible only to members of your conversation.</small></div></div>
        </>}
      </section> : <section className="social-panel">
        <header className="social-header">
          <div><p className="eyebrow">KIN FOLK, CLOSE BY</p><h1>{activeTab === "calls" ? "Calls" : activeTab === "updates" ? "Updates" : activeTab === "media" ? "Shared media" : "Your profile"}</h1><p>{activeTab === "calls" ? "A little history of the moments you talked." : activeTab === "updates" ? "Small moments, kept for 24 hours." : activeTab === "media" ? "Photos, videos, voice notes, and files you’ve shared." : "Make this little corner feel like you."}</p></div>
          {activeTab === "calls" && <button className="primary-action" onClick={() => { const nextId = activeConversation?.id ?? conversations[0]?.id ?? ""; if (nextId) { setSelectedId(nextId); saveConversation(user.id, nextId); navigateTab("chats"); setMobileChat(true); } else setTabError("Connect with your sister first to start a call."); }}>＋ New call</button>}
          {activeTab === "updates" && <button className="primary-action" onClick={() => setStatusComposerOpen((open) => !open)}>＋ Share a moment</button>}
        </header>
        {tabError && <p className="form-error social-error" role="alert">{tabError}<button className="dismiss-error" onClick={() => setTabError("")} aria-label="Dismiss error">×</button></p>}

        {activeTab === "calls" && <div className="social-content">
          <div className="feature-card call-feature"><span className="feature-icon">⌁</span><div><strong>Make time for a call</strong><p>Audio and video calls happen privately between you and your sister.</p></div><button onClick={() => { const nextId = activeConversation?.id ?? conversations[0]?.id ?? ""; if (nextId) { setSelectedId(nextId); saveConversation(user.id, nextId); navigateTab("chats"); setMobileChat(true); } else setTabError("Connect with your sister first to start a call."); }}>Open chat</button></div>
          <div className="list-heading"><div><h2>Recent calls</h2><span>{callLogs.length} {callLogs.length === 1 ? "call" : "calls"}</span></div></div>
          {callLogsLoading && <div className="page-empty">Gathering your call history…</div>}
          {!callLogsLoading && callLogs.length === 0 && <div className="page-empty"><span>⌁</span><strong>No calls yet</strong><small>Your audio and video calls will show up here.</small></div>}
          {!callLogsLoading && <div className="call-list">{callLogs.map((entry) => {
            const conversation = conversations.find((item) => item.id === entry.conversation_id);
            const peer = conversation?.peer;
            const name = peer?.display_name ?? "Your sister";
            const answeredAt = entry.accepted_at ? new Date(entry.accepted_at).getTime() : 0;
            const finishedAt = entry.ended_at ? new Date(entry.ended_at).getTime() : 0;
            const seconds = answeredAt && finishedAt ? Math.max(0, Math.floor((finishedAt - answeredAt) / 1000)) : 0;
            const outcome = entry.status === "missed" ? "Missed" : entry.status === "declined" ? "Declined" : entry.status === "active" || entry.status === "ringing" ? "In progress" : "Completed";
            return <article className="call-row" key={entry.id}>
              <Avatar name={name} src={peer?.avatarUrl} />
              <div className="call-row-copy"><strong>{name}</strong><small className={entry.status === "missed" ? "missed-call" : ""}>{entry.caller_id === user.id ? "↗ Outgoing" : "↙ Incoming"} · {entry.call_type === "video" ? "Video" : "Audio"} · {outcome}</small></div>
              <time>{dateLabel(entry.created_at)}{seconds ? ` · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` : ""}</time>
              <button className="round-action" onClick={() => { if (conversation) { setSelectedId(conversation.id); saveConversation(user.id, conversation.id); navigateTab("chats"); setMobileChat(true); } }} aria-label={`Open chat with ${name}`} title="Open chat">↗</button>
            </article>;
          })}</div>}
        </div>}

        {activeTab === "updates" && <div className="social-content">
          {statusComposerOpen && <form className="status-composer" onSubmit={publishStatus}>
            <div className="composer-title"><Avatar name={profile?.display_name ?? "You"} src={profile?.avatarUrl} /><div><strong>Share a little moment</strong><small>Only people in your private Kinfolk circle can see it.</small></div></div>
            <textarea value={statusCaption} onChange={(event) => setStatusCaption(event.target.value)} placeholder="What’s happening? Add a caption…" maxLength={500} />
            {statusFile && <p className="selected-file">{statusFile.name}<button type="button" onClick={() => setStatusFile(null)} aria-label="Remove selected media">×</button></p>}
            <div className="composer-actions"><label className="secondary-action">▧ Add photo or video<input type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime" onChange={(event) => setStatusFile(event.currentTarget.files?.[0] ?? null)} /></label><span>Disappears after 24 hours</span><button className="primary-action" disabled={statusPosting || (!statusCaption.trim() && !statusFile)}>{statusPosting ? "Sharing…" : "Share update"}</button></div>
          </form>}
          <div className="list-heading"><div><h2>From your circle</h2><span>{statuses.length} active {statuses.length === 1 ? "update" : "updates"}</span></div></div>
          {statusesLoading && <div className="page-empty">Checking for new moments…</div>}
          {!statusesLoading && statuses.length === 0 && <div className="page-empty"><span>◌</span><strong>A little quiet here</strong><small>Share a photo, a thought, or a tiny everyday win.</small><button className="secondary-action" onClick={() => setStatusComposerOpen(true)}>Post your first update</button></div>}
          {!statusesLoading && <div className="status-grid">{statuses.map((item) => {
            const conversation = conversations.find((entry) => entry.id === item.conversation_id);
            const peer = conversation?.peer;
            const name = item.user_id === user.id ? profile?.display_name ?? "You" : peer?.display_name ?? "Your sister";
            const avatarUrl = item.user_id === user.id ? profile?.avatarUrl : peer?.avatarUrl;
            return <article className="status-card" key={item.id}>
              <div className="status-byline"><Avatar name={name} src={avatarUrl} /><div><strong>{name}</strong><small>{dateLabel(item.created_at)} · expires in 24h</small></div>{item.user_id === user.id && <button className="status-delete-action" onClick={() => void deleteStatus(item)} disabled={Boolean(deletingStatusId)} aria-label="Remove your status update" title="Remove update">{deletingStatusId === item.id ? "Removing…" : "Remove"}</button>}</div>
              {item.mediaLoading && <div className="status-media-unavailable" role="status">Refreshing your private media link…</div>}
              {item.mediaUrl && !item.mediaError && item.content_type === "image" && <img className="status-media" src={item.mediaUrl} alt="Status update" onError={() => item.media_path && void refreshStatusMedia(item.id, item.media_path)} />}
              {item.mediaUrl && !item.mediaError && item.content_type === "video" && <video className="status-media" src={item.mediaUrl} controls playsInline preload="metadata" onError={(event) => { const code = event.currentTarget.error?.code ?? "unknown"; logStatusMediaProblem("video element playback", new Error(`MediaError code ${code}`)); if (item.media_path) void refreshStatusMedia(item.id, item.media_path); }} />}
              {item.media_path && item.mediaError && <div className="status-media-unavailable" role="status"><span>{item.mediaError}</span><button className="secondary-action" onClick={() => void refreshStatusMedia(item.id, item.media_path!, true)} disabled={item.mediaLoading}>{item.mediaLoading ? "Refreshing…" : "Retry media"}</button></div>}
              {item.body && <p className="status-caption">{item.body}</p>}
            </article>;
          })}</div>}
        </div>}

        {activeTab === "media" && <div className="social-content">
          <div className="media-summary"><span>▧</span><div><strong>Your shared shelf</strong><small>Private to the people in your conversations</small></div><b>{mediaLibrary.length}</b></div>
          {mediaLoading && <div className="page-empty">Finding your shared media…</div>}
          {!mediaLoading && mediaLibrary.length === 0 && <div className="page-empty"><span>▧</span><strong>Your shared shelf is waiting</strong><small>Photos, videos, voice messages, and files you send in chats will collect here.</small><button className="secondary-action" onClick={() => navigateTab("chats")}>Go to messages</button></div>}
          {!mediaLoading && mediaLibrary.length > 0 && <div className="media-grid">{mediaLibrary.map((item) => <button className="media-tile" key={item.id} onClick={() => { setSelectedId(item.conversation_id); saveConversation(user.id, item.conversation_id); navigateTab("chats"); setMobileChat(true); }} title={`Open conversation · ${item.body}`}>
            {item.mediaUrl && item.content_type === "image" ? <img src={item.mediaUrl} alt={item.body || item.attachment_name || "Shared photo"} /> : item.mediaUrl && item.content_type === "video" ? <video src={item.mediaUrl} muted playsInline preload="metadata" /> : <span className="media-file-icon">{item.content_type === "audio" ? "♫" : "↧"}</span>}
            <span className="media-tile-caption"><strong>{item.body || item.attachment_name || "Shared media"}</strong><small>{dateLabel(item.created_at)} · {item.content_type}</small></span>
          </button>)}</div>}
        </div>}

        {activeTab === "profile" && <div className="social-content profile-content">
          <div className="profile-hero"><div className="profile-photo-wrap"><Avatar name={profile?.display_name ?? "You"} src={profile?.avatarUrl} className="profile-photo" /><label className="photo-edit" title="Change profile photo">＋<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void uploadAvatar(file); }} disabled={profileSaving} /></label></div><p className="eyebrow">YOUR SPACE IN THE CIRCLE</p><h2>{profile?.display_name ?? "Your profile"}</h2><p>{profile?.bio || "A few words about you make this space feel more like home."}</p></div>
          <form className="profile-form" onSubmit={saveProfile}><label>Display name<input value={profileNameDraft} onChange={(event) => setProfileNameDraft(event.target.value)} maxLength={60} required /></label><label>About you<textarea value={profileBioDraft} onChange={(event) => setProfileBioDraft(event.target.value)} placeholder="A favorite little detail, a hello, anything…" maxLength={160} /></label><button className="primary-action" disabled={profileSaving}>{profileSaving ? "Saving…" : "Save profile"}</button></form>
          <div className="invite-card"><div><span>✿</span><div><strong>Your private invite</strong><small>Send this to your sister so she can join your circle.</small></div></div><button onClick={() => void copyInvite()}>{copied ? "Copied!" : inviteCode ? "Copy code" : "Loading…"}</button></div>
          <button className="signout-link" onClick={() => void signOut()} disabled={busy}>↗ Sign out of Kinfolk</button>
        </div>}
      </section>}
      {activeCall && <CallWindow key={activeCall.id} call={activeCall} peerName={conversations.find((item) => item.id === activeCall.conversation_id)?.peer?.display_name ?? "Kinfolk member"} onEnd={() => void endActiveCall()} onError={reportCallError} />}
      {incomingCall && <section className="call-incoming" role="alertdialog" aria-modal="true" aria-label="Incoming call">
        <span className="call-incoming-avatar">{initials(conversations.find((item) => item.id === incomingCall.conversation_id)?.peer?.display_name ?? "Kinfolk member")}</span>
        <p className="eyebrow">INCOMING {incomingCall.call_type.toUpperCase()} CALL</p>
        <h2>{conversations.find((item) => item.id === incomingCall.conversation_id)?.peer?.display_name ?? "Kinfolk member"}</h2>
        <div><button className="call-accept" onClick={() => void acceptCall()} disabled={busy}>Accept</button><button className="call-decline" onClick={() => void declineCall()} disabled={busy}>Decline</button></div>
      </section>}
      <nav className="mobile-nav" aria-label="Mobile navigation"><button className={activeTab === "chats" ? "mobile-active" : ""} onClick={() => navigateTab("chats")}>◉<small>Chats</small></button><button className={activeTab === "calls" ? "mobile-active" : ""} onClick={() => navigateTab("calls")}>⌁<small>Calls</small></button><button className={activeTab === "updates" ? "mobile-active" : ""} onClick={() => navigateTab("updates")}>◌<small>Updates</small></button><button className={activeTab === "media" ? "mobile-active" : ""} onClick={() => navigateTab("media")}>▧<small>Media</small></button><button className={activeTab === "profile" ? "mobile-active" : ""} onClick={() => navigateTab("profile")}>☺<small>You</small></button></nav>
    </main>
  );
}

