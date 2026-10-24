"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type shakaNs from "shaka-player/dist/shaka-player.compiled.js";
import { authHeaders, f1tv, F1TVRequestError, type F1TVPlayback } from "@/lib/f1tv";

type Shaka = typeof shakaNs;
type ShakaPlayer = InstanceType<Shaka["Player"]>;

export interface StreamOptions {
  /** Send the licence request through our backend (adds the user's token) instead of straight to F1. */
  licenceViaServer: boolean;
  /** Fetch the manifest and segments through our backend, for when the CDN refuses this page. */
  relay: boolean;
}

export interface StreamDebug {
  playback: Omit<F1TVPlayback, "raw"> | null;
  playbackRaw: unknown;
  licence: { attempts: number; ok: number; lastStatus: number | null; via: "server" | "direct" | null };
  keySystem: string | null;
  videoRobustness: string | null;
  active: { width: number; height: number; frameRate: number | null; bandwidth: number } | null;
  availableHeights: number[];
  droppedFrames: number;
  decodedFrames: number;
  estimatedBandwidth: number;
  error: { message: string; code?: number; data?: unknown } | null;
}

const EMPTY_DEBUG: StreamDebug = {
  playback: null,
  playbackRaw: null,
  licence: { attempts: 0, ok: 0, lastStatus: null, via: null },
  keySystem: null,
  videoRobustness: null,
  active: null,
  availableHeights: [],
  droppedFrames: 0,
  decodedFrames: 0,
  estimatedBandwidth: 0,
  error: null,
};

let shakaPromise: Promise<Shaka> | null = null;
function loadShaka(): Promise<Shaka> {
  if (!shakaPromise) {
    shakaPromise = import("shaka-player/dist/shaka-player.compiled.js").then((m) => {
      const shaka = (m.default ?? m) as Shaka;
      shaka.polyfill.installAll();
      return shaka;
    });
  }
  return shakaPromise;
}

function relayUrl(pid: string, uri: string): string {
  if (uri.includes("/api/f1tv/relay/")) return uri;
  const u = new URL(uri);
  return `${window.location.origin}/api/f1tv/relay/${pid}/${u.host}${u.pathname}${u.search}`;
}

/** Plays one F1 TV feed (main broadcast or an onboard) into a <video>. */
export function useF1TVStream(videoRef: React.RefObject<HTMLVideoElement | null>) {
  const playerRef = useRef<ShakaPlayer | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [debug, setDebug] = useState<StreamDebug>(EMPTY_DEBUG);
  const loadIdRef = useRef(0);

  const unload = useCallback(async () => {
    loadIdRef.current++;
    const player = playerRef.current;
    playerRef.current = null;
    if (player) await player.destroy().catch(() => {});
    setState("idle");
  }, []);

  useEffect(() => () => { void unload(); }, [unload]);

  const load = useCallback(
    async (content: string, channelId: string | null, opts: StreamOptions) => {
      const video = videoRef.current;
      if (!video) return;
      await unload();
      const loadId = ++loadIdRef.current;
      setState("loading");
      setDebug({ ...EMPTY_DEBUG, licence: { ...EMPTY_DEBUG.licence, via: opts.licenceViaServer ? "server" : "direct" } });

      const fail = (message: string, code?: number, data?: unknown) => {
        if (loadId !== loadIdRef.current) return;
        setState("error");
        setDebug((d) => ({ ...d, error: { message, code, data } }));
      };

      let pb: F1TVPlayback;
      try {
        pb = await f1tv.play(content, channelId);
      } catch (e) {
        const err = e as F1TVRequestError;
        return fail(err.message, err.status, err.body);
      }
      if (loadId !== loadIdRef.current) return;
      const { raw, ...playback } = pb;
      setDebug((d) => ({ ...d, playback, playbackRaw: raw }));

      const shaka = await loadShaka();
      if (!shaka.Player.isBrowserSupported()) return fail("This browser can't play protected video");

      const player = new shaka.Player();
      playerRef.current = player;
      await player.attach(video);

      const licenceUrl = opts.licenceViaServer
        ? `${window.location.origin}/api/f1tv/license/${pb.playback_id}`
        : pb.license_url;
      if (licenceUrl) {
        player.configure({ drm: { servers: { "com.widevine.alpha": licenceUrl } } });
      }

      const RT = shaka.net.NetworkingEngine.RequestType;
      const net = player.getNetworkingEngine()!;
      net.registerRequestFilter((type, request) => {
        if (type === RT.LICENSE) {
          if (opts.licenceViaServer) Object.assign(request.headers, authHeaders());
          setDebug((d) => ({ ...d, licence: { ...d.licence, attempts: d.licence.attempts + 1 } }));
        }
        if (opts.relay && (type === RT.MANIFEST || type === RT.SEGMENT)) {
          request.uris = request.uris.map((u) => relayUrl(pb.playback_id, u));
          Object.assign(request.headers, authHeaders());
        }
      });
      net.registerResponseFilter((type, response) => {
        if (type === RT.LICENSE) {
          setDebug((d) => ({ ...d, licence: { ...d.licence, ok: d.licence.ok + 1, lastStatus: response.status ?? 200 } }));
        }
      });

      player.addEventListener("error", (event) => {
        const detail = (event as unknown as { detail: shakaNs.util.Error }).detail;
        if (detail?.code === shaka.util.Error.Code.LICENSE_REQUEST_FAILED) {
          const status = (detail.data?.[0] as { data?: unknown[] } | undefined)?.data?.[1];
          setDebug((d) => ({ ...d, licence: { ...d.licence, lastStatus: typeof status === "number" ? status : null } }));
        }
        fail(`Player error ${detail?.code}`, detail?.code, detail?.data);
      });

      try {
        await player.load(opts.relay ? relayUrl(pb.playback_id, pb.manifest_url) : pb.manifest_url);
      } catch (e) {
        const err = e as shakaNs.util.Error;
        return fail(`Couldn't load the stream (Shaka error ${err.code})`, err.code, err.data);
      }
      if (loadId !== loadIdRef.current) return;
      const drm = player.drmInfo();
      setDebug((d) => ({ ...d, keySystem: drm?.keySystem ?? null, videoRobustness: drm?.videoRobustness || null }));
      setState("ready");
    },
    [videoRef, unload],
  );

  // Poll quality stats for the debug panel.
  useEffect(() => {
    if (state !== "ready") return;
    const id = setInterval(() => {
      const player = playerRef.current;
      if (!player) return;
      const stats = player.getStats();
      const tracks = player.getVideoTracks();
      const active = tracks.find((t) => t.active);
      setDebug((d) => ({
        ...d,
        active: active
          ? { width: active.width ?? stats.width, height: active.height ?? stats.height, frameRate: active.frameRate, bandwidth: active.bandwidth }
          : null,
        availableHeights: Array.from(new Set(tracks.map((t) => t.height ?? 0).filter(Boolean))).sort((a, b) => b - a),
        droppedFrames: stats.droppedFrames,
        decodedFrames: stats.decodedFrames,
        estimatedBandwidth: stats.estimatedBandwidth,
      }));
    }, 2000);
    return () => clearInterval(id);
  }, [state]);

  return { state, debug, load, unload };
}
