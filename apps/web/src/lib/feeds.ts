// Open-core stub for apps/web/src/lib/feeds.ts.
//
// The cloud build serves /blog/rss.xml and /sitemap.xml from the marketing
// blog, which webExclude removes here: a self-hosted install has no blog, and
// a sitemap of leenar.net URLs served from someone else's domain would be
// worse than none. The shared edge worker still calls this, so it stays a real
// module — it just never claims a path.
export function feedResponse(_path: string): Response | null {
  return null;
}
