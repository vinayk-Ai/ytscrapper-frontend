# DSA Video Jump

You are building a single-page web UI for ytscrapper, a RAG-based tool that lets a user search a DSA topic and jump straight to the exact YouTube video and timestamp where it was taught.

Layout

Two-column split-screen, single page, no routing needed.

Left column (~35–40% width): query panel

Right column (~60–65% width): video player panel

On mobile, stack vertically (query panel on top).

Left column — Query panel

Search input box (placeholder: e.g. "sliding window technique") + a "Search" button; also submit on Enter

Below it, render the results list from relevant_vectors (backend guarantees at least 5 items). For each result, show:

video_title

text (the matched transcript chunk)

Formatted timestamp range: start–end, converted from seconds to mm:ss

score and/or cosine_similarity, shown small/muted

Make the whole card clickable

Loading state while the search request is in flight

Empty state when there are no results yet ("Search a topic to get started") and when a search returns nothing

Right column — Video panel

Embed the YouTube IFrame Player API

Default/placeholder state: "Search and select a result to play"

On clicking a result in the left column: load that video and seek to start (in seconds) — use player.loadVideoById({ videoId, startSeconds }) if no video is loaded yet, or player.seekTo(startSeconds, true) if the same video is already loaded

Show the currently playing video's title above the player

Visually highlight the currently-selected result in the left list

Backend response shape

POST /search with body { "query": string } returns:

{
  "relevant_vectors": [
    {
      "id": "chunk_042",
      "score": 0.87,
      "cosine_similarity": 0.91,
      "video_number": 65,
      "video_title": "Two Pointers Technique - DSA",
      "start": 142,
      "end": 178,
      "text": "...the transcript text around this point..."
    }
  ]
}


start and end are always integer seconds — never parse a string for them.

Unresolved dependency — handle before building the player

The backend identifies videos by video_number, not a YouTube video_id, and the player needs a real video_id to embed. Resolve this one of two ways:

Backend adds a video_id field to each item in relevant_vectors, or

Frontend loads a local video_number → video_id JSON mapping (matching the 127-video playlist order) and resolves the ID client-side before calling the player API.

Pick one explicitly — don't assume video_number is directly usable as a YouTube ID.

Technical requirements

Plain HTML/CSS/JS (or React if the project already uses it) — self-contained, single page

No backend framework assumptions beyond the POST /search endpoint above

Clean, minimal styling — this is a personal DSA revision tool, not a public product

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/78c707c3-0404-4301-be54-75e039d68131).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
