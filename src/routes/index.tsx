import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import videoMapJson from "@/data/video-map.json";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ytscrapper — DSA video timestamp finder" },
      {
        name: "description",
        content:
          "Search a DSA topic and jump straight to the exact YouTube video and timestamp where it was taught.",
      },
      { property: "og:title", content: "ytscrapper — DSA video timestamp finder" },
      {
        property: "og:description",
        content:
          "Search a DSA topic and jump straight to the exact YouTube video and timestamp where it was taught.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

interface SearchResult {
  id: string;
  score: number;
  cosine_similarity?: number;
  video_number: number;
  video_title: string;
  start: number;
  end: number;
  text: string;
}

// video_number -> YouTube video_id mapping (playlist order).
const videoMap = videoMapJson as Record<string, string | Record<string, string>>;
const titleVideoMap = (videoMapJson as Record<string, any>).title_to_id as Record<string, string> | undefined;

function normalizeVideoKey(value: number | string): string {
  return String(value).replace(/^0+/, "");
}

function normalizeTitleKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatSeconds(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

function loadYouTubeApi(): Promise<void> {
  return new Promise((resolve) => {
    if (window.YT?.Player) {
      resolve();
      return;
    }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(tag);
    }
  });
}

function Index() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const playerRef = useRef<any>(null);
  const playerReadyRef = useRef(false);
  const loadedVideoIdRef = useRef<string | null>(null);
  const pendingPlayRef = useRef<{ videoId: string; start: number } | null>(null);
  const [currentTitle, setCurrentTitle] = useState<string | null>(null);

  // Set up the YouTube player once.
  useEffect(() => {
    let cancelled = false;
    loadYouTubeApi().then(() => {
      if (cancelled || playerRef.current) return;
      playerRef.current = new window.YT.Player("yt-player", {
        height: "100%",
        width: "100%",
        playerVars: { rel: 0 },
        events: {
          onReady: () => {
            playerReadyRef.current = true;
            const pending = pendingPlayRef.current;
            if (pending) {
              pendingPlayRef.current = null;
              playerRef.current.loadVideoById({
                videoId: pending.videoId,
                startSeconds: pending.start,
              });
              loadedVideoIdRef.current = pending.videoId;
            }
          },
        },
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const playResult = useCallback((result: SearchResult) => {
    const key = normalizeVideoKey(result.video_number);
    const directVideoId =
      typeof videoMap[String(result.video_number)] === "string"
        ? (videoMap[String(result.video_number)] as string)
        : typeof videoMap[key] === "string"
          ? (videoMap[key] as string)
          : typeof videoMap[String(result.video_number).padStart(3, "0")] === "string"
            ? (videoMap[String(result.video_number).padStart(3, "0")] as string)
            : undefined;

    const titleVideoId = (() => {
      if (!result.video_title || !titleVideoMap) return undefined;

      const exact = titleVideoMap[result.video_title];
      if (exact && !exact.startsWith("PLACEHOLDER")) return exact;

      const targetKey = normalizeTitleKey(result.video_title);
      for (const [title, id] of Object.entries(titleVideoMap)) {
        if (!id || id.startsWith("PLACEHOLDER")) continue;
        if (normalizeTitleKey(title) === targetKey) return id;
      }
      return undefined;
    })();

    const videoId = directVideoId && !directVideoId.startsWith("PLACEHOLDER")
      ? directVideoId
      : titleVideoId && !titleVideoId.startsWith("PLACEHOLDER")
        ? titleVideoId
        : undefined;

    if (!videoId) {
      setError(
        `No YouTube video_id mapped for video_number ${result.video_number} or title "${result.video_title}". Add it to src/data/video-map.json.`,
      );
      return;
    }
    setError(null);
    setSelectedId(result.id);
    setCurrentTitle(result.video_title);

    const player = playerRef.current;
    if (!player || !playerReadyRef.current) {
      pendingPlayRef.current = { videoId, start: result.start };
      return;
    }
    if (loadedVideoIdRef.current === videoId) {
      player.seekTo(result.start, true);
      player.playVideo?.();
    } else {
      player.loadVideoById({ videoId, startSeconds: result.start });
      loadedVideoIdRef.current = videoId;
    }
  }, [titleVideoMap]);

  const search = useCallback(async () => {
    const q = query.trim();
    if (!q || loading) return;
    setLoading(true);
    setSearched(true);
    setError(null);
    try {
      const apiBaseUrl = (import.meta.env.VITE_FASTAPI_URL as string | undefined) ?? "http://127.0.0.1:8000";
      const endpoint = `${apiBaseUrl.replace(/\/$/, "")}/ask`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });

      const data = (await res.json().catch(() => null)) as {
        answer?: string;
        allowed?: boolean;
        relevant_vectors?: SearchResult[];
        detail?: string;
      } | null;

      if (!res.ok) {
        throw new Error(data?.detail || `Search failed (${res.status})`);
      }

      if (data?.allowed === false) {
        setResults([]);
        setError(data.answer || "This system only supports DSA-related questions.");
        return;
      }

      setResults(data?.relevant_vectors ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [query, loading]);

  return (
    <div className="flex min-h-screen flex-col bg-background font-body text-foreground md:h-screen md:flex-row md:overflow-hidden">
      {/* Left: query panel */}
      <aside className="flex w-full flex-col border-b border-border bg-sidebar/60 md:h-screen md:w-[38%] md:border-b-0 md:border-r">
        <div className="border-b border-border px-5 pb-5 pt-6">
          <div className="mb-4 flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/15 font-mono text-xs font-medium text-primary">
              ▶
            </span>
            <h1 className="font-display text-lg font-semibold tracking-tight">
              ytscrapper
              <span className="ml-2 font-mono text-[10px] font-normal uppercase tracking-widest text-muted-foreground">
                dsa revision
              </span>
            </h1>
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              search();
            }}
          >
            <div className="relative min-w-0 flex-1">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="sliding window technique"
                className="w-full rounded-lg border border-input bg-background/80 px-3.5 py-2.5 text-sm outline-none transition-all placeholder:text-muted-foreground/60 focus:border-primary/50 focus:ring-2 focus:ring-ring/30"
              />
            </div>
            <button
              type="submit"
              disabled={loading || !query.trim()}
              className="shrink-0 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-40 disabled:hover:brightness-100"
            >
              {loading ? "…" : "Search"}
            </button>
          </form>
        </div>

        <div className="flex-1 space-y-2.5 overflow-y-auto p-4">
          {loading && (
            <div className="space-y-2.5">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="animate-pulse rounded-xl border border-border surface-raised p-3.5"
                  style={{ animationDelay: `${i * 60}ms` }}
                >
                  <div className="h-3 w-2/3 rounded bg-muted" />
                  <div className="mt-2.5 h-3 w-full rounded bg-muted" />
                  <div className="mt-2 h-3 w-1/3 rounded bg-muted" />
                </div>
              ))}
            </div>
          )}

          {!loading && error && (
            <p className="animate-result-in rounded-lg border border-destructive/30 bg-destructive/10 p-3.5 text-sm leading-relaxed text-destructive">
              {error}
            </p>
          )}

          {!loading && !error && results.length === 0 && (
            <div className="flex flex-col items-center gap-3 pt-16 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-muted/40 font-mono text-muted-foreground">
                {searched ? "∅" : "⌕"}
              </span>
              <p className="max-w-52 text-sm leading-relaxed text-muted-foreground">
                {searched
                  ? "No results found for this topic."
                  : "Search a topic to get started."}
              </p>
            </div>
          )}

          {!loading &&
            results.map((r, idx) => {
              const selected = r.id === selectedId;
              return (
                <button
                  key={r.id}
                  onClick={() => playResult(r)}
                  style={{ animationDelay: `${idx * 45}ms` }}
                  className={`group w-full animate-result-in rounded-xl border p-3.5 text-left transition-all duration-200 ${
                    selected
                      ? "border-primary/40 surface-raised glow-primary"
                      : "border-border surface-raised hover:border-primary/25 hover:bg-accent/40"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <span
                      className={`text-sm font-medium leading-snug transition-colors ${
                        selected ? "text-primary" : "text-card-foreground group-hover:text-foreground"
                      }`}
                    >
                      {r.video_title}
                    </span>
                    <span
                      className={`shrink-0 rounded-md px-2 py-0.5 font-mono text-[11px] tabular-nums transition-colors ${
                        selected
                          ? "bg-primary/15 text-primary"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {formatSeconds(r.start)}–{formatSeconds(r.end)}
                    </span>
                  </div>
                  <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
                    {r.text}
                  </p>
                  <div className="mt-2.5 flex items-center gap-1.5 font-mono text-[10px] tracking-wide text-muted-foreground/60">
                    <span>score {r.score.toFixed(2)}</span>
                    {typeof r.cosine_similarity === "number" && (
                      <>
                        <span className="text-border">·</span>
                        <span>cos {r.cosine_similarity.toFixed(2)}</span>
                      </>
                    )}
                    <span className="text-border">·</span>
                    <span>#{r.video_number}</span>
                    {selected && (
                      <span className="ml-auto text-primary">now playing</span>
                    )}
                  </div>
                </button>
              );
            })}
        </div>
      </aside>

      {/* Right: video panel */}
      <main className="flex w-full flex-1 flex-col p-5 md:h-screen md:w-[62%] md:overflow-y-auto md:p-8">
        <div className="mb-4 flex min-h-8 items-center gap-3">
          <span
            className={`h-2 w-2 shrink-0 rounded-full transition-colors ${
              currentTitle ? "bg-primary" : "bg-muted"
            }`}
          />
          {currentTitle ? (
            <h2 className="truncate font-display text-base font-semibold tracking-tight">
              {currentTitle}
            </h2>
          ) : (
            <h2 className="text-sm text-muted-foreground">
              Search and select a result to play
            </h2>
          )}
        </div>
        <div
          className={`relative aspect-video w-full overflow-hidden rounded-2xl border transition-all duration-300 ${
            currentTitle
              ? "border-primary/30 glow-primary"
              : "border-border bg-muted/20"
          }`}
        >
          {!currentTitle && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background text-muted-foreground">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-muted/40 font-mono text-lg">
                ▶
              </span>
              <span className="text-sm">No video selected</span>
            </div>
          )}
          <div id="yt-player" className="h-full w-full" />
        </div>
        <p className="mt-4 font-mono text-[11px] tracking-wide text-muted-foreground/70">
          // pick a result — the video jumps to the exact moment the topic is taught
        </p>
      </main>
    </div>
  );
}
