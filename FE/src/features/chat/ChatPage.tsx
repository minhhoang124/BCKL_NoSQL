import { useCallback, useEffect, useRef, useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { io, type Socket } from "socket.io-client";
import { useAuth } from "../../contexts/useAuth";
import {
  API_URL,
  ApiError,
  getAccessToken,
  getAuthSessionVersion,
  refreshSession,
} from "../../services/apiClient";
import {
  chatApi,
  mergeMessages,
  type InboxItem,
  type Message,
} from "./chatApi";
import { clearPending, loadPending, preparePending } from "./chatPending";
import styles from "./ChatPage.module.css";

const explain = (error: unknown) =>
  error instanceof Error ? error.message : "Không thể kết nối Chat.";
export function ChatPage() {
  const { user } = useAuth();
  const { conversationId } = useParams();
  if (!user) return null;
  return (
    <ChatSession
      key={`${user.id}:${getAuthSessionVersion()}`}
      actorId={user.id}
      conversationId={conversationId}
    />
  );
}
function ChatSession({
  actorId,
  conversationId,
}: {
  actorId: number;
  conversationId?: string;
}) {
  const [items, setItems] = useState<InboxItem[]>([]),
    [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [inboxPhase, setInboxPhase] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const navigate = useNavigate(),
    [query] = useSearchParams();
  const [session] = useState(getAuthSessionVersion),
    epoch = useRef(0),
    live = useRef(false),
    loading = useRef(false),
    opening = useRef(false);
  const storeId = Number(query.get("storeId")),
    id = Number(conversationId);
  const validStore =
    /^[1-9]\d*$/.test(query.get("storeId") ?? "") && storeId <= 2147483647;
  const load = useCallback(
    async (next?: string) => {
      if (loading.current) return;
      loading.current = true;
      const token = ++epoch.current;
      try {
        const result = await chatApi.inbox(next);
        if (
          live.current &&
          session === getAuthSessionVersion() &&
          token === epoch.current
        ) {
          setItems((old) =>
            next
              ? [
                  ...old.filter(
                    (item) => !result.items.some((m) => m.id === item.id),
                  ),
                  ...result.items,
                ]
              : result.items,
          );
          setCursor(result.nextCursor);
          setError("");
          setInboxPhase("ready");
        }
      } catch (e) {
        if (
          live.current &&
          session === getAuthSessionVersion() &&
          token === epoch.current
        ) {
          setError(explain(e));
          setInboxPhase("error");
          if (
            e instanceof ApiError &&
            [401, 403, 404].includes(e.status ?? 0)
          ) {
            setItems([]);
            setCursor(null);
          }
        }
      } finally {
        loading.current = false;
      }
    },
    [session],
  );
  useEffect(() => {
    live.current = true;
    const generation = ++epoch.current;
    queueMicrotask(() => {
      if (live.current) void load();
    });
    const timer = setInterval(() => {
      void load();
    }, 30000);
    return () => {
      live.current = false;
      epoch.current = generation + 1;
      loading.current = false;
      clearInterval(timer);
    };
  }, [load]);
  const open = async () => {
    if (opening.current || !validStore) return;
    opening.current = true;
    setBusy(true);
    try {
      const result = await chatApi.open(storeId, actorId);
      if (live.current && session === getAuthSessionVersion()) {
        navigate(`/messages/${result.id}`);
        void load();
      }
    } catch (e) {
      if (live.current && session === getAuthSessionVersion())
        setError(explain(e));
    } finally {
      opening.current = false;
      if (live.current && session === getAuthSessionVersion()) setBusy(false);
    }
  };
  return (
    <main className={styles.page}>
      <h1>Tin nhắn</h1>
      <p>Trao đổi riêng với cửa hàng. Hiện hỗ trợ tin nhắn chữ.</p>
      {error && <p role="alert">{error}</p>}
      {validStore && (
        <button disabled={busy} onClick={() => void open()}>
          Bắt đầu hội thoại với cửa hàng #{storeId}
        </button>
      )}
      <div className={styles.columns}>
        <aside aria-label="Danh sách hội thoại">
          <button onClick={() => void load()}>Tải lại hội thoại</button>
          {inboxPhase === "loading" && <p>Đang tải hội thoại…</p>}
          {inboxPhase === "ready" && !items.length && <p>Chưa có hội thoại.</p>}
          {items.map((item) => (
            <Link
              className={styles.conversation}
              aria-current={item.id === id ? "page" : undefined}
              key={item.id}
              to={`/messages/${item.id}`}
            >
              <strong>
                {item.context === "BUYER"
                  ? item.store.name
                  : item.buyer.fullName || `Khách #${item.buyer.id}`}
              </strong>
              <span>
                {item.context === "BUYER" ? "Mua hàng" : "Cửa hàng của bạn"}
              </span>
              <span>{item.lastMessage?.content ?? "Chưa có tin nhắn"}</span>
              {item.unreadCount > 0 && <b>{item.unreadCount} chưa đọc</b>}
            </Link>
          ))}
          {cursor && (
            <button onClick={() => void load(cursor)}>Thêm hội thoại</button>
          )}
        </aside>
        {conversationId &&
        /^[1-9]\d*$/.test(conversationId) &&
        id <= 2147483647 ? (
          <ChatThread
            key={`${id}:${session}`}
            actorId={actorId}
            id={id}
            session={session}
            onChange={() => {
              void load();
            }}
          />
        ) : (
          <section>
            <p>Chọn hội thoại để xem lịch sử và trả lời.</p>
          </section>
        )}
      </div>
    </main>
  );
}
function ChatThread({
  actorId,
  id,
  session,
  onChange,
}: {
  actorId: number;
  id: number;
  session: number;
  onChange: () => void;
}) {
  const [initialPending] = useState(() => {
    try {
      return { value: loadPending(actorId), error: "" };
    } catch (e) {
      return { value: null, error: explain(e) };
    }
  });
  const [messages, setMessages] = useState<Message[]>([]),
    [content, setContent] = useState(""),
    [error, setError] = useState(initialPending.error),
    [status, setStatus] = useState("Đang kết nối…");
  const [before, setBefore] = useState<number | null>(null),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [connection, setConnection] = useState(0),
    [readBusy, setReadBusy] = useState(false);
  const [pending, setPending] = useState<ReturnType<typeof loadPending>>(
      initialPending.value,
    ),
    [storageBlocked, setStorageBlocked] = useState(!!initialPending.error);
  const canonicalMessages = useRef<Message[]>([]);
  const live = useRef(false),
    epoch = useRef(0),
    sending = useRef(false),
    reading = useRef(false),
    syncing = useRef(false),
    dirty = useRef(false),
    watermark = useRef<number | null>(null),
    socket = useRef<Socket | null>(null),
    older = useRef(false),
    onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  const current = useCallback(
    () => live.current && session === getAuthSessionVersion(),
    [session],
  );
  const sync = useCallback(async () => {
    dirty.current = true;
    if (syncing.current) return;
    syncing.current = true;
    const token = epoch.current;
    try {
      do {
        dirty.current = false;
        const page = await chatApi.history(
          id,
          watermark.current === null
            ? {}
            : { afterSequence: watermark.current },
        );
        if (!current() || token !== epoch.current) return;
        const initial = watermark.current === null;
        if (initial) setBefore(page.nextBeforeSequence);
        canonicalMessages.current = mergeMessages(
          canonicalMessages.current,
          page.items,
        );
        watermark.current =
          page.items.at(-1)?.sequence ?? watermark.current ?? 0;
        setMessages(canonicalMessages.current);
        setReady(true);
        setError("");
        if (page.hasMore && !initial) dirty.current = true;
      } while (dirty.current && current());
    } catch (e) {
      if (current() && token === epoch.current) {
        setError(explain(e));
        setReady(false);
        if (e instanceof ApiError && [401, 403, 404].includes(e.status ?? 0)) {
          canonicalMessages.current = [];
          watermark.current = null;
          setMessages([]);
          setBefore(null);
        }
      }
    } finally {
      if (token === epoch.current) syncing.current = false;
    }
  }, [id, current]);
  useEffect(() => {
    live.current = true;
    const generation = ++epoch.current;
    syncing.current = false;
    const client = io(`${API_URL}/chat`, {
      transports: ["websocket"],
      auth: { token: getAccessToken() },
      reconnectionAttempts: 3,
      timeout: 8000,
      autoConnect: false,
    });
    socket.current = client;
    const valid = () => current() && socket.current === client;
    client.on("chat:ready", () => {
      if (!valid()) return;
      client
        .timeout(8000)
        .emit(
          "conversation:join",
          { conversationId: id },
          (failure: Error | null, reply: { ok?: boolean }) => {
            if (!valid()) return;
            if (failure || reply?.ok !== true) {
              setStatus("Không thể tham gia realtime; có thể tải lại lịch sử.");
              return;
            }
            setStatus("Đang kết nối trực tiếp");
            void sync();
          },
        );
    });
    // Push is a hint, never advances the durable cursor. Fetch ordered history to close gaps.
    client.on("message:created", () => {
      if (valid()) {
        void sync();
        onChangeRef.current();
      }
    });
    client.on("conversation:updated", () => {
      if (valid()) onChangeRef.current();
    });
    client.on("disconnect", () => {
      if (valid()) setStatus("Mất kết nối realtime; đang tải bù qua API.");
    });
    client.on("connect_error", () => {
      if (valid()) setStatus("Realtime chưa kết nối; lịch sử vẫn tải qua API.");
    });
    client.connect();
    queueMicrotask(() => {
      if (valid()) void sync();
    });
    const timer = setInterval(() => {
      if (current() && document.visibilityState === "visible") void sync();
    }, 15000);
    return () => {
      live.current = false;
      epoch.current = generation + 1;
      client.removeAllListeners();
      client.disconnect();
      clearInterval(timer);
      socket.current = null;
    };
  }, [actorId, id, current, sync, connection]);
  const send = async () => {
    if (sending.current || storageBlocked || !ready || !current()) return;
    sending.current = true;
    setBusy(true);
    try {
      let candidate = loadPending(actorId);
      if (candidate && candidate.value.conversationId !== id)
        throw Error("Còn tin chờ ở hội thoại khác.");
      if (!candidate) {
        if (!content.trim() || [...content.trim()].length > 2000)
          throw Error("Nhập 1–2.000 ký tự.");
        candidate = preparePending({
          version: 1,
          actorId,
          conversationId: id,
          clientMessageId: crypto.randomUUID(),
          content: content.trim(),
        });
      }
      setPending(candidate);
      const value = candidate.value;
      await chatApi.send(id, actorId, value.clientMessageId, value.content);
      if (!current()) return;
      clearPending(actorId, candidate.raw);
      setPending(null);
      setContent("");
      await sync();
      if (current()) onChangeRef.current();
    } catch (e) {
      if (current()) {
        setError(explain(e));
        try {
          setPending(loadPending(actorId));
        } catch {
          setStorageBlocked(true);
        }
      }
    } finally {
      sending.current = false;
      if (current()) setBusy(false);
    }
  };
  const loadOlder = async () => {
    if (before === null || older.current) return;
    older.current = true;
    const token = epoch.current;
    try {
      const page = await chatApi.history(id, { beforeSequence: before });
      if (current() && token === epoch.current) {
        canonicalMessages.current = mergeMessages(
          canonicalMessages.current,
          page.items,
        );
        setMessages(canonicalMessages.current);
        setBefore(page.nextBeforeSequence);
      }
    } catch (e) {
      if (current() && token === epoch.current) setError(explain(e));
    } finally {
      older.current = false;
    }
  };
  const markRead = async () => {
    const message = messages.at(-1);
    if (!message || reading.current || !current()) return;
    reading.current = true;
    setReadBusy(true);
    try {
      await chatApi.read(id, message);
      if (current()) onChangeRef.current();
    } catch (e) {
      if (current()) setError(explain(e));
    } finally {
      reading.current = false;
      if (current()) setReadBusy(false);
    }
  };
  const reconnect = async () => {
    try {
      await refreshSession(session);
      if (current()) setConnection((old) => old + 1);
    } catch (e) {
      if (current()) setError(explain(e));
    }
  };
  return (
    <section aria-label={`Hội thoại ${id}`} className={styles.thread}>
      <h2>Hội thoại #{id}</h2>
      <p role="status">{status}</p>
      <div className={styles.actions}>
        <button onClick={() => void reconnect()}>Kết nối lại</button>
        <button onClick={() => void sync()}>Tải lại tin nhắn</button>
      </div>
      {error && <p role="alert">{error}</p>}
      {before !== null && (
        <button onClick={() => void loadOlder()}>Tin nhắn cũ hơn</button>
      )}
      {!ready && !error && <p>Đang tải lịch sử…</p>}
      {ready && messages.length === 0 && (
        <p>Chưa có tin nhắn. Bạn có thể bắt đầu trao đổi.</p>
      )}
      <ol aria-label="Lịch sử tin nhắn" className={styles.messages}>
        {messages.map((message) => (
          <li
            key={message.id}
            className={message.senderId === actorId ? styles.own : styles.peer}
          >
            <span>
              {message.senderId === actorId
                ? "Bạn"
                : message.senderType === "SELLER"
                  ? "Cửa hàng"
                  : "Khách hàng"}
            </span>
            <p>{message.content}</p>
            <time dateTime={message.createdAt}>
              {new Date(message.createdAt).toLocaleString("vi-VN")}
            </time>
          </li>
        ))}
      </ol>
      <button
        disabled={!messages.length || readBusy}
        onClick={() => void markRead()}
      >
        Đánh dấu đã đọc các tin đã hiển thị
      </button>
      {pending && (
        <p role="status">
          Có tin chưa rõ kết quả.{" "}
          {pending.value.conversationId === id ? (
            "Chỉ gửi lại cùng mã và nội dung đã lưu."
          ) : (
            <Link to={`/messages/${pending.value.conversationId}`}>
              Về hội thoại đang chờ
            </Link>
          )}
        </p>
      )}
      {storageBlocked && (
        <p role="alert">
          Không đọc được vùng lưu tin chờ. Chưa cho gửi thêm tin để tránh trùng.
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <label htmlFor="chat-message">Nội dung tin nhắn</label>
        <textarea
          id="chat-message"
          value={
            pending?.value.conversationId === id
              ? pending.value.content
              : content
          }
          disabled={busy || !!pending || storageBlocked}
          onChange={(e) => setContent(e.target.value)}
          rows={3}
        />
        <button
          type="submit"
          disabled={
            !ready ||
            busy ||
            storageBlocked ||
            (pending
              ? pending.value.conversationId !== id
              : !content.trim() || [...content.trim()].length > 2000)
          }
        >
          {busy ? "Đang gửi…" : pending ? "Gửi lại cùng mã" : "Gửi tin nhắn"}
        </button>
      </form>
      <small>
        Mã và nội dung tin đang chờ chỉ giữ trong phiên tab này để tránh gửi
        trùng; không lưu token. Đóng tab có thể mất tin chưa xác nhận.
      </small>
    </section>
  );
}
