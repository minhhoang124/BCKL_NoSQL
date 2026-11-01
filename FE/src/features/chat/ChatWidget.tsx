import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../../contexts/useAuth";
import { ApiError, getAuthSessionVersion } from "../../services/apiClient";
import { chatApi, type InboxItem } from "./chatApi";
import { ChatThread, conversationTitle } from "./ChatPage";
import styles from "./ChatWidget.module.css";

/**
 * Floating mini chat available across shopping pages.
 * - Reuses ChatThread (one thread = one socket). Hidden on /messages so the page and
 *   the widget never hold two sockets at once.
 * - Remounted per account/session: switching account or signing out drops all state.
 * - Messages are only marked read by the explicit "displayed messages" action.
 */
export function ChatWidget() {
  const { user } = useAuth();
  const location = useLocation();
  if (
    import.meta.env.VITE_CHAT_ENABLED !== "true" ||
    !user ||
    user.role === "ADMIN" ||
    location.pathname.startsWith("/messages")
  )
    return null;
  return (
    <ChatWidgetSession
      key={`${user.id}:${getAuthSessionVersion()}`}
      actorId={user.id}
    />
  );
}

function ChatWidgetSession({ actorId }: { actorId: number }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<InboxItem[]>([]);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [session] = useState(getAuthSessionVersion);
  const live = useRef(false),
    epoch = useRef(0),
    loading = useRef(false),
    toggle = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    const token = ++epoch.current;
    try {
      const result = await chatApi.inbox();
      if (live.current && session === getAuthSessionVersion() && token === epoch.current) {
        setItems(result.items);
        setPhase("ready");
        setError("");
      }
    } catch (e) {
      if (live.current && session === getAuthSessionVersion() && token === epoch.current) {
        setPhase("error");
        setError(e instanceof Error ? e.message : "Không tải được tin nhắn.");
        if (e instanceof ApiError && [401, 403, 404].includes(e.status ?? 0)) setItems([]);
      }
    } finally {
      loading.current = false;
    }
  }, [session]);

  useEffect(() => {
    live.current = true;
    const generation = ++epoch.current;
    queueMicrotask(() => {
      if (live.current) void load();
    });
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 30000);
    return () => {
      live.current = false;
      epoch.current = generation + 1;
      loading.current = false;
      clearInterval(timer);
    };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        toggle.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const unread = items.reduce((sum, item) => sum + item.unreadCount, 0);
  const selected = items.find((item) => item.id === selectedId);

  return (
    <div className={styles.root}>
      {open && (
        <section
          id="chat-widget-panel"
          className={styles.panel}
          role="dialog"
          aria-label="Tin nhắn nhanh"
        >
          <header className={styles.head}>
            {selectedId !== null && (
              <button
                type="button"
                className={styles.iconButton}
                onClick={() => setSelectedId(null)}
                aria-label="Quay lại danh sách hội thoại"
              >
                ‹
              </button>
            )}
            <strong className={styles.title}>
              {selectedId === null
                ? "Tin nhắn"
                : (conversationTitle(selected) ?? `Hội thoại #${selectedId}`)}
            </strong>
            <Link
              className={styles.headLink}
              to={selectedId === null ? "/messages" : `/messages/${selectedId}`}
            >
              Mở rộng
            </Link>
            <button
              type="button"
              className={styles.iconButton}
              onClick={() => setOpen(false)}
              aria-label="Thu nhỏ tin nhắn"
            >
              –
            </button>
          </header>
          <div className={styles.body}>
            {selectedId === null ? (
              <>
                {phase === "loading" && <p className={styles.note}>Đang tải hội thoại…</p>}
                {phase === "error" && (
                  <p role="alert" className={styles.note}>
                    {error}{" "}
                    <button type="button" className={styles.linkButton} onClick={() => void load()}>
                      Thử lại
                    </button>
                  </p>
                )}
                {phase === "ready" && !items.length && (
                  <p className={styles.note}>
                    Chưa có hội thoại. Mở trang sản phẩm và chọn “Chat với cửa hàng” để bắt đầu.
                  </p>
                )}
                <ul className={styles.list} aria-label="Hội thoại gần đây">
                  {items.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        className={styles.item}
                        onClick={() => setSelectedId(item.id)}
                      >
                        <span className={styles.avatar} aria-hidden="true">
                          {(conversationTitle(item) ?? "?").slice(0, 1).toUpperCase()}
                        </span>
                        <span className={styles.itemText}>
                          <strong>{conversationTitle(item)}</strong>
                          <span>{item.lastMessage?.content ?? "Chưa có tin nhắn"}</span>
                        </span>
                        {item.unreadCount > 0 && (
                          <b className={styles.badge} aria-label={`${item.unreadCount} chưa đọc`}>
                            {item.unreadCount}
                          </b>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <ChatThread
                key={`${selectedId}:${session}`}
                actorId={actorId}
                id={selectedId}
                session={session}
                title={conversationTitle(selected)}
                compact
                onChange={() => {
                  void load();
                }}
              />
            )}
          </div>
        </section>
      )}
      <button
        ref={toggle}
        type="button"
        className={styles.toggle}
        aria-expanded={open}
        aria-controls="chat-widget-panel"
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">💬</span> Tin nhắn
        {unread > 0 && (
          <b className={styles.toggleBadge} aria-label={`${unread} tin chưa đọc`}>
            {unread > 99 ? "99+" : unread}
          </b>
        )}
      </button>
    </div>
  );
}
