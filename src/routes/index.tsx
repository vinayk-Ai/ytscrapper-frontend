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
const videoMap = videoMapJson as Record<string, string>;

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
    const videoId = videoMap[String(result.video_number)];
    if (!videoId || videoId.startsWith("PLACEHOLDER")) {
      setError(
        `No YouTube video_id mapped for video_number ${result.video_number}. Add it to src/data/video-map.json.`,
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
  }, []);

  const search = useCallback(async () => {
    const q = query.trim();
    if (!q || loading) return;
    setLoading(true);
    setSearched(true);
    setError(null);
    try {
      const res = await fetch("/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q }),
      });
      if (!res.ok) throw new Error(`Search failed (${res.status})`);
      const data = (await res.json()) as { relevant_vectors: SearchResult[] };
      setResults(data.relevant_vectors ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [query, loading]);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground md:h-screen md:flex-row md:overflow-hidden">
      {/* Left: query panel */}
      <aside className="flex w-full flex-col border-b border-border md:h-screen md:w-[38%] md:border-b-0 md:border-r">
        <div className="border-b border-border p-4">
          <h1 className="mb-3 text-lg font-semibold tracking-tight">ytscrapper</h1>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              search();
            }}
          >
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="sliding window technique"
              className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
            />
            <button
              type="submit"
              disabled={loading || !query.trim()}
              className="shrink-0 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {loading ? "…" : "Search"}
            </button>
          </form>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto p-4">
          {loading && (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="animate-pulse rounded-lg border border-border bg-muted/50 p-3"
                >
                  <div className="h-3 w-2/3 rounded bg-muted" />
                  <div className="mt-2 h-3 w-full rounded bg-muted" />
                  <div className="mt-2 h-3 w-1/3 rounded bg-muted" />
                </div>
              ))}
            </div>
          )}

          {!loading && error && (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </p>
          )}

          {!loading && !error && results.length === 0 && (
            <p className="pt-10 text-center text-sm text-muted-foreground">
              {searched ? "No results found for this topic." : "Search a topic to get started."}
            </p>
          )}

          {!loading &&
            results.map((r) => {
              const selected = r.id === selectedId;
              return (
                <button
                  key={r.id}
                  onClick={() => playResult(r)}
                  className={`w-full rounded-lg border p-3 text-left transition-colors ${
                    selected
                      ? "border-primary bg-accent ring-1 ring-primary"
                      : "border-border bg-card hover:bg-accent/60"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium leading-snug">{r.video_title}</span>
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                      {formatSeconds(r.start)}–{formatSeconds(r.end)}
                    </span>
                  </div>
                  <p className="mt-1.5 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
                    {r.text}
                  </p>
                  <div className="mt-1.5 text-[11px] text-muted-foreground/70">
                    score {r.score.toFixed(2)}
                    {typeof r.cosine_similarity === "number" &&
                      ` · cos ${r.cosine_similarity.toFixed(2)}`}
                    {` · video #${r.video_number}`}
                  </div>
                </button>
              );
            })}
        </div>
      </aside>

      {/* Right: video panel */}
      <main className="flex w-full flex-1 flex-col p-4 md:h-screen md:w-[62%] md:overflow-y-auto">
        <div className="mb-3 flex min-h-7 items-center">
          {currentTitle ? (
            <h2 className="truncate text-base font-medium">{currentTitle}</h2>
          ) : (
            <h2 className="text-sm text-muted-foreground">
              Search and select a result to play
            </h2>
          )}
        </div>
        <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-border bg-muted/30">
          {!currentTitle && (
            <div className="absolute inset-0 z-10 flex items-center justify-center text-sm text-muted-foreground">
              No video selected
            </div>
          )}
          <div id="yt-player" className="h-full w-full" />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Pick a result on the left — the video jumps straight to the moment the topic is taught.
        </p>
      </main>
    </div>
  );
}
