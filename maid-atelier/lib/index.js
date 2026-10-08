import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
//#region src/index.ts
/**
* Host half of the maid-atelier skin.
*
* The skin's character artwork lives on disk, not inside the browser bundle. A
* browser cannot read the filesystem, so the settings panel and the character
* stage need a host-side directory listing and a way to fetch the bytes; this
* half owns both.
*
* ## Why the artwork is no longer embedded
*
* Embedding the sprites as base64 was what made an outfit a *source* concept:
* `LeftArtworkVariant` was a closed union, `LEFT_ARTWORK_SETS` a hand-written
* table, and the sprite data a generated module. Adding a set therefore meant
* regenerating that module, editing the union **and** the table, and rebuilding
* — a refactor, not an asset drop.
*
* Scanning the tree instead makes the *folder name* the outfit id and the *file
* name* the work state, so a new folder shows up in the settings panel on the
* next open with no rebuild and no source change. The price is that the artwork
* is no longer carried by the bundle: it ships in `files` and is fetched over
* HTTP from the same loopback server the GUI already runs on.
*
* ## Route ownership
*
* `exact` routes, and `prefix` routes longer than another, win over the host's
* `/api` origin fence — matching is exact first, then longest prefix. These
* routes are therefore reached without that fence, which is the intended shape:
* an `<img src>` cannot carry a request header, so an authenticated route would
* be unusable for artwork anyway. What keeps that safe is that they are
* read-only, take no request body and no query input, and confine every resolved
* path to the artwork root before touching the disk (see `resolveArtwork`).
*
* @module @wjingshan/dsh-client-ui-skin-maid-atelier
*/
/** Package root, resolved from the built `lib/index.js`. */
const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));
/** Artwork root; every servable image lives under here. */
const ARTWORK_ROOT = resolve(PACKAGE_ROOT, "assets");
/** Directories under the artwork root that hold character art. */
const CHARACTER_GROUPS = ["maid-left", "maid-right"];
/**
* Work states a set may supply.
*
* This vocabulary is deliberately *not* discoverable from the filesystem: it is
* the session-state contract the skin drives from the host's own DOM signals,
* so a new state is a behaviour change rather than an asset drop. A new
* *outfit*, by contrast, needs nothing but a folder.
*/
const WORK_STATES = [
	"idle",
	"think",
	"tool",
	"write",
	"error"
];
/** Image extensions the art route will serve. */
const SERVABLE = /* @__PURE__ */ new Set([
	".webp",
	".png",
	".jpg",
	".jpeg",
	".avif"
]);
/**
* URL prefix of an artwork request, trailing slash included because it is a path
* prefix. Route registration uses {@link ART_ROUTE_SEAT} instead.
*/
const ART_ROUTE = "/maid-atelier/art/";
/**
* The route seat claimed on the web server.
*
* Deliberately the same string minus the trailing slash. A registered prefix is
* matched as a bare path prefix, and the shipped prefix route (`/plugins`) carries
* no trailing slash either. Registering `/maid-atelier/art/` produced a route that
* never matched a real request: every image fell through to the server's own 404
* while the listing registered right next to it answered 200.
*/
const ART_ROUTE_SEAT = "/maid-atelier/art";
/** Route serving the directory listing the client renders its entries from. */
const MANIFEST_ROUTE = "/maid-atelier/outfits.json";
/** POSIX-normalised path relative to the artwork root. */
function toArtworkPath(absolute) {
	return absolute.slice(ARTWORK_ROOT.length + 1).split(sep).join("/");
}
/**
* Read the work state a file name encodes, or `undefined`.
*
* The committed names are verbose (`maid-atelier-maid-left-swim-idle-v1.webp`),
* but a plain `idle.webp` is accepted too, so a new outfit can be dropped in
* with either convention. Matching is on whole `-`-delimited tokens, so a name
* merely *containing* a state word cannot be misread.
* @param fileName - the file's base name.
* @returns the matching work state, or undefined when the name encodes none.
*/
function stateOf(fileName) {
	const stem = fileName.slice(0, fileName.length - extname(fileName).length).toLowerCase();
	const tokens = new Set(stem.split(/[-_. ]+/).filter((token) => token.length > 0));
	return WORK_STATES.find((state) => tokens.has(state));
}
/**
* Walk the artwork tree once, deriving both the flat file list and the outfits.
*
* Only the two character groups are walked; decoration and icons stay in the
* bundle as before. A folder is an outfit when it directly contains at least one
* state-named image, which is what keeps `maid-left/maid/` — the identity
* reference, which has no work states — out of the settings panel.
* @returns the manifest, or one with no entries when the artwork is absent.
*/
async function scanArtwork() {
	const outfits = [];
	const files = [];
	for (const group of CHARACTER_GROUPS) {
		const groupDir = join(ARTWORK_ROOT, group);
		if (!existsSync(groupDir)) continue;
		for (const dirent of await readdir(groupDir, { withFileTypes: true })) {
			if (dirent.isDirectory()) {
				const outfitDir = join(groupDir, dirent.name);
				const states = {};
				for (const file of await readdir(outfitDir)) {
					if (!SERVABLE.has(extname(file).toLowerCase())) continue;
					const relative = toArtworkPath(join(outfitDir, file));
					const state = stateOf(file);
					files.push(state === void 0 ? { path: relative } : {
						path: relative,
						state
					});
					if (state !== void 0 && states[state] === void 0) states[state] = relative;
				}
				if (Object.keys(states).length > 0) outfits.push({
					id: dirent.name,
					states
				});
				continue;
			}
			if (!dirent.isFile() || !SERVABLE.has(extname(dirent.name).toLowerCase())) continue;
			const relative = toArtworkPath(join(groupDir, dirent.name));
			const state = stateOf(dirent.name);
			files.push(state === void 0 ? { path: relative } : {
				path: relative,
				state
			});
		}
	}
	outfits.sort((left, right) => left.id.localeCompare(right.id));
	files.sort((left, right) => left.path.localeCompare(right.path));
	return {
		schema: 1,
		outfits,
		files
	};
}
/**
* Map a URL path back to a file inside the artwork root.
*
* The trailing path is the only untrusted input on these routes, so this is the
* one place that has to be exact: percent-decode once, resolve against the root,
* and refuse anything that escapes it — `..`, an absolute path, a NUL byte, a
* non-image extension — rather than read it. Containment is a prefix test on the
* *resolved* path, compared with its separator, or a sibling directory sharing
* the root's name would pass.
* @param requestUrl - the raw request URL, including any query string.
* @returns the absolute path when it is servable, otherwise undefined.
*/
function resolveArtwork(requestUrl) {
	if (requestUrl === void 0) return void 0;
	const pathname = requestUrl.split("?")[0]?.split("#")[0] ?? "";
	if (!pathname.startsWith("/maid-atelier/art/")) return void 0;
	let decoded;
	try {
		decoded = decodeURIComponent(pathname.slice(18));
	} catch {
		return;
	}
	if (decoded.length === 0 || decoded.includes("\0")) return void 0;
	if (!SERVABLE.has(extname(decoded).toLowerCase())) return void 0;
	const candidate = resolve(ARTWORK_ROOT, decoded);
	if (candidate !== ARTWORK_ROOT && !candidate.startsWith(ARTWORK_ROOT + sep)) return void 0;
	return candidate;
}
/**
* Content type for a servable extension.
* @param file - absolute path of an already-vetted artwork file.
* @returns the media type to answer with.
*/
function contentTypeOf(file) {
	switch (extname(file).toLowerCase()) {
		case ".png": return "image/png";
		case ".jpg":
		case ".jpeg": return "image/jpeg";
		case ".avif": return "image/avif";
		default: return "image/webp";
	}
}
/** Mount the artwork listing and the art route when the web server is ready. */
function mountArtwork(ctx) {
	ctx.inject(["webServer"], ({ webServer }) => {
		ctx.effect(() => {
			const disposers = [webServer.register({
				kind: "exact",
				path: MANIFEST_ROUTE,
				handler: async (request, response) => {
					if (request.method !== "GET" && request.method !== "HEAD") {
						response.writeHead(405, { allow: "GET, HEAD" });
						response.end();
						return;
					}
					const body = JSON.stringify(await scanArtwork());
					response.writeHead(200, {
						"content-type": "application/json; charset=utf-8",
						"cache-control": "no-store",
						"content-length": String(Buffer.byteLength(body))
					});
					response.end(request.method === "HEAD" ? void 0 : body);
				}
			}), webServer.register({
				kind: "prefix",
				path: ART_ROUTE_SEAT,
				handler: async (request, response) => {
					if (request.method !== "GET" && request.method !== "HEAD") {
						response.writeHead(405, { allow: "GET, HEAD" });
						response.end();
						return;
					}
					const file = resolveArtwork(request.url);
					if (file === void 0 || !existsSync(file)) {
						response.writeHead(404, { "cache-control": "no-store" });
						response.end();
						return;
					}
					const bytes = await readFile(file);
					response.writeHead(200, {
						"content-type": contentTypeOf(file),
						"cache-control": "public, max-age=31536000, immutable",
						"content-length": String(bytes.byteLength)
					});
					response.end(request.method === "HEAD" ? void 0 : bytes);
				}
			})];
			return () => {
				for (const dispose of disposers) dispose();
			};
		}, "maid-atelier: artwork routes");
	});
}
/** Host loader entry for the maid-atelier skin. */
function apply(ctx) {
	mountArtwork(ctx);
}
//#endregion
export { ART_ROUTE, ART_ROUTE_SEAT, MANIFEST_ROUTE, apply, resolveArtwork, scanArtwork, stateOf };
