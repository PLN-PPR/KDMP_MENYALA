// Supabase Edge Function: resolve-gmap
// Deploy with:
//   supabase functions deploy resolve-gmap
//
// Purpose: follow Google Maps short-link redirects server-side, then extract
// coordinates from the final URL (or page body as a fallback).

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function extractCoords(value: string) {
  let x = value || "";
  try { x = decodeURIComponent(x); } catch (_) {}

  const patterns = [
    /@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/,
    /[?&](?:query|q|ll|center|destination)=(-?\d{1,3}\.\d+),\s*(-?\d{1,3}\.\d+)/i,
    /!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/i,
    /\/(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)(?:[/?#]|$)/,
    /"latitude"\s*:\s*(-?\d{1,3}\.\d+).{0,100}?"longitude"\s*:\s*(-?\d{1,3}\.\d+)/is,
    /"lat"\s*:\s*(-?\d{1,3}\.\d+).{0,100}?"lng"\s*:\s*(-?\d{1,3}\.\d+)/is,
  ];

  for (const p of patterns) {
    const m = x.match(p);
    if (!m) continue;
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng) &&
        Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return { lat: String(m[1]), lng: String(m[2]) };
    }
  }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { url } = await req.json();
    if (!url || typeof url !== "string") {
      return new Response(JSON.stringify({ error: "url wajib diisi" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const allowed =
      host === "maps.app.goo.gl" ||
      host === "goo.gl" ||
      host.includes("google.") ||
      host === "maps.google.com";

    if (!allowed) {
      return new Response(JSON.stringify({ error: "Host bukan Google Maps" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const direct = extractCoords(url);
    if (direct) {
      return new Response(JSON.stringify({ ...direct, finalUrl: url, method: "direct" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const resp = await fetch(url, {
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; KDMP-MENYALA/1.0)",
        "Accept": "text/html,application/xhtml+xml",
      }
    });

    const finalUrl = resp.url || url;
    let coords = extractCoords(finalUrl);

    if (!coords) {
      const html = await resp.text();
      coords = extractCoords(html);
    }

    if (!coords) {
      return new Response(JSON.stringify({
        error: "Koordinat tidak ditemukan setelah redirect",
        finalUrl
      }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({
      ...coords,
      finalUrl,
      method: "redirect"
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
