export type ConversationKind = "dm" | "group";

export type DundeeConversation = {
  id: string;
  line_id: string;
  chat_jid: string;
  kind: ConversationKind;
  title: string | null;
  last_preview: string | null;
  last_message_at: string | null;
  last_direction: string | null;
  inbound_count: number;
  outbound_count: number;
  unanswered_since: string | null;
  participant_count: number;
};

export type DundeeMessage = {
  id: string;
  conversation_id: string;
  wa_message_id: string;
  direction: "inbound" | "outbound";
  from_me: boolean;
  sender_phone: string | null;
  sender_name: string | null;
  body: string;
  media_type: string | null;
  media_url: string | null;
  media_id: string | null;
  quoted_text: string | null;
  chat_jid: string;
  sent_at: string;
};
