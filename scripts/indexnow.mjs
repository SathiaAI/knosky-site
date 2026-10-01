// IndexNow: tell Bing (and Yandex, Seznam, Naver…) about every page in the sitemap after a production deploy.
// Small site, so it sends the full sitemap each time. Failures are logged, never fatal.
// The key is public by design: it is served at https://<host>/68148975beb259c7472125aca72a0bce.txt on every host below.
const KEY = '68148975beb259c7472125aca72a0bce';
const HOSTS = [['www.knosky.com','https://www.knosky.com/sitemap.xml'],['www.knosky.wiki','https://www.knosky.wiki/sitemap.xml']]; // [host, sitemap URL]
for (const [host, sitemap] of HOSTS) {
  try {
    const xml = await (await fetch(sitemap, { headers: { 'cache-control': 'no-cache' } })).text();
    const urlList = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]).filter(u => new URL(u).host === host);
    if (!urlList.length) { console.log('indexnow:', host, 'no URLs in', sitemap); continue; }
    const r = await fetch('https://api.indexnow.org/indexnow', { method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host, key: KEY, keyLocation: `https://${host}/${KEY}.txt`, urlList }) });
    console.log('indexnow:', host, r.status, urlList.length, 'url(s)');
    if (r.status >= 400) console.log(await r.text());
  } catch (e) { console.log('indexnow:', host, 'request failed (non-fatal):', e.message); }
}
