import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { AccessToken } from "livekit-server-sdk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const accessToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) return NextResponse.json({ error: "Sign in before joining a call." }, { status: 401 });

  const body = await request.json().catch(() => null) as { callSessionId?: unknown } | null;
  const callSessionId = typeof body?.callSessionId === "string" ? body.callSessionId : "";
  if (!callSessionId) return NextResponse.json({ error: "A call session is required." }, { status: 400 });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseKey = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)?.trim();
  const livekitUrlValue = process.env.LIVEKIT_URL?.trim();
  const livekitApiKey = process.env.LIVEKIT_API_KEY?.trim();
  const livekitApiSecret = process.env.LIVEKIT_API_SECRET?.trim();
  if (!supabaseUrl || !supabaseKey || !livekitUrlValue || !livekitApiKey || !livekitApiSecret) {
    return NextResponse.json({ error: "Server call credentials are not configured." }, { status: 503 });
  }

  let livekitUrl: URL;
  try {
    livekitUrl = new URL(livekitUrlValue);
  } catch {
    return NextResponse.json({ error: "LIVEKIT_URL must be a valid LiveKit WebSocket URL (wss://...)." }, { status: 503 });
  }
  const localWs = livekitUrl.protocol === "ws:" && ["localhost", "127.0.0.1", "::1"].includes(livekitUrl.hostname);
  if ((!localWs && livekitUrl.protocol !== "wss:") || livekitUrl.username || livekitUrl.password || livekitUrl.search || livekitUrl.hash) {
    return NextResponse.json({ error: "LIVEKIT_URL must use wss:// (ws:// is allowed only for localhost) and contain no credentials or query string." }, { status: 503 });
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  const { data: authData, error: authError } = await supabase.auth.getUser(accessToken);
  if (authError || !authData.user) return NextResponse.json({ error: "Your session is invalid or expired." }, { status: 401 });

  const { data: call, error: callError } = await supabase
    .from("call_sessions")
    .select("id,conversation_id,caller_id,callee_id,status")
    .eq("id", callSessionId)
    .maybeSingle();
  if (callError || !call) return NextResponse.json({ error: "Call not found or you are not a conversation member." }, { status: 404 });

  const { data: verifiedMembership, error: verifiedMembershipError } = await supabase
    .from("conversation_members")
    .select("conversation_id")
    .eq("conversation_id", call.conversation_id)
    .eq("user_id", authData.user.id)
    .maybeSingle();
  if (verifiedMembershipError || !verifiedMembership) {
    return NextResponse.json({ error: "You are not a member of this conversation." }, { status: 403 });
  }

  const isParticipant = call.caller_id === authData.user.id || call.callee_id === authData.user.id;
  const callerWaiting = call.status === "ringing" && call.caller_id === authData.user.id;
  if (!isParticipant || !(call.status === "active" || callerWaiting)) {
    return NextResponse.json({ error: "This account is not allowed to join this call." }, { status: 403 });
  }

  try {
    const token = new AccessToken(livekitApiKey, livekitApiSecret, {
      identity: authData.user.id,
      name: String(authData.user.user_metadata?.display_name ?? authData.user.email ?? "Kinfolk member"),
      ttl: "5m",
    });
    // Keep the JWT room grant and the room expected by the client tied to this exact call.
    token.addGrant({ roomJoin: true, room: call.id, canPublish: true, canSubscribe: true });
    const participantToken = await token.toJwt();
    return NextResponse.json({ serverUrl: livekitUrl.toString(), roomName: call.id, participantToken });
  } catch (error) {
    // Report useful signing diagnostics while ensuring credential/JWT values never enter logs.
    const rawMessage = error instanceof Error ? error.message : "Unknown token signing error";
    const safeMessage = [livekitApiKey, livekitApiSecret, accessToken].reduce(
      (message, secret) => secret ? message.split(secret).join("[redacted]") : message,
      rawMessage,
    );
    console.error("LiveKit token signing failed:", safeMessage);
    return NextResponse.json({ error: `Could not create a secure call token: ${safeMessage}` }, { status: 500 });
  }
}
