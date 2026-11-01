import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../contexts/useAuth";
import { getAuthSessionVersion } from "../services/apiClient";
import {
  ImageSearchError,
  searchImage,
  validateQueryFile,
} from "../services/imageSearchApi";
import type { SearchResponse } from "../types/marketplace";
import { SearchResultCard } from "../services/searchTelemetry";
import { prepareSearchTelemetry } from "../services/searchAnalyticsClient";
import styles from "./ImageSearchPage.module.css";

export function ImageSearchPage() {
  const { user, loading } = useAuth();
  if (loading) return <p role="status">Đang khôi phục phiên…</p>;
  return (
    <ImageQuery
      key={`${user?.id ?? "guest"}:${user?.isActive}:${getAuthSessionVersion()}`}
    />
  );
}

function ImageQuery() {
  const [selection, setSelection] = useState<{
    file: File;
    url: string;
  } | null>(null);
  const [previewReady, setPreviewReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(Date.now);
  const remaining = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));
  const resources = useRef<{
    controller: AbortController | null;
    url: string | null;
    generation: number;
    busy: boolean;
    mounted: boolean;
  }>({ controller: null, url: null, generation: 0, busy: false, mounted: true });
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // The holder is stable; its fields track the latest request/photo allocation.
    const owned = resources.current;
    owned.mounted = true;
    return () => {
      owned.mounted = false;
      ++owned.generation;
      owned.controller?.abort();
      if (owned.url) URL.revokeObjectURL(owned.url);
    };
  }, []);
  useEffect(() => {
    if (!cooldownUntil) return;
    const timer = setInterval(() => {
      const time = Date.now();
      setNow(time);
      if (time >= cooldownUntil) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldownUntil]);

  function stop() {
    ++resources.current.generation;
    resources.current.controller?.abort();
    resources.current.controller = null;
    resources.current.busy = false;
    setPending(false);
  }
  function choose(file?: File) {
    stop();
    setResult(null);
    setError("");
    setNotice("");
    setPreviewReady(false);
    if (resources.current.url) URL.revokeObjectURL(resources.current.url);
    resources.current.url = null;
    setSelection(null);
    if (!file) return;
    try {
      validateQueryFile(file);
      const url = URL.createObjectURL(file);
      resources.current.url = url;
      setSelection({ file, url });
    } catch (reason) {
      setError(
        reason instanceof ImageSearchError
          ? reason.message
          : "Không thể xem ảnh này. Hãy chọn ảnh khác.",
      );
      if (input.current) input.current.value = "";
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (
      resources.current.busy ||
      !selection ||
      !previewReady ||
      Date.now() < cooldownUntil
    )
      return;
    resources.current.busy = true;
    const request = ++resources.current.generation;
    const cancel = new AbortController();
    resources.current.controller = cancel;
    setPending(true);
    setError("");
    setNotice("");
    setResult(null);
    try {
      await prepareSearchTelemetry();
      if(cancel.signal.aborted) return;
      const response = await searchImage(selection.file, cancel.signal);
      if (resources.current.mounted && request === resources.current.generation)
        setResult(response);
    } catch (reason) {
      if (!resources.current.mounted || request !== resources.current.generation)
        return;
      setError(
        reason instanceof ImageSearchError
          ? reason.message
          : "Không thể tìm ảnh. Vui lòng thử lại.",
      );
      if (reason instanceof ImageSearchError && reason.retryAfterSeconds > 0) {
        const time = Date.now();
        setNow(time);
        setCooldownUntil(time + reason.retryAfterSeconds * 1000);
      }
    } finally {
      if (resources.current.mounted && request === resources.current.generation) {
        resources.current.busy = false;
        resources.current.controller = null;
        setPending(false);
      }
    }
  }
  return (
    <div className={styles.page}>
      <header>
        <Link to="/">← Tìm bằng từ khóa</Link>
        <h1>Tìm sản phẩm bằng ảnh</h1>
      </header>
      <form className={styles.panel} onSubmit={(event) => void submit(event)}>
        <label htmlFor="image-query">Ảnh JPEG hoặc PNG, tối đa 5 MiB</label>
        <input
          ref={input}
          id="image-query"
          type="file"
          accept="image/jpeg,image/png"
          onChange={(event) => choose(event.target.files?.[0])}
        />
        {selection && (
          <img
            key={selection.url}
            className={styles.preview}
            src={selection.url}
            alt="Ảnh đang dùng để tìm kiếm"
            onLoad={(event) => {
              if (event.currentTarget.src !== resources.current.url) return;
              if (
                !event.currentTarget.naturalWidth ||
                !event.currentTarget.naturalHeight
              ) {
                setPreviewReady(false);
                setError("Không thể giải mã ảnh này.");
              } else if (
                event.currentTarget.naturalWidth *
                  event.currentTarget.naturalHeight >
                25000000
              ) {
                setPreviewReady(false);
                setError("Ảnh vượt giới hạn 25 triệu điểm ảnh.");
              } else {
                setPreviewReady(true);
                setError("");
              }
            }}
            onError={(event) => {
              if (event.currentTarget.src === resources.current.url) {
                setPreviewReady(false);
                setError("Không thể giải mã ảnh. Hãy chọn JPEG hoặc PNG khác.");
              }
            }}
          />
        )}
        <div className={styles.actions}>
          <button
            type="submit"
            disabled={pending || !selection || !previewReady || remaining > 0}
          >
            {pending ? "Đang tìm ảnh…" : "Tìm bằng ảnh"}
          </button>
          {pending && (
            <button
              type="button"
              onClick={() => {
                stop();
                setNotice(
                  "Đã dừng chờ kết quả. Máy chủ có thể đã nhận ảnh; thao tác này không xóa dữ liệu đã gửi.",
                );
              }}
            >
              Dừng chờ kết quả
            </button>
          )}
          {selection && (
            <button
              type="button"
              onClick={() => {
                choose();
                if (input.current) input.current.value = "";
              }}
            >
              Bỏ ảnh
            </button>
          )}
        </div>
        {pending && <p role="status">Đang gửi ảnh và tìm sản phẩm…</p>}
        {remaining > 0 && (
          <p role="status">Có thể thử lại sau {remaining} giây.</p>
        )}
        {notice && <p role="status">{notice}</p>}
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </form>
      {result && (
        <section aria-label="Kết quả tìm ảnh">
          <h2>{result.items.length} sản phẩm tìm thấy</h2>
          {result.items.length === 0 ? (
            <p>Không có kết quả phù hợp. Bạn có thể chọn ảnh khác.</p>
          ) : (
            <div className={styles.grid}>
              {result.items.map((item) => (
                <SearchResultCard key={`${result.analytics?.token??"untracked"}:${item.productId}`} product={item.product} token={result.analytics?.token} />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
