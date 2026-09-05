import { redirect } from "next/navigation";
import { Inbox } from "@/components/inbox";
import { createAdminClient, createUserServerClient } from "@/lib/supabase/server";
import type { DundeeConversation, DundeeMessage } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const userClient = await createUserServerClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const admin = createAdminClient();
  const { data: conversations } = await admin
    .from("dundee_conversations")
    .select("*")
    .order("last_message_at", { ascending: false });

  const selectedId = params.c || conversations?.[0]?.id || null;
  let messages: DundeeMessage[] = [];
  if (selectedId) {
    const { data } = await admin
      .from("dundee_messages")
      .select("*")
      .eq("conversation_id", selectedId)
      .order("sent_at", { ascending: true })
      .limit(800);
    messages = (data || []) as DundeeMessage[];
  }

  const extras = (conversations || [])
    .filter((item) => item.id !== selectedId)
    .slice(0, 8);
  if (extras.length) {
    const { data } = await admin
      .from("dundee_messages")
      .select("*")
      .in(
        "conversation_id",
        extras.map((item) => item.id)
      )
      .order("sent_at", { ascending: true })
      .limit(200);
    messages = [...messages, ...((data || []) as DundeeMessage[])];
  }

  return (
    <Inbox
      initialConversations={(conversations || []) as DundeeConversation[]}
      initialMessages={messages}
      selectedId={selectedId}
      operatorEmail={user.email || ""}
    />
  );
}
