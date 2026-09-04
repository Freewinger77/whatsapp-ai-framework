"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  clockTime,
  conversationLabel,
  formatPhone,
  relativeTime,
  waitLabel,
} from "@/lib/format";
import type { DundeeConversation, DundeeMessage } from "@/lib/types";

type Filter = "all" | "dm" | "group" | "waiting";

export function Inbox({
  initialConversations,
  initialMessages,
  selectedId,
  operatorEmail,
}: {
  initialConversations: DundeeConversation[];
  initialMessages: DundeeMessage[];
  selectedId: string | null;
  operatorEmail: string;
}) {
  const [conversations, setConversations] = useState(initialConversations);
  const [messages, setMessages] = useState(initialMessages);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState(selectedId);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("dundee-inbox")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "dundee_conversations" },
        (payload) => {
          const row = payload.new as DundeeConversation;
          if (!row?.id) return;
          setConversations((current) => {
            const next = current.filter((item) => item.id !== row.id);
            next.push(row);
            next.sort((a, b) =>
              String(b.last_message_at || "").localeCompare(String(a.last_message_at || ""))
            );
            return next;
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "dundee_messages" },
        (payload) => {
          const row = payload.new as DundeeMessage;
          if (!row?.id) return;
          setMessages((current) => {
            if (current.some((item) => item.id === row.id)) return current;
            return [...current, row].sort((a, b) => a.sent_at.localeCompare(b.sent_at));
          });
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  const todayStart = useMemo(() => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date.toISOString();
  }, []);

  const visible = conversations.filter((conversation) => {
    if (filter === "dm" && conversation.kind !== "dm") return false;
    if (filter === "group" && conversation.kind !== "group") return false;
    if (filter === "waiting" && !conversation.unanswered_since) return false;
    if (!query.trim()) return true;
    const hay = `${conversation.title} ${conversation.chat_jid} ${conversation.last_preview}`.toLowerCase();
    return hay.includes(query.trim().toLowerCase());
  });

  const active = visible.find((item) => item.id === activeId) || visible[0] || null;
  const thread = messages.filter((message) => message.conversation_id === active?.id);

  const messagesToday = conversations.reduce((sum, item) => {
    if (!item.last_message_at || item.last_message_at < todayStart) return sum;
    return sum + item.inbound_count + item.outbound_count;
  }, 0);
  const waiting = conversations.filter((item) => item.unanswered_since).length;
  const hottest = [...conversations]
    .filter((item) => item.kind === "group")
    .sort((a, b) => b.inbound_count - a.inbound_count)[0];

  return (
    <div className="inbox-shell">
      <aside className="rail">
        <header className="rail-head">
          <div>
            <p className="eyebrow">Tyre Fighter Dundee</p>
            <h1>+44 7883 023296</h1>
          </div>
          <form action="/logout" method="post">
            <button type="submit" className="ghost">
              Sign out
            </button>
          </form>
        </header>

        <section className="stats">
          <Stat label="Chats" value={String(conversations.length)} />
          <Stat label="Today" value={String(messagesToday)} />
          <Stat label="Waiting" value={String(waiting)} />
          <Stat
            label="Hottest"
            value={hottest ? conversationLabel(hottest.title, hottest.chat_jid, hottest.kind) : "—"}
          />
        </section>

        <div className="filters">
          {(["all", "dm", "group", "waiting"] as Filter[]).map((item) => (
            <button
              key={item}
              className={filter === item ? "chip on" : "chip"}
              onClick={() => setFilter(item)}
              type="button"
            >
              {item === "dm" ? "DMs" : item[0].toUpperCase() + item.slice(1)}
            </button>
          ))}
        </div>

        <input
          className="search"
          placeholder="Search chats, postcodes, sizes…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />

        <ul className="chat-list">
          {visible.map((conversation) => {
            const selected = conversation.id === active?.id;
            const wait = waitLabel(conversation.unanswered_since);
            return (
              <li key={conversation.id}>
                <button
                  type="button"
                  className={selected ? "chat on" : "chat"}
                  onClick={() => {
                    setActiveId(conversation.id);
                    const url = new URL(window.location.href);
                    url.searchParams.set("c", conversation.id);
                    window.history.replaceState({}, "", url);
                  }}
                >
                  <div className="chat-top">
                    <span className={conversation.kind === "group" ? "badge group" : "badge dm"}>
                      {conversation.kind === "group" ? "Group" : "DM"}
                    </span>
                    <span className="when">{relativeTime(conversation.last_message_at)}</span>
                  </div>
                  <strong>
                    {conversationLabel(conversation.title, conversation.chat_jid, conversation.kind)}
                  </strong>
                  <p>{conversation.last_preview || "No text"}</p>
                  <div className="chat-meta">
                    <span>
                      {conversation.inbound_count + conversation.outbound_count} msgs
                    </span>
                    {wait ? <span className="wait">{wait}</span> : null}
                  </div>
                </button>
              </li>
            );
          })}
          {visible.length === 0 ? <li className="empty">No conversations in this filter.</li> : null}
        </ul>
        <p className="operator">{operatorEmail}</p>
      </aside>

      <main className="thread">
        {active ? (
          <>
            <header className="thread-head">
              <div>
                <p className="eyebrow">
                  {active.kind === "group" ? "Group thread" : "Private chat"} · {active.chat_jid}
                </p>
                <h2>{conversationLabel(active.title, active.chat_jid, active.kind)}</h2>
              </div>
              <p className="muted">
                Read-only inbox. Replies stay on the phone / wasup until n8n is wired.
              </p>
            </header>
            <ol className="bubbles">
              {thread.map((message) => (
                <li
                  key={message.id}
                  className={message.from_me || message.direction === "outbound" ? "bubble me" : "bubble"}
                >
                  {active.kind === "group" && message.direction === "inbound" ? (
                    <span className="sender">
                      {message.sender_name || formatPhone(message.sender_phone) || "Group member"}
                    </span>
                  ) : null}
                  {message.quoted_text ? <blockquote>{message.quoted_text}</blockquote> : null}
                  {message.body ? <p>{message.body}</p> : null}
                  {message.media_url ? (
                    message.media_type === "image" || message.media_url.match(/\.(jpg|jpeg|png|webp)(\?|$)/i) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={message.media_url} alt="" className="media" />
                    ) : (
                      <a href={message.media_url} target="_blank" rel="noreferrer" className="media-link">
                        {message.media_type || "attachment"}
                      </a>
                    )
                  ) : null}
                  <time>{clockTime(message.sent_at)}</time>
                </li>
              ))}
              {thread.length === 0 ? <li className="empty">No messages in this thread yet.</li> : null}
            </ol>
          </>
        ) : (
          <div className="empty-thread">
            <h2>No chats yet</h2>
            <p>Backfill from wasup or wait for the n8n live feed.</p>
          </div>
        )}
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
