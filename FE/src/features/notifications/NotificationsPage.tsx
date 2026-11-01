import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../contexts/useAuth";
import { getAuthSessionVersion } from "../../services/apiClient";
import { createNotificationApi, type NoticePage } from "./notificationClient";
import styles from "./NotificationsPage.module.css";

export function NotificationsPage() {
  const { user, loading } = useAuth();
  if (loading) return <p>Đang xác minh phiên đăng nhập…</p>;
  if (!user?.isActive) return <p role="alert">Vui lòng đăng nhập lại.</p>;
  return <Inbox key={`${user.id}:${user.role}:${getAuthSessionVersion()}`} />;
}
function Inbox() {
  const api = useMemo(() => createNotificationApi(), []);
  const epoch = useRef(getAuthSessionVersion());
  const active = useRef(false),
    flight = useRef(false),
    abort = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const data = useRef<NoticePage | null>(null),
    filter = useRef<boolean | null>(null);
  const [page, setPage] = useState<NoticePage | null>(null),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const valid = () =>
    active.current && getAuthSessionVersion() === epoch.current;
  const save = (p: NoticePage | null) => {
    data.current = p;
    setPage(p);
  };
  async function run(action: "load" | "more" | "one" | "all", id?: string) {
    if (flight.current || !valid()) return;
    flight.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    const owner = generation.current;
    const current = () => valid() && generation.current === owner;
    const controller = new AbortController();
    abort.current = controller;
    const timer = setTimeout(() => controller.abort(), 15000);
    const previous = data.current;
    try {
      if (action === "one") {
        await api.read(id!, controller.signal);
        if (!current()) return;
        setMessage("Đã đánh dấu đã đọc.");
      }
      if (action === "all") {
        // Bound by an actually displayed item, never a newer metadata head on an older page.
        const bound = previous?.items[0]?.id;
        if (!bound) return;
        await api.readAll(bound, controller.signal);
        if (!current()) return;
        setMessage("Đã đánh dấu đến mốc đang hiển thị.");
      }
      const p = await api.list(
        action === "more" ? previous?.nextBeforeId : null,
        filter.current,
        controller.signal,
      );
      if (!current()) return;
      if (action === "more" && previous) {
        const seen = new Set(previous.items.map((n) => n.id));
        save({
          ...p,
          items: [...previous.items, ...p.items.filter((n) => !seen.has(n.id))],
        });
      } else save(p);
    } catch {
      if (current()) {
        save(null);
        setError(
          "Chưa tải được trạng thái mới. Bấm tải lại để kiểm tra; hệ thống không tự gửi lại thao tác đánh dấu.",
        );
      }
    } finally {
      clearTimeout(timer);
      if (abort.current === controller) {
        abort.current = null;
        flight.current = false;
      }
      if (current()) setBusy(false);
    }
  }
  useEffect(() => {
    active.current = true;
    void run("load");
    return () => {
      active.current = false;
      generation.current++;
      abort.current?.abort();
      flight.current = false;
    };
    // This workspace is recreated on every account/role/session change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <section className={styles.inbox} aria-busy={busy}>
      <h1>Thông báo</h1>
      <p>
        Cập nhật về đơn hàng, cửa hàng và tin nhắn của bạn.
      </p>
      <div className={styles.toolbar}>
        <label>
          Lọc thông báo{" "}
          <select
            aria-label="Lọc thông báo"
            disabled={busy}
            defaultValue="all"
            onChange={(e) => {
              filter.current =
                e.target.value === "all" ? null : e.target.value === "unread";
              save(null);
              void run("load");
            }}
          >
            <option value="all">Tất cả</option>
            <option value="unread">Chưa đọc</option>
            <option value="read">Đã đọc</option>
          </select>
        </label>
        <button disabled={busy} onClick={() => void run("load")}>
          Tải lại
        </button>
        <button
          disabled={busy || !page?.items.length || !page.unreadCount}
          onClick={() => void run("all")}
        >
          Đánh dấu đến mốc đang hiển thị đã đọc
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {busy && <p role="status">Đang cập nhật…</p>}
      {page && (
        <>
          <p>{page.unreadCount} thông báo chưa đọc</p>
          {page.syncPending && (
            <p role="status">
              Đang đồng bộ thêm thông báo. Bạn có thể tải lại sau.
            </p>
          )}
          {!page.items.length && <p>Không có thông báo trong bộ lọc này.</p>}
          <ul className={styles.list}>
            {page.items.map((n) => (
              <li key={n.id} className={n.readAt ? styles.read : styles.unread}>
                <h2>{n.title}</h2>
                <span>{n.readAt ? "Đã đọc" : "Chưa đọc"}</span>
                <p>{n.text}</p>
                <time dateTime={n.eventAt}>
                  {new Date(n.eventAt).toLocaleString("vi-VN")}
                </time>
                <div className={styles.toolbar}>
                  <Link to={n.link}>Xem chi tiết</Link>
                  {!n.readAt && (
                    <button
                      disabled={busy}
                      onClick={() => void run("one", n.id)}
                    >
                      Đánh dấu đã đọc
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {page.nextBeforeId && (
            <button disabled={busy} onClick={() => void run("more")}>
              Xem thông báo cũ hơn
            </button>
          )}
        </>
      )}
    </section>
  );
}
export function NotificationBadge() {
  const { user, loading } = useAuth();
  if (
    import.meta.env.VITE_NOTIFICATIONS_ENABLED !== "true" ||
    loading ||
    !user?.isActive
  )
    return null;
  return <Badge key={`${user.id}:${user.role}:${getAuthSessionVersion()}`} />;
}
function Badge() {
  const [count, setCount] = useState<number | null>(null);
  const [recentItems, setRecentItems] = useState<NoticePage['items']>([]);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, []);

  useEffect(() => {
    const api = createNotificationApi();
    let active = true,
      busy = false,
      controller: AbortController | null = null;
    const load = async () => {
      if (busy) return;
      busy = true;
      const current = new AbortController();
      controller = current;
      const timeout = setTimeout(() => current.abort(), 15000);
      try {
        const p = await api.list(null, null, current.signal);
        if (active) {
          setCount(p.unreadCount);
          setRecentItems(p.items.slice(0, 5));
        }
      } catch {
        if (active) {
          setCount(null);
          setRecentItems([]);
        }
      } finally {
        clearTimeout(timeout);
        busy = false;
      }
    };
    void load();
    const interval = setInterval(() => void load(), 30000);
    return () => {
      active = false;
      controller?.abort();
      clearInterval(interval);
    };
  }, []);

  return (
    <div
      ref={menuRef}
      className={styles.badgeDropdownWrapper}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <Link
        to="/account/notifications"
        aria-label={count === null ? "Thông báo" : `Thông báo, ${count} chưa đọc`}
        className={styles.badgeLink}
        onClick={() => setOpen((o) => !o)}
      >
        Thông báo
        {count !== null && count > 0 ? ` (${count > 99 ? "99+" : count})` : ""}
      </Link>
      {open && (
        <div className={styles.noticeDropdown} role="menu" aria-label="Thông báo mới nhất">
          <div className={styles.dropdownHeader}>
            <strong>Thông báo mới nhận</strong>
            {count !== null && count > 0 && <span className={styles.unreadTag}>{count} mới</span>}
          </div>
          {recentItems.length === 0 ? (
            <p className={styles.emptyNotice}>Chưa có thông báo nào.</p>
          ) : (
            <ul className={styles.dropdownList}>
              {recentItems.map((n) => (
                <li key={n.id} className={!n.readAt ? styles.dropdownItemUnread : styles.dropdownItem}>
                  {n.link ? (
                    <Link to={n.link} onClick={() => setOpen(false)} className={styles.dropdownItemLink}>
                      <span className={styles.itemTitle}>{n.title}</span>
                      <p className={styles.itemText}>{n.text}</p>
                      <time className={styles.itemTime}>{new Date(n.eventAt).toLocaleDateString('vi-VN')}</time>
                    </Link>
                  ) : (
                    <div className={styles.dropdownItemLink}>
                      <span className={styles.itemTitle}>{n.title}</span>
                      <p className={styles.itemText}>{n.text}</p>
                      <time className={styles.itemTime}>{new Date(n.eventAt).toLocaleDateString('vi-VN')}</time>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className={styles.dropdownFooter}>
            <Link to="/account/notifications" onClick={() => setOpen(false)} className={styles.viewAllBtn}>
              Xem tất cả thông báo ›
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
