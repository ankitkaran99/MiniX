(function (global) {
	"use strict";

	// ─── Utilities ────────────────────────────────────────────────────────────────

	function isPlainObject(value) {
		return value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
	}

	function isPromise(value) {
		return value != null && typeof value.then === "function";
	}

	function scheduleMicrotask(callback) {
		if (typeof queueMicrotask === "function") {
			queueMicrotask(callback);
			return;
		}
		Promise.resolve().then(callback);
	}

	function escapeRegex(str) {
		return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	}

	function setOwn(target, key, value) {
		Object.defineProperty(target, key, {
			value,
			writable: true,
			enumerable: true,
			configurable: true
		});
	}

	function copyOwnObject(value) {
		const out = {};
		if (!value || typeof value !== "object") return out;
		for (const key of Object.keys(value)) setOwn(out, key, value[key]);
		return out;
	}

	function stripTrailingSlash(path) {
		if (!path || path.length <= 1) return "/";
		return path.replace(/\/+$/, "") || "/";
	}

	function normalizePath(path) {
		if (path == null || path === "") return "/";
		let out = String(path).trim();
		if (!out.startsWith("/")) out = "/" + out;
		out = out.replace(/\/{2,}/g, "/");
		return stripTrailingSlash(out);
	}

	function stripHistoryBase(path, base) {
		const normalizedPath = normalizePath(path || "/");
		const normalizedBase = stripTrailingSlash(normalizePath(base || "/"));
		if (normalizedBase === "/") return normalizedPath;
		if (normalizedPath === normalizedBase) return "/";
		if (normalizedPath.startsWith(normalizedBase + "/")) return normalizePath(normalizedPath.slice(normalizedBase.length) || "/");
		return normalizedPath;
	}

	function joinPaths(parent, child) {
		const a = normalizePath(parent || "/");
		const b = String(child == null ? "" : child).trim();
		if (!b) return a;
		if (b.startsWith("/")) return normalizePath(b);
		if (a === "/") return normalizePath("/" + b);
		return normalizePath(a + "/" + b);
	}

	function parseQuery(search) {
		const out = {};
		const raw = String(search || "").replace(/^\?/, "");
		if (!raw) return out;
		for (const [key, value] of new URLSearchParams(raw).entries()) {
			if (Object.prototype.hasOwnProperty.call(out, key)) {
				if (Array.isArray(out[key])) out[key].push(value);
				else setOwn(out, key, [out[key], value]);
			} else {
				setOwn(out, key, value);
			}
		}
		return out;
	}

	function stringifyQuery(query) {
		if (!query || typeof query !== "object") return "";
		const params = new URLSearchParams();
		for (const key of Object.keys(query)) {
			const value = query[key];
			if (value == null) continue;
			if (Array.isArray(value)) {
				for (const item of value) {
					if (item != null) params.append(key, String(item));
				}
			} else {
				params.set(key, String(value));
			}
		}
		const built = params.toString();
		return built ? "?" + built : "";
	}

	function normalizeHash(hash) {
		if (!hash) return "";
		const value = String(hash).trim();
		if (!value) return "";
		return value.startsWith("#") ? value : "#" + value;
	}

	function mergeMeta(matched) {
		const out = {};
		for (const record of matched || []) {
			if (record && isPlainObject(record.meta)) {
				for (const key of Object.keys(record.meta)) setOwn(out, key, record.meta[key]);
			}
		}
		return out;
	}

	function cloneRoute(route) {
		return {
			fullPath: route.fullPath,
			path: route.path,
			name: route.name || null,
			params: copyOwnObject(route.params),
			query: copyOwnObject(route.query),
			hash: route.hash || "",
			meta: copyOwnObject(route.meta),
			matched: Array.isArray(route.matched) ? route.matched.slice() : [],
			redirectedFrom: route.redirectedFrom || null
		};
	}

	function buildLocationFromUrlish(raw, baseHref) {
		const value =
		raw == null || raw === false || raw === ""
		? "/"
		: String(raw).trim() || "/";
		const base = baseHref || (global.location && global.location.href) || "http://localhost/";
		const url = new URL(value, base);
		return {
			path: normalizePath(url.pathname),
			query: parseQuery(url.search),
			hash: url.hash || ""
		};
	}

	// ─── Route Pattern Compilation ────────────────────────────────────────────────

	function compileRoutePattern(fullPath) {
		const normalized = normalizePath(fullPath);
		const keys = [];

		if (normalized === "/") {
			return { path: "/", keys, exactRegex: /^\/$/, prefixRegex: /^\// };
		}

		const segments = normalized.split("/").filter(Boolean);
		const parts = segments.map((segment, index) => {
			if (segment.startsWith(":")) {
				const catchAllMatch = segment.match(/^:([^()]+)\(\.\*\)$/);
				const optional = !catchAllMatch && segment.endsWith("?");
				const name = catchAllMatch ? catchAllMatch[1] : segment.slice(1).replace(/\?$/, "").replace(/\*$/, "");
				const catchAll = Boolean(catchAllMatch) ||
					(index === segments.length - 1 && (segment.endsWith("*") || name === "anything" || name === "pathMatch" || name === "catchAll"));
				keys.push({ name, optional, catchAll, zeroOrMore: Boolean(catchAllMatch) });
				if (catchAllMatch) return "(?:/(.*))?";
				if (catchAll) return "/(.+)";
				return optional ? "(?:/([^/]+))?" : "/([^/]+)";
			}
			if (segment === "*") {
				keys.push({ name: "pathMatch", optional: false, catchAll: true, zeroOrMore: false });
				return "/(.+)";
			}
			return "/" + escapeRegex(segment);
		});

		const joined = parts.join("");
		return {
			path: normalized,
			keys,
			exactRegex: new RegExp("^" + joined + "$"),
 prefixRegex: new RegExp("^" + joined + "(?:/|$)")
		};
	}

	function extractParams(record, path) {
		const match = record.exactRegex.exec(path);
		if (!match) return {};
		const params = {};
		let groupIndex = 1;
		for (const key of record.keys) {
			const value = match[groupIndex++];
			if (value == null && key.catchAll) {
				setOwn(params, key.name, "");
			} else if (value != null) {
				try {
					setOwn(params, key.name, decodeURIComponent(value));
				} catch (_) {
					setOwn(params, key.name, value);
				}
			}
		}
		return params;
	}

	// Memoized rank per record
	const _rankCache = new WeakMap();
	function getRouteRank(record) {
		if (_rankCache.has(record)) return _rankCache.get(record);
		const segments = record.fullPath.split("/").filter(Boolean);
		let staticCount = 0, dynamicCount = 0, catchAllCount = 0, optionalCount = 0;
		let keyIndex = 0;
		for (const segment of segments) {
			if (segment.startsWith(":")) {
				const key = record.keys[keyIndex++] || {};
				dynamicCount++;
				if (key.catchAll) catchAllCount++;
				if (key.optional) optionalCount++;
			} else if (segment === "*") {
				catchAllCount++;
			} else {
				staticCount++;
			}
		}
		const rank = { depth: record.depth, staticCount, dynamicCount, catchAllCount, optionalCount, length: record.fullPath.length };
		_rankCache.set(record, rank);
		return rank;
	}

	// ─── History Implementations ──────────────────────────────────────────────────

	function createWebHistory(base) {
		base = stripTrailingSlash(normalizePath(base || "/"));
		return {
			mode: "history",
			base,
			getCurrentLocation() {
				const location = global.location || {};
				let path = location.pathname || "/";
				return {
					path: stripHistoryBase(path, base),
					query: parseQuery(location.search),
					hash: location.hash || ""
				};
			},
			href(to) {
				const path = normalizePath(to.path || "/");
				return (base === "/" ? "" : base) + path + stringifyQuery(to.query) + normalizeHash(to.hash);
			},
			push(to) {
				const location = global.location || {};
				if (location.protocol === "file:") {
					global.location.hash = normalizePath(to.path || "/") + stringifyQuery(to.query) + normalizeHash(to.hash);
					return;
				}
				if (global.history && typeof global.history.pushState === "function") {
					global.history.pushState({}, "", this.href(to));
				}
			},
			replace(to) {
				const location = global.location || {};
				if (location.protocol === "file:") {
					const nextHash = normalizePath(to.path || "/") + stringifyQuery(to.query) + normalizeHash(to.hash);
					if (global.history && typeof global.history.replaceState === "function") {
						global.history.replaceState({}, "", (location.pathname || "/") + (location.search || "") + "#" + nextHash);
					} else {
						global.location.hash = nextHash;
					}
					return;
				}
				if (global.history && typeof global.history.replaceState === "function") {
					global.history.replaceState({}, "", this.href(to));
				}
			},
			listen(callback) {
				const handler = () => callback(this.getCurrentLocation());
				if (typeof global.addEventListener !== "function") return () => {};
				global.addEventListener("popstate", handler);
				return () => {
					if (typeof global.removeEventListener === "function") global.removeEventListener("popstate", handler);
				};
			}
		};
	}

	function createWebHashHistory(base) {
		base = stripTrailingSlash(normalizePath(base || "/"));
		return {
			mode: "hash",
			base,
			getCurrentLocation() {
				const location = global.location || {};
				const raw = String(location.hash || "").replace(/^#/, "") || "/";
				const url = new URL(raw.startsWith("/") ? raw : "/" + raw, "http://localhost/");
				let path = url.pathname || "/";
				return {
					path: stripHistoryBase(path, base),
					query: parseQuery(url.search),
					hash: url.hash || ""
				};
			},
			href(to) {
				const path = normalizePath(to.path || "/");
				return "#" + (base === "/" ? "" : base) + path + stringifyQuery(to.query) + normalizeHash(to.hash);
			},
			push(to) {
				if (global.location) global.location.hash = this.href(to).slice(1);
			},
			replace(to) {
				if (global.history && typeof global.history.replaceState === "function") {
					global.history.replaceState({}, "", this.href(to));
				} else if (global.location) {
					global.location.hash = this.href(to).slice(1);
				}
			},
			listen(callback) {
				const handler = () => callback(this.getCurrentLocation());
				if (typeof global.addEventListener !== "function") return () => {};
				global.addEventListener("hashchange", handler);
				return () => {
					if (typeof global.removeEventListener === "function") global.removeEventListener("hashchange", handler);
				};
			}
		};
	}

	// ─── MiniX_Loader (embedded) ──────────────────────────────────────────────────

	class MiniX_Loader {
		constructor(baseDir, options = {}) {
			this.baseDir = baseDir.replace(/\/+$/, '') + '/';
			this.ext = options.ext || '.js';
			this.retries = options.retries ?? 2;
			this.retryDelay = options.retryDelay ?? 300;
			this.timeout = options.timeout ?? 10000;
			this._cache = new Map();
			this._pending = new Map();
		}

		load(name) {
			if (this._cache.has(name)) return this._cache.get(name);
			if (this._pending.has(name)) return this._pending.get(name);

			const promise = this._loadWithRetry(name).then(
				(res) => {
					const settled = Promise.resolve(res);
					this._cache.set(name, settled);
					this._pending.delete(name);
					return res;
				},
				(err) => {
					this._pending.delete(name);
					return Promise.reject(err);
				}
			);
			this._pending.set(name, promise);
			return promise;
		}

		async _loadWithRetry(name) {
			const url = this.baseDir + name + this.ext;
			let lastError;
			for (let i = 0; i <= this.retries; i++) {
				try {
					return await this._loadOne(url, name);
				} catch (err) {
					lastError = err;
					if (i < this.retries) {
						await this._delay(this.retryDelay * Math.pow(2, i));
					}
				}
			}
			throw lastError;
		}

		_loadOne(url, name) {
			return new Promise((resolve, reject) => {
				const doc = global.document;
				const script = doc.createElement('script');
				script.src = url;
				script.async = true;
				let done = false;

				const cleanup = () => {
					clearTimeout(timer);
					script.onload = script.onerror = null;
					if (script.parentNode) script.parentNode.removeChild(script);
				};

				const timer = setTimeout(() => {
					if (done) return;
					done = true;
					cleanup();
					reject(new Error(`Timeout: ${url}`));
				}, this.timeout);

				script.onload = () => {
					if (done) return;
					done = true;
					cleanup();
					const comp = this._resolveComponent(name);
					if (comp) {
						resolve(comp);
					} else {
						resolve(name);
					}
				};

				script.onerror = () => {
					if (done) return;
					done = true;
					cleanup();
					reject(new Error(`Load failed: ${url}`));
				};

				doc.head.appendChild(script);
			});
		}

		_resolveComponent(name) {
			const MiniX_Component = global.MiniX_Component;
			return (MiniX_Component && typeof MiniX_Component.resolve === "function")
			? MiniX_Component.resolve(name)
			: null;
		}

		_delay(ms) { return new Promise(r => setTimeout(r, ms)); }

		preload(name) {
			const doc = global.document;
			const link = doc.createElement('link');
			link.rel = 'preload';
			link.as = 'script';
			link.href = this.baseDir + name + this.ext;
			doc.head.appendChild(link);
			setTimeout(() => { if (link.parentNode) link.parentNode.removeChild(link); }, 5000);
			return this;
		}

		clearCache(name) {
			if (name) { this._cache.delete(name); this._pending.delete(name); }
			else { this._cache.clear(); this._pending.clear(); }
			return this;
		}
	}

	// ─── Router Factory ───────────────────────────────────────────────────────────

	function createRouter(options = {}) {
		const isFileProtocol = () => global.location && global.location.protocol === "file:";

		const history =
		options.history || (isFileProtocol() ? createWebHashHistory("/") : createWebHistory("/"));

		// ── Integrated loader ─────────────────────────────────────────────────────
		let loader = null;
		if (options.loader) {
			if (options.loader instanceof MiniX_Loader) {
				loader = options.loader;
			} else if (typeof options.loader === "object") {
				loader = new MiniX_Loader(options.loader.baseDir || '/components', options.loader);
			}
		}

		const records = [];
		const recordsByName = new Map();
		const mountedComponents = new Set();
		const keepAliveStore = new Map();
		const beforeEachHooks = [];
		const afterEachHooks = [];
		const beforeRouteEnterHooks = [];
		const afterRouteEnterHooks = [];
		const beforeRouteLeaveHooks = [];
		const debugListeners = new Set();
		const anonymousComponentNames = new WeakMap();
		const routerViewControllers = new Set();
		const activeLinkControllers = new Set();

		let appRef = null;
		let unlisten = null;
		let debugEnabled = !!options.debug;
		let anonymousId = 0;
		let suppressNextHistoryEvent = false;
		let routerViewRefreshScheduled = false;
		let pendingRouterViewFromRoute = null;
		let activeLinkRefreshScheduled = false;
		let navigationId = 0;
		let installed = false;

		const RouteState = global.MiniX_State || null;
		const currentRoute = RouteState
		? new RouteState({
			fullPath: "/", path: "/", name: null,
			params: {}, query: {}, hash: "",
			meta: {}, matched: [], redirectedFrom: null
		}).raw()
		: {
			fullPath: "/", path: "/", name: null,
			params: {}, query: {}, hash: "",
			meta: {}, matched: [], redirectedFrom: null
		};

		// ── Scheduled refresh helpers ──────────────────────────────────────────

		function scheduleRouterViewRefresh(fromRoute = null) {
			if (fromRoute) pendingRouterViewFromRoute = fromRoute;
			if (routerViewRefreshScheduled) return;
			routerViewRefreshScheduled = true;
			scheduleMicrotask(() => {
				routerViewRefreshScheduled = false;
				const queuedFromRoute = pendingRouterViewFromRoute;
				pendingRouterViewFromRoute = null;
				for (const ctrl of routerViewControllers) {
					if (!ctrl || ctrl.destroyed || !ctrl.el || !ctrl.el.isConnected || typeof ctrl.requestRefresh !== "function") {
						routerViewControllers.delete(ctrl);
						continue;
					}
					try { ctrl.requestRefresh(queuedFromRoute); } catch (_) {}
				}
			});
		}

		function scheduleActiveLinkRefresh() {
			if (activeLinkRefreshScheduled) return;
			activeLinkRefreshScheduled = true;
			scheduleMicrotask(() => {
				activeLinkRefreshScheduled = false;
				for (const ctrl of activeLinkControllers) {
					if (!ctrl || !ctrl.el || !ctrl.el.isConnected || typeof ctrl.refresh !== "function") {
						activeLinkControllers.delete(ctrl);
						continue;
					}
					try { ctrl.refresh(); } catch (_) {}
				}
			});
		}

		// ── Debug ──────────────────────────────────────────────────────────────

		function emitDebug(type, detail) {
			if (!debugEnabled && debugListeners.size === 0) return;
			const payload = { type, timestamp: Date.now(), detail };
			if (debugEnabled) {
				try { console.debug("[MiniXRouter] " + type, detail); } catch (_) {}
			}
			for (const listener of debugListeners) {
				try { listener(payload); } catch (_) {}
			}
			if (debugEnabled) {
				try {
					const EventCtor = global.CustomEvent || (typeof CustomEvent !== "undefined" ? CustomEvent : null);
					if (EventCtor) global.dispatchEvent(new EventCtor("minix-router:debug", { detail: payload }));
				} catch (_) {}
			}
		}

		// ── Component registry ─────────────────────────────────────────────────

		function registerAnonymousComponent(definition) {
			if (typeof definition === "string") return definition;
			if (!definition) return null;
			if (anonymousComponentNames.has(definition)) return anonymousComponentNames.get(definition);
			if (!appRef) {
				console.warn("[MiniXRouter] registerAnonymousComponent called before install(app) — component registration skipped.");
				return null;
			}
			const name = "__MiniXRouterAnon" + (++anonymousId);
			appRef.component(name, definition);
			anonymousComponentNames.set(definition, name);
			return name;
		}

		// ── Route record normalization ─────────────────────────────────────────

		function normalizeRouteRecord(route, parent, parentPath) {
			if (!route || typeof route !== "object") return null;
			const path = route.path == null ? "" : String(route.path);
			const fullPath = path === "" ? normalizePath(parentPath || "/") : joinPaths(parentPath || "/", path);
			const compiled = compileRoutePattern(fullPath);

			const record = {
				path,
				fullPath,
				name: route.name || null,
				redirect: route.redirect,
				component: route.component || null,
				components: route.components || null,
				props: route.props,
				meta: route.meta || {},
				beforeEnter: route.beforeEnter || null,
				parent: parent || null,
				children: [],
				depth: parent ? parent.depth + 1 : 0,
				_loadedViews: Object.create(null),
 ...compiled
			};

			records.push(record);
			if (record.name) recordsByName.set(record.name, record);

			for (const child of (Array.isArray(route.children) ? route.children : [])) {
				const childRecord = normalizeRouteRecord(child, record, record.fullPath);
				if (childRecord) record.children.push(childRecord);
			}

			return record;
		}

		(options.routes || []).forEach((route) => normalizeRouteRecord(route, null, "/"));

		records.sort((a, b) => {
			const ra = getRouteRank(a);
			const rb = getRouteRank(b);
			if (rb.staticCount !== ra.staticCount) return rb.staticCount - ra.staticCount;
			if (ra.catchAllCount !== rb.catchAllCount) return ra.catchAllCount - rb.catchAllCount;
			if (ra.optionalCount !== rb.optionalCount) return ra.optionalCount - rb.optionalCount;
			if (ra.dynamicCount !== rb.dynamicCount) return ra.dynamicCount - rb.dynamicCount;
			if (rb.depth !== ra.depth) return rb.depth - ra.depth;
			return rb.length - ra.length;
		});

		// ── Matching ───────────────────────────────────────────────────────────

		function getMatchedChain(path) {
			const normalizedPath = normalizePath(path);
			const leaf = records.find((record) => record.exactRegex.test(normalizedPath));
			if (!leaf) return [];
			const chain = [];
			let cursor = leaf;
			while (cursor) {
				chain.unshift(cursor);
				cursor = cursor.parent;
			}
			return chain;
		}

		function buildPathFromNamedRoute(record, params) {
			const parts = record.fullPath.split("/").filter(Boolean);
			const built = parts
			.map((part) => {
				if (part === "*") {
					const key = "pathMatch";
					if (!params || !Object.prototype.hasOwnProperty.call(params, key) || params[key] == null || String(params[key]) === "") {
						throw new Error('[MiniXRouter] Missing param "' + key + '" for route "' + (record.name || record.fullPath) + '"');
					}
					return String(params[key])
					.split("/")
					.filter(Boolean)
					.map((segment) => encodeURIComponent(segment))
					.join("/");
				}
				if (!part.startsWith(":")) return part;
				const catchAllMatch = part.match(/^:([^()]+)\(\.\*\)$/);
				const optional = !catchAllMatch && part.endsWith("?");
				const key = catchAllMatch ? catchAllMatch[1] : part.slice(1).replace(/\?$/, "").replace(/\*$/, "");
				const keyInfo = record.keys.find((entry) => entry.name === key);
				const hasParam = !!(params && Object.prototype.hasOwnProperty.call(params, key) && params[key] != null);
				if (hasParam) {
					if (keyInfo && keyInfo.catchAll) {
						const rawValue = String(params[key]);
						if (!rawValue && !keyInfo.zeroOrMore) {
							throw new Error('[MiniXRouter] Missing param "' + key + '" for route "' + (record.name || record.fullPath) + '"');
						}
						return rawValue
						.split("/")
						.filter(Boolean)
						.map((segment) => encodeURIComponent(segment))
						.join("/");
					}
					return encodeURIComponent(String(params[key]));
				}
				if (optional) return null;
				throw new Error('[MiniXRouter] Missing param "' + key + '" for route "' + (record.name || record.fullPath) + '"');
			})
			.filter(Boolean);
			return built.length ? "/" + built.join("/") : "/";
		}

		function normalizeRawTarget(input) {
			if (typeof input === "string") {
				const trimmed = input.trim();
				const baseHref = (trimmed.startsWith("?") || trimmed.startsWith("#"))
				? buildRouterRelativeBaseHref()
				: global.location && global.location.href;
				return buildLocationFromUrlish(input, baseHref);
			}
			if (!input || typeof input !== "object") {
				return { path: "/", query: {}, hash: "" };
			}
			if (input.name) {
				const record = recordsByName.get(input.name);
				if (!record) throw new Error('[MiniXRouter] Unknown route name: "' + input.name + '"');
				return {
					path: buildPathFromNamedRoute(record, input.params || {}),
					query: copyOwnObject(input.query || {}),
					hash: normalizeHash(input.hash || "")
				};
			}
			const rawPath = input.path || "/";
			const trimmedPath = typeof rawPath === "string" ? rawPath.trim() : "";
			const parsedPath = buildLocationFromUrlish(
				rawPath,
				(trimmedPath.startsWith("?") || trimmedPath.startsWith("#")) ? buildRouterRelativeBaseHref() : global.location && global.location.href
			);
			const hasHash = Object.prototype.hasOwnProperty.call(input, "hash");
			return {
				path: parsedPath.path,
				query: { ...copyOwnObject(parsedPath.query), ...copyOwnObject(input.query || {}) },
				hash: hasHash ? normalizeHash(input.hash || "") : parsedPath.hash
			};
		}

		function resolve(input, redirectedFrom = null, debug = false, visited = null) {
			const target = normalizeRawTarget(input);
			const fullTargetKey = target.path + stringifyQuery(target.query) + normalizeHash(target.hash);
			const seen = visited || new Set();
			if (seen.has(fullTargetKey)) {
				throw new Error("[MiniXRouter] Redirect loop detected for " + fullTargetKey);
			}
			seen.add(fullTargetKey);
			const matched = getMatchedChain(target.path);
			const leaf = matched.length ? matched[matched.length - 1] : null;
			if (leaf && leaf.redirect) {
				const redirected =
				typeof leaf.redirect === "function"
				? leaf.redirect({
					path: target.path,
					query: target.query,
					hash: target.hash,
					params: extractParams(leaf, target.path),
								name: leaf.name || null,
								meta: mergeMeta(matched),
								matched
				})
				: leaf.redirect;
			return resolve(redirected, redirectedFrom || fullTargetKey, debug, seen);
			}
			const params = {};
			for (const record of matched) {
				const recordParams = extractParams(record, target.path);
				for (const key of Object.keys(recordParams)) setOwn(params, key, recordParams[key]);
			}
			const route = {
				fullPath: target.path + stringifyQuery(target.query) + normalizeHash(target.hash),
				path: target.path,
				name: leaf ? leaf.name || null : null,
				params,
				query: target.query || {},
				hash: normalizeHash(target.hash),
				meta: mergeMeta(matched),
				matched,
				redirectedFrom: redirectedFrom || null
			};
			if (debug) emitDebug("route:resolved", { input, route });
			return route;
		}

		function isMissingParamError(error) {
			return !!(error && typeof error.message === "string" && error.message.startsWith('[MiniXRouter] Missing param '));
		}

		// ── Route synchronization ──────────────────────────────────────────────

		function getHistoryLocation() {
			if (history && typeof history.getCurrentLocation === "function") return history.getCurrentLocation();
			if (history && typeof history.getLocation === "function") return history.getLocation();
			return "/";
		}

		function normalizeHistoryLocation(location) {
			if (typeof location === "string") return buildLocationFromUrlish(location, global.location && global.location.href);
			if (location && typeof location === "object") {
				if (location.fullPath && !location.path) return buildLocationFromUrlish(location.fullPath, global.location && global.location.href);
				return {
					path: normalizePath(location.path || "/"),
					query: copyOwnObject(location.query || {}),
					hash: normalizeHash(location.hash || "")
				};
			}
			return { path: "/", query: {}, hash: "" };
		}

		function buildRouterRelativeBaseHref() {
			const location = currentRoute && currentRoute.fullPath !== "/"
			? currentRoute
			: normalizeHistoryLocation(getHistoryLocation());
			return "http://localhost" + normalizePath(location.path || "/") + stringifyQuery(location.query) + normalizeHash(location.hash);
		}

		function writeHistory(to, replace) {
			if (!history) return;
			const method = replace ? "replace" : "push";
			if (typeof history[method] === "function") return history[method](to);
		}

		function suppressHistoryEventOnce(fn) {
			suppressNextHistoryEvent = true;
			try {
				fn();
			} finally {
				scheduleMicrotask(() => {
					if (suppressNextHistoryEvent) suppressNextHistoryEvent = false;
				});
			}
		}

		function syncRoute(next) {
			currentRoute.fullPath = next.fullPath;
			currentRoute.path = next.path;
			currentRoute.name = next.name;
			currentRoute.params = copyOwnObject(next.params);
			currentRoute.query = copyOwnObject(next.query);
			currentRoute.hash = next.hash || "";
			currentRoute.meta = copyOwnObject(next.meta);
			currentRoute.matched = Array.isArray(next.matched) ? next.matched.slice() : [];
			currentRoute.redirectedFrom = next.redirectedFrom || null;

			const titleMeta = currentRoute.meta?.title;
			if (titleMeta) {
				try {
					global.document.title =
					typeof titleMeta === "function"
					? titleMeta(cloneRoute(currentRoute))
					: String(titleMeta);
				} catch (_) {}
			}

			if (global.MiniX && typeof global.MiniX.invalidateGlobalScopes === "function") {
				try { global.MiniX.invalidateGlobalScopes(); } catch (_) {}
			}

			scheduleRouterViewRefresh(null);
			scheduleActiveLinkRefresh();
		}

		// ── Guard / hook runners ───────────────────────────────────────────────

		function hookLabel(fn, fallback) {
			return fn && fn.name ? fn.name : fallback;
		}

		async function runGuardList(guards, to, from, source = "guard") {
			if (!guards) return true;
			const list = Array.isArray(guards) ? guards : [guards];
			for (let i = 0; i < list.length; i++) {
				const guard = list[i];
				if (typeof guard !== "function") continue;
				const label = hookLabel(guard, source + "[" + i + "]");
				emitDebug("guard:start", { source, index: i, name: label, to, from });
				let result;
				try {
					result = await guard(cloneRoute(to), cloneRoute(from));
				} catch (error) {
					emitDebug("guard:error", { source, index: i, name: label, to, from, error: String(error?.message || error) });
					throw error;
				}
				emitDebug("guard:finish", { source, index: i, name: label, to, from, result });
				if (result === false) return false;
				if (typeof result === "string" || (result && typeof result === "object")) return result;
			}
			return true;
		}

		async function runRouteBeforeEnter(to, from) {
			for (const record of to.matched || []) {
				const result = await runGuardList(record.beforeEnter, to, from, "beforeEnter:" + (record.name || record.fullPath));
				if (result === false) return false;
				if (result !== true) return result;
			}
			return true;
		}

		async function runHookList(hooks, payload, source = "hook") {
			for (let i = 0; i < hooks.length; i++) {
				const hook = hooks[i];
				if (typeof hook === "function") {
					const label = hookLabel(hook, source + "[" + i + "]");
					emitDebug("hook:start", { source, index: i, name: label, to: payload?.to, from: payload?.from });
					try {
						await hook(payload);
					} catch (error) {
						emitDebug("hook:error", { source, index: i, name: label, to: payload?.to, from: payload?.from, error: String(error?.message || error) });
						throw error;
					}
					emitDebug("hook:finish", { source, index: i, name: label, to: payload?.to, from: payload?.from });
				}
			}
		}

		async function navigate(input, replace, _depth = 0, navId = null) {
			if (navId == null) navId = ++navigationId;
			if (_depth > 20) {
				throw new Error("[MiniXRouter] Navigation redirect loop detected (>20 redirects).");
			}
			const from = cloneRoute(currentRoute);
			const to = resolve(input, null, debugEnabled);
			emitDebug("navigation:start", { to, from, replace: !!replace });
			const globalResult = await runGuardList(beforeEachHooks, to, from, "beforeEach");
			if (navId !== navigationId) {
				emitDebug("navigation:cancelled", { reason: "superseded", to, from });
				return false;
			}
			if (globalResult === false) {
				emitDebug("navigation:aborted", { source: "beforeEach", to, from });
				return false;
			}
			if (globalResult !== true) {
				emitDebug("navigation:redirect", { source: "beforeEach", to, from, target: globalResult });
				return navigate(globalResult, replace, _depth + 1, navId);
			}
			const routeResult = await runRouteBeforeEnter(to, from);
			if (navId !== navigationId) {
				emitDebug("navigation:cancelled", { reason: "superseded", to, from });
				return false;
			}
			if (routeResult === false) {
				emitDebug("navigation:aborted", { source: "beforeEnter", to, from });
				return false;
			}
			if (routeResult !== true) {
				emitDebug("navigation:redirect", { source: "beforeEnter", to, from, target: routeResult });
				return navigate(routeResult, replace, _depth + 1, navId);
			}
			suppressHistoryEventOnce(() => {
				writeHistory(to, replace);
			});
			syncRoute(to);
			const toClone = cloneRoute(to);
			await runHookList(afterEachHooks, { to: toClone, from }, "afterEach");
			emitDebug("navigation:finish", { to: toClone, from, replace: !!replace });
			return true;
		}

		function href(target) {
			const route = resolve(target);
			return history && typeof history.href === "function" ? history.href(route) : route.fullPath;
		}

		// ── View helpers with integrated loader support ─────────────────────────

		function getRouteRecordForView(route, depth) {
			return (route?.matched || [])[depth] || null;
		}

		function getViewComponentFromRecord(record, viewName) {
			if (!record) return null;
			if (record.components && typeof record.components === "object") return record.components[viewName] || null;
			if (viewName === "default") return record.component || null;
			return null;
		}

		const _loaderFn = loader ? (name) => loader.load(name) : null;
		const _pendingLazyLoads = new Map();

		async function resolveViewComponentName(componentValue, routeRecord, viewName) {
			if (!componentValue) return null;
			if (typeof componentValue === "string") return componentValue;

			// If componentValue is a function that expects a loader (arity >= 1) and we have a loader
			if (typeof componentValue === "function" && componentValue.length >= 1 && _loaderFn) {
				const result = componentValue(_loaderFn);
				const resolved = isPromise(result) ? await result : result;
				return resolveViewComponentName(resolved, routeRecord, viewName);
			}

			const cacheKey = viewName || "default";
			if (routeRecord && routeRecord._loadedViews[cacheKey]) return routeRecord._loadedViews[cacheKey];

			const looksLikeLazyLoader =
			typeof componentValue === "function" &&
			!(componentValue.prototype?.constructor === componentValue) &&
			!componentValue.prototype?.view &&
			!componentValue.prototype?.render &&
			!componentValue.prototype?.data &&
			!componentValue.prototype?.mounted;

			if (looksLikeLazyLoader) {
				const pendingKey = routeRecord ? routeRecord.fullPath + "::" + cacheKey : null;
				if (pendingKey && _pendingLazyLoads.has(pendingKey)) {
					return _pendingLazyLoads.get(pendingKey);
				}
				emitDebug("lazy:load:start", { route: routeRecord?.fullPath || null, viewName: cacheKey });
				const loadPromise = Promise.resolve(componentValue()).then((resolvedValue) => {
					const resolved = resolvedValue?.default ?? resolvedValue;
					const name = registerAnonymousComponent(resolved);
					if (routeRecord) routeRecord._loadedViews[cacheKey] = name;
					if (pendingKey) _pendingLazyLoads.delete(pendingKey);
					emitDebug("lazy:load:finish", { route: routeRecord?.fullPath || null, viewName: cacheKey, componentName: name });
					return name;
				}).catch((err) => {
					if (pendingKey) _pendingLazyLoads.delete(pendingKey);
					throw err;
				});
				if (pendingKey) _pendingLazyLoads.set(pendingKey, loadPromise);
				return loadPromise;
			}

			const name = registerAnonymousComponent(componentValue);
			if (routeRecord) routeRecord._loadedViews[cacheKey] = name;
			return name;
		}

		function shouldKeepAlive(record) {
			return !!(record?.meta?.keepAlive);
		}

		function buildCacheKey(route, record, viewName, depth) {
			return depth + "::" + viewName + "::" + (record?.name || record?.fullPath || "unknown") + "::" + route.fullPath;
		}

		function getViewProps(record, route, viewName) {
			if (!record) return {};
			const propsConfig = record.components && isPlainObject(record.props)
			? record.props[viewName]
			: record.props;
			if (propsConfig === true) return copyOwnObject(route.params);
			if (typeof propsConfig === "function") return propsConfig(cloneRoute(route)) || {};
			if (isPlainObject(propsConfig)) return copyOwnObject(propsConfig);
			return {};
		}

		// ── Shared link-directive helpers ──────────────────────────────────────

		function computeActive(current, target, activeMode) {
			if (activeMode === "startsWith") {
				if (target === "/") return current === "/";
				return current === target || current.startsWith(target + "/");
			}
			return current === target;
		}

		function shouldIgnoreClick(event) {
			const el = event.currentTarget;
			return (
				event.defaultPrevented ||
				event.metaKey || event.ctrlKey || event.shiftKey || event.altKey ||
				event.button !== 0 ||
				(el && el.hasAttribute && el.hasAttribute("download")) ||
				(el && el.getAttribute && el.getAttribute("target") && el.getAttribute("target") !== "_self")
			);
		}

		function applyActiveState(el, active, activeClass) {
			el.classList.toggle(activeClass, !!active);
			if (active) el.setAttribute("aria-current", "page");
			else el.removeAttribute("aria-current");
		}

		function createDebouncedEffect(compiler, component, callback) {
			if (!compiler || typeof compiler._effect !== "function") return null;
			let scheduled = false;
			return compiler._effect(component, () => {
				if (scheduled) return;
				scheduled = true;
				scheduleMicrotask(() => { scheduled = false; callback(); });
			});
		}

		async function handleHistoryNavigation(location, options = {}) {
			if (!options.initial && suppressNextHistoryEvent) { suppressNextHistoryEvent = false; return; }
			const navId = ++navigationId;
			const from = cloneRoute(currentRoute);
			const normalizedLocation = normalizeHistoryLocation(location);
			const rawLocation = normalizedLocation.path + stringifyQuery(normalizedLocation.query) + normalizeHash(normalizedLocation.hash);
			const next = resolve(rawLocation, null, debugEnabled);
			const guardResult = await runGuardList(beforeEachHooks, next, from, "beforeEach");
			if (navId !== navigationId) {
				emitDebug("navigation:cancelled", { reason: "superseded", to: next, from });
				return;
			}
			if (guardResult === false) {
				suppressHistoryEventOnce(() => writeHistory(from, true));
				emitDebug("navigation:aborted", { source: "beforeEach", to: next, from });
				return;
			}
			if (guardResult !== true) {
				if (!options.initial) suppressHistoryEventOnce(() => writeHistory(from, true));
				navigate(guardResult, true).catch(() => {});
				return;
			}
			const routeResult = await runRouteBeforeEnter(next, from);
			if (navId !== navigationId) {
				emitDebug("navigation:cancelled", { reason: "superseded", to: next, from });
				return;
			}
			if (routeResult === false) {
				suppressHistoryEventOnce(() => writeHistory(from, true));
				emitDebug("navigation:aborted", { source: "beforeEnter", to: next, from });
				return;
			}
			if (routeResult !== true) {
				if (!options.initial) suppressHistoryEventOnce(() => writeHistory(from, true));
				navigate(routeResult, true).catch(() => {});
				return;
			}
			syncRoute(next);
			await runHookList(afterEachHooks, { to: cloneRoute(next), from }, "afterEach");
			emitDebug(options.initial ? "navigation:initial" : "navigation:external", { to: next, from });
		}

		function attachHistoryListener() {
			if (unlisten || !history || typeof history.listen !== "function") return;
			unlisten = history.listen(function (location) {
				Promise.resolve(handleHistoryNavigation(location)).catch((error) => {
					emitDebug("navigation:error", { source: "history", error: String(error?.message || error), location });
				});
			});
		}

		// ── Router object ──────────────────────────────────────────────────────

		const router = {
			currentRoute,

			install(app) {
				if (installed) return app;
				installed = true;
				appRef = app;
				app.provide("router", router);

				app.addInstanceAPI((component) => {
					mountedComponents.add(component);
					if (component && typeof component.$onDestroy === "function") {
						component.$onDestroy(() => mountedComponents.delete(component));
					}
					const instanceAPI = Object.create(null);
					for (const [alias, prop] of [
						["$route", "route"], ["$params", "params"], ["$query", "query"],
						["route", "route"], ["params", "params"], ["query", "query"]
					]) {
						const isRoute = prop === "route";
						Object.defineProperty(instanceAPI, alias, {
							enumerable: true,
							get: isRoute ? () => currentRoute : () => currentRoute[prop]
						});
					}
					instanceAPI.$router = router;
					instanceAPI.router = router;
					instanceAPI.$getRoute = () => cloneRoute(currentRoute);
					return instanceAPI;
				});

				app.addScope(() => ({
					get route() { return currentRoute; },
					get params() { return currentRoute.params; },
					get query() { return currentRoute.query; }
				}));

				// ── x-link directive ───────────────────────────────────────────

				app.directive("x-link", ({ el, component, compiler }) => {
					const activeClass = el.getAttribute("x-active") || "active";
					const activeMode = (el.getAttribute("x-active-mode") || "exact").trim();
					const replaceMode = el.hasAttribute("x-replace");

					function getTarget() {
						const value = el.getAttribute("x-link");
						return (value == null || String(value).trim() === "") ? "/" : String(value).trim();
					}

					function updateHrefAndActive() {
						try {
							const to = getTarget();
							el.setAttribute("href", router.href(to));
							const resolved = router.resolve(to);
							applyActiveState(el, computeActive(router.currentRoute.path, resolved.path, activeMode), activeClass);
						} catch (error) {
							console.warn("[MiniXRouter] x-link update failed:", error);
							el.setAttribute("href", "#");
							el.classList.remove(activeClass);
							el.removeAttribute("aria-current");
						}
					}

					function onClick(event) {
						if (shouldIgnoreClick(event)) return;
						event.preventDefault();
						try {
							const to = getTarget();
							router._emitDebug("link:click", { type: "x-link", to, text: (el.textContent || "").trim(), href: el.getAttribute("href") });
							const nav = replaceMode ? router.replace(to) : router.push(to);
							if (nav && typeof nav.catch === "function") nav.catch((error) => {
								console.warn("[MiniXRouter] x-link navigation failed:", error);
							});
						} catch (error) {
							console.warn("[MiniXRouter] x-link navigation failed:", error);
						}
					}

					el.addEventListener("click", onClick);
					const activeCtrl = { el, refresh: updateHrefAndActive };
					activeLinkControllers.add(activeCtrl);
					const stopActiveEffect = createDebouncedEffect(compiler, component, () => {
						void router.currentRoute.fullPath;
						updateHrefAndActive();
					});
					updateHrefAndActive();
					return function cleanup() {
						el.removeEventListener("click", onClick);
						activeLinkControllers.delete(activeCtrl);
						if (typeof stopActiveEffect === "function") stopActiveEffect();
					};
				});

				// ── x-route directive ──────────────────────────────────────────

				app.directive("x-route", ({ el, component, compiler }) => {
					const activeClass = el.getAttribute("x-active") || "active";
					const activeMode = (el.getAttribute("x-active-mode") || "exact").trim();
					const replaceMode = el.hasAttribute("x-replace");

					function parseTarget() {
						const rawValue = el.getAttribute("x-route");
						const value = rawValue == null ? "" : String(rawValue).trim();
						if (!value) return "/";
						if (value.startsWith("{") || value.startsWith("[")) {
							try {
								const getter = compiler._compileGetter("(" + value + ")");
								const scope = compiler.createScope(component, {}, el);
								const result = getter(scope);
								return result == null ? "/" : result;
							} catch (_) {
								return "/";
							}
						}
						return value.startsWith("/") ? value : { name: value };
					}

					function updateHrefAndActive() {
						try {
							const to = parseTarget();
							if (to == null) { el.setAttribute("href", "#"); return; }
							el.setAttribute("href", router.href(to));
							delete el.dataset.routeInvalid;
							const resolved = router.resolve(to);
							applyActiveState(el, computeActive(router.currentRoute.path, resolved.path, activeMode), activeClass);
						} catch (error) {
							if (isMissingParamError(error)) {
								el.setAttribute("href", "#");
								el.dataset.routeInvalid = "true";
								el.classList.remove(activeClass);
								el.removeAttribute("aria-current");
								return;
							}
							console.warn("[MiniXRouter] x-route update failed:", error);
							el.setAttribute("href", "#");
							el.classList.remove(activeClass);
							el.removeAttribute("aria-current");
						}
					}

					function onClick(event) {
						if (shouldIgnoreClick(event)) return;
						if (el.dataset.routeInvalid === "true") { event.preventDefault(); return; }
						event.preventDefault();
						try {
							const to = parseTarget();
							router._emitDebug("link:click", { type: "x-route", to, text: (el.textContent || "").trim(), href: el.getAttribute("href") });
							const nav = replaceMode ? router.replace(to) : router.push(to);
							if (nav && typeof nav.catch === "function") nav.catch((error) => {
								console.warn("[MiniXRouter] x-route navigation failed:", error);
							});
						} catch (error) {
							console.warn("[MiniXRouter] x-route navigation failed:", error);
						}
					}

					el.addEventListener("click", onClick);
					const activeCtrl = { el, refresh: updateHrefAndActive };
					activeLinkControllers.add(activeCtrl);
					const stopActiveEffect = createDebouncedEffect(compiler, component, () => {
						void router.currentRoute.fullPath;
						void router.currentRoute.params;
						void router.currentRoute.query;
						updateHrefAndActive();
					});
					updateHrefAndActive();
					return function cleanup() {
						el.removeEventListener("click", onClick);
						activeLinkControllers.delete(activeCtrl);
						if (typeof stopActiveEffect === "function") stopActiveEffect();
					};
				});

				// ── x-router-view directive ────────────────────────────────────

				app.directive("x-router-view", ({ el, expression, component }) => {
					const viewName = (el.getAttribute("x-router-view") || expression || "default").trim() || "default";
					let depth = 0;
					let parent = el.parentElement;
					while (parent) {
						if (parent.__minix_router_view_depth__ != null) {
							depth = Number(parent.__minix_router_view_depth__) + 1;
							break;
						}
						parent = parent.parentElement;
					}
					el.__minix_router_view_depth__ = depth;

					let ctrl = el.__minix_router_view_ctrl__;
					if (!ctrl) {
						ctrl = el.__minix_router_view_ctrl__ = {
							instanceId: Symbol("router-view"),
							activeChild: null, activeHost: null,
							activeCacheKey: null, activeRecord: null,
							renderToken: 0, scheduled: false,
							lastRenderedKey: null, stopEffect: null,
							destroyed: false, el, requestRefresh: null
						};
					} else {
						ctrl.instanceId = Symbol("router-view");
						ctrl.destroyed = false;
						ctrl.el = el;
					}
					const instanceId = ctrl.instanceId;

					function clearLiveHost() {
						if (ctrl.activeHost && ctrl.activeHost.parentNode === el) el.removeChild(ctrl.activeHost);
					}

					function destroyActiveChild() {
						if (ctrl.activeChild && typeof ctrl.activeChild.destroy === "function" && !ctrl.activeChild.isDestroyed) {
							try { ctrl.activeChild.destroy(); } catch (_) {}
						}
					}

					function hookPayload(fromRoute, route, record) {
						return {
							from: fromRoute ? cloneRoute(fromRoute) : null,
							to: cloneRoute(route),
							el, viewName, depth, record
						};
					}

					function isStale(token) {
						return token !== ctrl.renderToken || ctrl.destroyed || ctrl.instanceId !== instanceId;
					}

					async function mountForCurrentRoute(fromRoute = null) {
						if (el.__minix_router_view_ctrl__ !== ctrl || ctrl.instanceId !== instanceId || ctrl.destroyed) return;
						const token = ++ctrl.renderToken;
						const route = cloneRoute(router.currentRoute);
						const record = getRouteRecordForView(route, depth);
						const componentValue = getViewComponentFromRecord(record, viewName);
						const renderKey = [viewName, depth, route.fullPath, record ? record.fullPath : "null"].join("::");
						router._emitDebug("view:render", { viewName, depth, record: record ? record.fullPath : null, route });
						if (!record || !componentValue) {
							ctrl.lastRenderedKey = renderKey;
							await runHookList(beforeRouteLeaveHooks, hookPayload(fromRoute, route, ctrl.activeRecord), "beforeRouteLeave");
							if (isStale(token)) return;
							destroyActiveChild();
							clearLiveHost();
							ctrl.activeChild = ctrl.activeHost = ctrl.activeCacheKey = ctrl.activeRecord = null;
							el.innerHTML = "";
							return;
						}
						if (ctrl.lastRenderedKey === renderKey && ctrl.activeChild && !ctrl.activeChild.isDestroyed) {
							router._emitDebug("view:skip", { viewName, depth, route, record: record.fullPath });
							return;
						}
						const keepAlive = shouldKeepAlive(record);
						const cacheKey = buildCacheKey(route, record, viewName, depth);
						await runHookList(beforeRouteLeaveHooks, hookPayload(fromRoute, route, ctrl.activeRecord), "beforeRouteLeave");
						if (isStale(token)) return;
						if (keepAlive && keepAliveStore.has(cacheKey)) {
							const cached = keepAliveStore.get(cacheKey);
							await runHookList(beforeRouteEnterHooks, hookPayload(fromRoute, route, record), "beforeRouteEnter");
							if (isStale(token)) return;
							if (ctrl.activeChild !== cached.component) {
								destroyActiveChild();
							}
							clearLiveHost();
							el.innerHTML = "";
							el.appendChild(cached.host);
							ctrl.activeChild = cached.component;
							ctrl.activeHost = cached.host;
							ctrl.activeCacheKey = cacheKey;
							ctrl.activeRecord = record;
							ctrl.lastRenderedKey = renderKey;
							await runHookList(afterRouteEnterHooks, hookPayload(fromRoute, route, record), "afterRouteEnter");
							router._emitDebug("keepalive:hit", { key: cacheKey, viewName, depth, route });
							return;
						}
						destroyActiveChild();
						clearLiveHost();
						ctrl.activeChild = ctrl.activeHost = ctrl.activeCacheKey = ctrl.activeRecord = null;
						el.innerHTML = "";
						await runHookList(beforeRouteEnterHooks, hookPayload(fromRoute, route, record), "beforeRouteEnter");
						if (isStale(token)) return;
						const resolvedName = await resolveViewComponentName(componentValue, record, viewName);
						if (isStale(token) || !resolvedName) return;
						const props = getViewProps(record, route, viewName);
						const host = global.document.createElement("div");
						host.setAttribute("data-router-view-host", viewName);
						el.appendChild(host);
						let child = null;
						try {
							child = component.mountChild(resolvedName, host, props, {});
						} catch (error) {
							if (host.parentNode === el) el.removeChild(host);
							router._emitDebug("view:mount:error", {
								viewName, depth, route,
								componentName: resolvedName,
								error: error?.message ?? String(error)
							});
							throw error;
						}
						if (isStale(token)) {
							if (child && typeof child.destroy === "function" && !child.isDestroyed) {
								try { child.destroy(); } catch (_) {}
							}
							if (host.parentNode === el) el.removeChild(host);
							return;
						}
						if (!child) {
							if (host.parentNode === el) el.removeChild(host);
							router._emitDebug("view:mount:failed", { viewName, depth, route, componentName: resolvedName });
							return;
						}
						ctrl.activeChild = child;
						ctrl.activeHost = host;
						ctrl.activeRecord = record;
						ctrl.activeCacheKey = keepAlive ? cacheKey : null;
						ctrl.lastRenderedKey = renderKey;
						router._emitDebug("view:mount:success", { viewName, depth, route, componentName: resolvedName });
						if (keepAlive) {
							keepAliveStore.set(cacheKey, { component: child, host });
							router._emitDebug("keepalive:store", { key: cacheKey, viewName, depth, route });
						}
						await runHookList(afterRouteEnterHooks, hookPayload(fromRoute, route, record), "afterRouteEnter");
					}

					ctrl.requestRefresh = function requestRefresh(fromRoute = null) {
						if (el.__minix_router_view_ctrl__ !== ctrl || ctrl.instanceId !== instanceId || ctrl.destroyed || !el.isConnected) return;
						if (ctrl.scheduled) return;
						ctrl.scheduled = true;
						scheduleMicrotask(() => {
							if (el.__minix_router_view_ctrl__ !== ctrl || ctrl.instanceId !== instanceId) return;
							ctrl.scheduled = false;
							if (ctrl.destroyed || !el.isConnected) return;
							mountForCurrentRoute(fromRoute);
						});
					};

					routerViewControllers.add(ctrl);
					if (!ctrl.stopEffect && component.compiler && typeof component.compiler._effect === "function") {
						ctrl.stopEffect = component.compiler._effect(component, () => {
							if (el.__minix_router_view_ctrl__ !== ctrl || ctrl.instanceId !== instanceId || ctrl.destroyed) return;
							void router.currentRoute.fullPath;
							void (router.currentRoute.matched?.length ?? 0);
							ctrl.requestRefresh(null);
						});
					}
					if (!ctrl.activeChild && !ctrl.scheduled) ctrl.requestRefresh(null);
					return function cleanup() {
						const myInstanceId = instanceId;
						scheduleMicrotask(() => {
							if (el.__minix_router_view_ctrl__ !== ctrl) return;
							if (ctrl.instanceId !== myInstanceId) return;
							if (el.isConnected) return;
							ctrl.destroyed = true;
							try { ctrl.stopEffect?.(); } catch (_) {}
							ctrl.stopEffect = null;
							if (ctrl.activeCacheKey) keepAliveStore.delete(ctrl.activeCacheKey);
							destroyActiveChild();
							clearLiveHost();
							ctrl.activeChild = ctrl.activeHost = ctrl.activeCacheKey = ctrl.activeRecord = null;
							ctrl.lastRenderedKey = null;
							ctrl.scheduled = false;
							ctrl.requestRefresh = null;
							routerViewControllers.delete(ctrl);
							if (el.__minix_router_view_ctrl__ === ctrl && ctrl.instanceId === myInstanceId) {
								delete el.__minix_router_view_ctrl__;
							}
						});
					};
				});

				attachHistoryListener();
				Promise.resolve(handleHistoryNavigation(getHistoryLocation(), { initial: true })).catch((error) => {
					emitDebug("navigation:error", { source: "initial", error: String(error?.message || error), location: getHistoryLocation() });
				});
				return app;
			},

			resolve,
			push(to) { return navigate(to, false); },
			replace(to) { return navigate(to, true); },
			back() {
				if (history && typeof history.back === "function") return history.back();
				if (global.history && typeof global.history.back === "function") return global.history.back();
			},
			forward() {
				if (history && typeof history.forward === "function") return history.forward();
				if (global.history && typeof global.history.forward === "function") return global.history.forward();
			},
			go(n) {
				if (history && typeof history.go === "function") return history.go(n);
				if (global.history && typeof global.history.go === "function") return global.history.go(n);
			},
			href,

			beforeEach(fn) { if (typeof fn === "function") beforeEachHooks.push(fn); return router; },
			afterEach(fn) { if (typeof fn === "function") afterEachHooks.push(fn); return router; },
			beforeRouteEnter(fn) { if (typeof fn === "function") beforeRouteEnterHooks.push(fn); return router; },
			afterRouteEnter(fn) { if (typeof fn === "function") afterRouteEnterHooks.push(fn); return router; },
			beforeRouteLeave(fn) { if (typeof fn === "function") beforeRouteLeaveHooks.push(fn); return router; },

			onDebug(fn) {
				if (typeof fn === "function") debugListeners.add(fn);
				return () => debugListeners.delete(fn);
			},

			enableDebug() { debugEnabled = true; return router; },
			disableDebug() { debugEnabled = false; return router; },

			clearKeepAlive(key) {
				function destroyCached(cached) {
					if (cached?.component && typeof cached.component.destroy === "function" && !cached.component.isDestroyed) {
						try { cached.component.destroy(); } catch (_) {}
					}
				}
				if (typeof key === "string") {
					destroyCached(keepAliveStore.get(key));
					keepAliveStore.delete(key);
					for (const ctrl of routerViewControllers) {
						if (ctrl.activeCacheKey === key) ctrl.activeCacheKey = null;
					}
					return router;
				}
				const entries = Array.from(keepAliveStore.entries());
				keepAliveStore.clear();
				for (const [, cached] of entries) destroyCached(cached);
				for (const ctrl of routerViewControllers) ctrl.activeCacheKey = null;
				return router;
			},

			stop() {
				if (typeof unlisten === "function") { unlisten(); unlisten = null; }
				return router;
			},

			start() {
				attachHistoryListener();
				Promise.resolve(handleHistoryNavigation(getHistoryLocation(), { initial: true })).catch((error) => {
					emitDebug("navigation:error", { source: "start", error: String(error?.message || error), location: getHistoryLocation() });
				});
				return router;
			},

			getLoader() { return loader; },

			_emitDebug: emitDebug,
			_app() { return appRef; }
		};

		return router;
	}

	// Expose Loader as a separate utility (optional)
	const MiniXRouter = {
		createRouter,
		createWebHistory,
		createWebHashHistory,
		Loader: MiniX_Loader
	};

	if (typeof module !== "undefined" && module.exports) {
		module.exports = MiniXRouter;
	}
	if (global) {
		global.MiniXRouter = MiniXRouter;
	}
})(typeof window !== "undefined" ? window : globalThis);
