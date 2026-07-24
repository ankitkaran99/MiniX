class MiniX_Request {

	constructor(baseURL = '', defaults = {}) {
		this._baseURL = String(baseURL).replace(/\/+$/, '');
		this._defaults = {
			headers: {},
			timeout: 0,
			credentials: 'same-origin',
			mode: 'cors',
			cache: 'default',
			redirect: 'follow',
			referrerPolicy: '',
			integrity: '',
			keepalive: false,
			responseType: 'json',
			...defaults,
			headers: { 'Content-Type': 'application/json', ...(defaults.headers || {}) }
		};
		this._interceptors = { request: new Set(), response: new Set(), error: new Set() };
		this._listeners = new Map();
		this._cache = new Map();
		this._abortControllers = new Map();
		this._idCounter = 0;
		this._lastFiredId = 0;
	}

	static _descriptorProto = {
		header(name, value) {
			// _headers may be a direct reference to the shared instance defaults
			// object (see _builder) when opts.headers was not passed — copy on
			// first write so mutating one descriptor's headers never leaks into
			// the instance's defaults or other in-flight requests.
			if (this._headers === this._instance._defaults.headers) this._headers = { ...this._headers };
			if (typeof name === 'object') Object.assign(this._headers, name);
			else this._headers[name] = value;
			return this;
		},
		query(params) {
			if (!this._params) this._params = {};
			Object.assign(this._params, params);
			return this;
		},
		body(value) { this._body = value; return this; },
		as(type) {
			if (this._promise && this._sentResponseType !== type) {
				throw new Error('[MiniX.Request] Response type cannot be changed after the request has started.');
			}
			this._responseType = type;
			return this;
		},
		timeout(ms) { this._timeout = ms; return this; },
		signal(sig) { this._signal = sig; return this; },
		retry(times, delay = 300, factor = 2) {
			this._retry = times; this._retryDelay = delay; this._retryFactor = factor;
			return this;
		},
		cache(ms) { this._cacheTime = ms; return this; },
		onUploadProgress(fn) { this._onUploadProgress = fn; return this; },
		onDownloadProgress(fn) { this._onDownloadProgress = fn; return this; },
		_send(type) {
			if (type && this._promise && this._sentResponseType !== type) {
				return Promise.reject(new Error('[MiniX.Request] Response type cannot be changed after the request has started.'));
			}
			if (!this._promise) {
				if (type) this._responseType = type;
				this._sentResponseType = this._responseType;
				this._promise = this._instance._fire(this);
			}
			return this._promise;
		},
		json() { return this._send('json'); },
		text() { return this._send('text'); },
		blob() { return this._send('blob'); },
		arrayBuffer() { return this._send('arrayBuffer'); },
		response() { return this._send('response'); },
		then(resolve, reject) { return this._send().then(resolve, reject); },
		catch(reject) { return this._send().catch(reject); },
		finally(fn) { return this._send().finally(fn); },
	};

	_builder(method, url, bodyOrOptions, options = {}) {

		let body = undefined;
		let opts = options;
		const normalizedMethod = String(method || '').toUpperCase();
		const canInferOptions = normalizedMethod === 'GET'
			|| normalizedMethod === 'HEAD'
			|| normalizedMethod === 'DELETE'
			|| normalizedMethod === 'OPTIONS';
		if (canInferOptions && bodyOrOptions !== undefined && typeof bodyOrOptions === 'object' && !this._isBodyValue(bodyOrOptions)) {
			let isOpts = false;
			for (const k in bodyOrOptions) { if (MiniX_Request._optionKeys.has(k)) { isOpts = true; break; } }
			if (isOpts) { opts = bodyOrOptions; }
			else { body = bodyOrOptions; }
		} else {
			body = bodyOrOptions;
		}

		const desc = Object.create(MiniX_Request._descriptorProto);
		desc._method = normalizedMethod;
		desc._url = url;
		desc._body = body;
		desc._headers = opts.headers
			? { ...this._defaults.headers, ...opts.headers }
			: this._defaults.headers;
		desc._params = opts.params ? { ...opts.params } : null;
		desc._timeout = opts.timeout !== undefined ? opts.timeout : this._defaults.timeout;
		desc._signal = opts.signal || null;
		desc._credentials = opts.credentials || this._defaults.credentials;
		desc._mode = opts.mode || this._defaults.mode;
		desc._cache = opts.cache || this._defaults.cache;
		desc._redirect = opts.redirect || this._defaults.redirect;
		desc._referrerPolicy = opts.referrerPolicy || this._defaults.referrerPolicy;
		desc._integrity = opts.integrity || this._defaults.integrity;
		desc._keepalive = opts.keepalive !== undefined ? opts.keepalive : this._defaults.keepalive;
		desc._responseType = opts.responseType || this._defaults.responseType;
		desc._retry = opts.retry || 0;
		desc._retryDelay = opts.retryDelay !== undefined ? opts.retryDelay : 300;
		desc._retryFactor = opts.retryFactor !== undefined ? opts.retryFactor : 2;
		desc._cacheTime = opts.cacheTime || 0;
		desc._onUploadProgress = opts.onUploadProgress || null;
		desc._onDownloadProgress = opts.onDownloadProgress || null;
		desc._instance = this;
		return desc;
	}

	_isBodyValue(v) {
		return (typeof FormData !== 'undefined' && v instanceof FormData)
			|| (typeof URLSearchParams !== 'undefined' && v instanceof URLSearchParams)
			|| (typeof Blob !== 'undefined' && v instanceof Blob)
			|| (typeof ArrayBuffer !== 'undefined' && (v instanceof ArrayBuffer || ArrayBuffer.isView(v)))
			|| typeof v === 'string'
			|| typeof v === 'number'
			|| typeof v === 'boolean';
	}

	async _fire(desc, attempt = 0) {
		const id = ++this._idCounter;

		const canUseCache = desc._cacheTime > 0 && desc._responseType !== 'response';
		let cacheKey = null;
		const url = this._resolveURL(desc._url, desc._params);

		let fetchBody = undefined;
		// Copy headers when interceptors or body processing may mutate them.
		// Without a copy, body serialisation would mutate the shared desc._headers object.
		const needsHeaderCopy = this._interceptors.request.size > 0 || (desc._body !== undefined && desc._body !== null);
		let headers = needsHeaderCopy ? { ...desc._headers } : desc._headers;

		if (desc._body !== undefined && desc._body !== null) {
			if (typeof FormData !== 'undefined' && desc._body instanceof FormData) {
				fetchBody = desc._body;
				delete headers['Content-Type'];
			} else if (typeof URLSearchParams !== 'undefined' && desc._body instanceof URLSearchParams) {
				fetchBody = desc._body;
				headers['Content-Type'] = 'application/x-www-form-urlencoded';
			} else if (
				(typeof Blob !== 'undefined' && desc._body instanceof Blob) ||
				(typeof ArrayBuffer !== 'undefined' && (desc._body instanceof ArrayBuffer || ArrayBuffer.isView(desc._body))) ||
				typeof desc._body === 'string'
			) {
				fetchBody = desc._body;
			} else {
				fetchBody = JSON.stringify(desc._body);
				headers['Content-Type'] = headers['Content-Type'] || 'application/json';
			}
		}

		let requestUrl = url;
		let requestMethod = desc._method.toUpperCase();
		let reqHeaders = headers;
		let reqBody = fetchBody;

		if (this._interceptors.request.size > 0) {
			let reqContext = { url, method: requestMethod, headers, body: fetchBody, descriptor: desc };
			for (const interceptor of this._interceptors.request) {
				try { reqContext = (await interceptor(reqContext)) || reqContext; }
				catch (e) { console.warn('[MiniX_Request] Request interceptor threw:', e); }
			}
			requestUrl = reqContext.url || url;
			requestMethod = String(reqContext.method || '').toUpperCase();
			reqHeaders = reqContext.headers;
			reqBody = reqContext.body;
		}
		cacheKey = canUseCache && (requestMethod === 'GET' || requestMethod === 'HEAD') ? this._cacheKey({
			_method: requestMethod,
			_resolvedURL: requestUrl,
			_params: null,
			_responseType: desc._responseType,
			_credentials: desc._credentials,
			_mode: desc._mode
		}) : null;
		if (cacheKey) {
			const hit = this._cache.get(cacheKey);
			if (hit) {
				if (Date.now() < hit.expires) return hit.data;
				this._cache.delete(cacheKey);
			}
			// Evict stale entries periodically (every 20 fired requests) rather than on every request,
			// to avoid an O(n) cache scan on each call.
			if ((id % 20) === 0) {
				const now = Date.now();
				for (const [k, v] of this._cache) {
					if (now >= v.expires) this._cache.delete(k);
				}
			}
		}

		const controller = new AbortController();
		this._lastFiredId = id;
		this._abortControllers.set(id, controller);
		const signals = [controller.signal];
		if (desc._signal) signals.push(desc._signal);

		let timeoutId = null;
		if (desc._timeout > 0) {
			timeoutId = setTimeout(() => {
				controller.abort('timeout');
				this._emit('timeout', { url: requestUrl, timeout: desc._timeout, descriptor: desc });
			}, desc._timeout);
		}

		let composedSignal, anySignalCleanup;
		if (signals.length > 1) {
			const composed = this._anySignal(signals);
			composedSignal = composed.signal;
			anySignalCleanup = composed.cleanup;
		} else {
			composedSignal = signals[0];
			anySignalCleanup = null;
		}

		this._emit('before', { id, url: requestUrl, method: requestMethod, descriptor: desc });

		let response;
		try {

			if (desc._onUploadProgress && typeof XMLHttpRequest !== 'undefined') {
				response = await this._xhrFetch(requestUrl, {
					method: requestMethod,
					headers: reqHeaders,
					body: reqBody,
					credentials: desc._credentials,
					signal: composedSignal,
					onUploadProgress: desc._onUploadProgress,
					onDownloadProgress: desc._onDownloadProgress,
				});
			} else {
				response = await fetch(requestUrl, {
					method: requestMethod,
					headers: reqHeaders,
					body: reqBody,
					credentials: desc._credentials,
					mode: desc._mode,
					cache: desc._cache,
					redirect: desc._redirect,
					referrerPolicy: desc._referrerPolicy,
					integrity: desc._integrity,
					keepalive: desc._keepalive,
					signal: composedSignal,
				});
			}

			if (desc._onDownloadProgress && response.body) {
				response = await this._trackDownload(response, desc._onDownloadProgress);
			}

			if (!response.ok) {
				const errBody = await this._safeRead(response, desc._responseType);
				const err = this._makeError(
					`HTTP ${response.status} ${response.statusText}`,
					response.status, requestUrl, requestMethod, errBody, response
				);
				throw err;
			}

			let resContext = { response, descriptor: desc };
			for (const interceptor of this._interceptors.response) {
				try { resContext = (await interceptor(resContext)) || resContext; }
				catch (e) { console.warn('[MiniX_Request] Response interceptor threw:', e); }
			}

			const data = await this._read(resContext.response, desc._responseType);

			if (cacheKey) {
				this._cache.set(cacheKey, { data, expires: Date.now() + desc._cacheTime });
			}

			this._emit('after', { id, url: requestUrl, method: requestMethod, data, response: resContext.response, descriptor: desc });
			return data;

		} catch (err) {
			const isAbort = err?.name === 'AbortError' || err?.name === 'abort';
			if (isAbort) {
				this._emit('abort', { id, url: requestUrl, method: requestMethod, descriptor: desc });
				throw err;
			}

			if (attempt < desc._retry) {
				const delay = desc._retryDelay * Math.pow(desc._retryFactor, attempt);
				this._emit('retry', { id, url: requestUrl, attempt: attempt + 1, delay, error: err, descriptor: desc });
				await this._sleep(delay, composedSignal);
				clearTimeout(timeoutId);
				timeoutId = null;
				this._abortControllers.delete(id);
				anySignalCleanup?.();
				anySignalCleanup = null;
				return this._fire(desc, attempt + 1);
			}

			let throwErr = err;
			for (const interceptor of this._interceptors.error) {
				try {
					const result = await interceptor(err, desc);
					if (result !== undefined) return result;
				} catch (e) { throwErr = e; }
			}

			this._emit('error', { id, url: requestUrl, method: requestMethod, error: throwErr, descriptor: desc });
			throw throwErr;
		} finally {
			
			clearTimeout(timeoutId);
			this._abortControllers.delete(id);
			anySignalCleanup?.();
		}
	}

	get(url, options = {}) { return this._builder('GET', url, undefined, options); }

	post(url, body, options = {}) { return this._builder('POST', url, body, options); }

	put(url, body, options = {}) { return this._builder('PUT', url, body, options); }

	patch(url, body, options = {}) { return this._builder('PATCH', url, body, options); }

	delete(url, options = {}) { return this._builder('DELETE', url, undefined, options); }

	head(url, options = {}) { return this._builder('HEAD', url, undefined, options); }

	options(url, options = {}) { return this._builder('OPTIONS', url, undefined, options); }

	addRequestInterceptor(fn) {
		this._interceptors.request.add(fn);
		return () => this._interceptors.request.delete(fn);
	}

	addResponseInterceptor(fn) {
		this._interceptors.response.add(fn);
		return () => this._interceptors.response.delete(fn);
	}

	addErrorInterceptor(fn) {
		this._interceptors.error.add(fn);
		return () => this._interceptors.error.delete(fn);
	}

	clearInterceptors(type) {
		if (type) { this._interceptors[type].clear(); }
		else { this._interceptors.request.clear(); this._interceptors.response.clear(); this._interceptors.error.clear(); }
		return this;
	}

	on(event, fn) {
		if (!this._listeners.has(event)) this._listeners.set(event, new Set());
		this._listeners.get(event).add(fn);
		return () => this._listeners.get(event)?.delete(fn);
	}

	off(event, fn) {
		if (!fn) { this._listeners.delete(event); return this; }
		this._listeners.get(event)?.delete(fn);
		return this;
	}

	_emit(event, payload) {
		const fns = this._listeners.get(event);
		if (fns) for (const fn of fns) { try { fn(payload); } catch (_) { } }
	}

	invalidate(url, params = {}) {
		const resolvedURL = this._resolveURL(url, params);
		// Collect keys first to avoid mutating the Map mid-iteration.
		// Match any HTTP method (GET, HEAD, etc.) that may have been cached for this URL.
		const toDelete = [];
		for (const key of this._cache.keys()) {
			const colonIdx = key.indexOf(':');
			if (colonIdx !== -1 && key.indexOf(resolvedURL, colonIdx + 1) !== -1) toDelete.push(key);
		}
		for (let i = 0; i < toDelete.length; i++) this._cache.delete(toDelete[i]);
		return this;
	}

	clearCache() {
		this._cache.clear();
		return this;
	}

	getCacheEntries() {
		return [...this._cache.entries()].map(([key, v]) => ({ key, expires: v.expires, data: v.data }));
	}

	_cacheKey(desc) {
		const type = desc._responseType == null ? '' : String(desc._responseType);
		const url = desc._resolvedURL || this._resolveURL(desc._url, desc._params);
		const creds = desc._credentials == null ? '' : String(desc._credentials);
		const mode = desc._mode == null ? '' : String(desc._mode);
		return `${desc._method}:${url}:${type}:${creds}:${mode}`;
	}

	abort() {
		const lastId = this._lastFiredId;
		const ctrl = this._abortControllers.get(lastId);
		if (ctrl) { ctrl.abort('manual'); this._abortControllers.delete(lastId); return true; }
		return false;
	}

	abortAll() {
		for (const ctrl of this._abortControllers.values()) ctrl.abort('manual');
		this._abortControllers.clear();
		return this;
	}

	get pending() { return this._abortControllers.size; }

	extend(baseURLOrDefaults, defaults = {}) {
		let base = this._baseURL;
		let opts = defaults;
		if (typeof baseURLOrDefaults === 'string') {
			const path = baseURLOrDefaults;
			base = /^https?:\/\//i.test(path)
				? path.replace(/\/+$/, '')
				: this._baseURL + '/' + path.replace(/^\/+/, '').replace(/\/+$/, '');
		} else {
			opts = baseURLOrDefaults || {};
		}

		const mergedHeaders = { ...this._defaults.headers, ...(opts.headers || {}) };
		return new MiniX_Request(base, { ...this._defaults, ...opts, headers: mergedHeaders });
	}

	setHeader(name, value) {
		if (typeof name === 'object') Object.assign(this._defaults.headers, name);
		else this._defaults.headers[name] = value;
		return this;
	}

	removeHeader(name) {
		delete this._defaults.headers[name];
		return this;
	}

	setBaseURL(url) {
		this._baseURL = String(url).replace(/\/+$/, '');
		return this;
	}

	setAuth(token) {
		if (!token) return this.removeHeader('Authorization');
		return this.setHeader('Authorization', `Bearer ${token}`);
	}

	static all(requests) {
		return Promise.all(requests.map((r) => typeof r.then === 'function' ? r : (typeof r.json === 'function' ? r.json() : Promise.resolve(r))));
	}

	static allSettled(requests) {
		return Promise.allSettled(requests.map((r) => typeof r.then === 'function' ? r : (typeof r.json === 'function' ? r.json() : Promise.resolve(r))));
	}

	static race(requests) {
		return Promise.race(requests.map((r) => typeof r.then === 'function' ? r : (typeof r.json === 'function' ? r.json() : Promise.resolve(r))));
	}

	static async waterfall(steps) {
		let result;
		for (const step of steps) {
			const builder = typeof step === 'function' ? step(result) : step;
			result = typeof builder?.then === 'function' ? await builder : await builder.json();
		}
		return result;
	}

	static async pool(requests, limit = 4) {
		const results = new Array(requests.length);
		let index = 0;
		const workerCount = Math.max(1, Math.min(Number.isFinite(limit) ? Math.floor(limit) : 4, requests.length));
		const run = async () => {
			while (index < requests.length) {
				const i = index++;
				const req = requests[i];
				try {
					results[i] = { ok: true, value: await (typeof req === 'function' ? req() : req) };
				} catch (e) {
					results[i] = { ok: false, error: e };
				}
			}
		};
		await Promise.all(Array.from({ length: workerCount }, run));
		return results;
	}

	static _default = null;
	static _optionKeys = new Set([
		'headers', 'timeout', 'signal', 'cache', 'credentials', 'mode',
		'responseType', 'retry', 'retryDelay', 'retryFactor', 'cacheTime',
		'onUploadProgress', 'onDownloadProgress', 'keepalive', 'redirect',
		'referrerPolicy', 'integrity', 'params'
	]);
	static _absUrlRe = /^https?:\/\//i;

	static default(baseURL, options) {
		if (baseURL || !MiniX_Request._default) {
			MiniX_Request._default = new MiniX_Request(baseURL || '', options);
		}
		return MiniX_Request._default;
	}

	static get(url, options) { return MiniX_Request.default().get(url, options); }
	static post(url, body, options) { return MiniX_Request.default().post(url, body, options); }
	static put(url, body, options) { return MiniX_Request.default().put(url, body, options); }
	static patch(url, body, options) { return MiniX_Request.default().patch(url, body, options); }
	static del(url, options) { return MiniX_Request.default().delete(url, options); }
	static head(url, options) { return MiniX_Request.default().head(url, options); }

	_resolveURL(url, params) {
		let resolved;
		const urlStr = String(url || '');
		if (MiniX_Request._absUrlRe.test(urlStr)) {
			resolved = urlStr;
		} else {
			const base = this._baseURL;
			resolved = base + (urlStr ? '/' + urlStr.replace(/^\/+/, '') : '');
		}
		if (params) {
			const qs = new URLSearchParams();
			let hasAny = false;
			for (const k in params) {
				const v = params[k];
				if (v === undefined || v === null) continue;
				
				if (Array.isArray(v)) {
					for (const item of v) {
						if (item !== undefined && item !== null) { qs.append(k, String(item)); hasAny = true; }
					}
				} else {
					qs.append(k, String(v)); hasAny = true;
				}
			}
			if (hasAny) resolved += (resolved.includes('?') ? '&' : '?') + qs.toString();
		}
		return resolved;
	}

	async _read(response, type) {
		if (type === 'response') return response;
		if (type === 'text') return response.text();
		if (type === 'blob') return response.blob();
		if (type === 'arrayBuffer') return response.arrayBuffer();

		const text = await response.text();
		if (!text) return null;
		try { return JSON.parse(text); }
		catch (_) { return text; }
	}

	async _safeRead(response, type) {
		try { return await this._read(response.clone ? response.clone() : response, type); }
		catch (_) { return null; }
	}

	_makeError(message, status, url, method, body, response) {
		const err = new Error(message);
		err.status = status;
		err.url = url;
		err.method = method;
		err.body = body;
		err.response = response;
		err.isHTTPError = true;
		return err;
	}

	async _trackDownload(response, onProgress) {
		const contentLength = response.headers.get('content-length');
		const total = contentLength ? parseInt(contentLength, 10) : 0;
		let loaded = 0;
		const reader = response.body.getReader();
		const chunks = [];
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				chunks.push(value);
				loaded += value.byteLength;
				try { onProgress({ loaded, total, percent: total ? Math.round(loaded / total * 100) : -1 }); }
				catch (_) { }
			}
		} catch (err) {
			reader.cancel().catch(() => {});
			throw err;
		}
		const merged = new Uint8Array(loaded);
		let offset = 0;
		for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
		return new Response(merged, { status: response.status, statusText: response.statusText, headers: response.headers });
	}

	_xhrFetch(url, { method, headers, body, credentials, signal, onUploadProgress, onDownloadProgress }) {
		return new Promise((resolve, reject) => {
			const xhr = new XMLHttpRequest();
			xhr.open(method, url, true);
			xhr.withCredentials = credentials === 'include';
			if (headers) {
				for (const k in headers) {
					try { xhr.setRequestHeader(k, headers[k]); } catch (_) { }
				}
			}

			if (onUploadProgress) {
				xhr.upload.addEventListener('progress', (e) => {
					try { onUploadProgress({ loaded: e.loaded, total: e.total, percent: e.total ? Math.round(e.loaded / e.total * 100) : -1 }); }
					catch (_) { }
				});
			}
			if (onDownloadProgress) {
				xhr.addEventListener('progress', (e) => {
					try { onDownloadProgress({ loaded: e.loaded, total: e.total, percent: e.total ? Math.round(e.loaded / e.total * 100) : -1 }); }
					catch (_) { }
				});
			}

			let abortHandler = null;
			if (signal) {
				abortHandler = () => xhr.abort();
				signal.addEventListener('abort', abortHandler, { once: true });
			}

			const removeAbortHandler = () => {
				if (abortHandler) signal.removeEventListener('abort', abortHandler);
			};

			xhr.responseType = 'arraybuffer';
			xhr.onload = () => {
				removeAbortHandler();
				const response = new Response(xhr.response, {
					status: xhr.status,
					statusText: xhr.statusText,
					headers: this._parseXHRHeaders(xhr.getAllResponseHeaders()),
				});
				resolve(response);
			};
			xhr.onerror = () => { removeAbortHandler(); reject(new TypeError('Network request failed')); };
			xhr.onabort = () => { removeAbortHandler(); reject(new DOMException('Aborted', 'AbortError')); };
			xhr.ontimeout = () => { removeAbortHandler(); reject(new TypeError('Request timed out')); };
			xhr.send(body ?? null);
		});
	}

	_parseXHRHeaders(raw) {
		const headers = new Headers();
		const lines = (raw || '').trim().split(/[\r\n]+/);
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const idx = line.indexOf(':');
			if (idx < 1) continue;
			const name = line.slice(0, idx).trim();
			const value = line.slice(idx + 1).trim();
			if (name) try { headers.set(name, value); } catch (_) { }
		}
		return headers;
	}

	_anySignal(signals) {
		const ctrl = new AbortController();
		const sigs = [];
		let aborted = false;
		const abort = () => {
			if (aborted) return;
			aborted = true;
			for (let i = 0; i < sigs.length; i++) sigs[i].removeEventListener('abort', abort);
			sigs.length = 0;
			ctrl.abort();
		};
		for (const s of signals) {
			if (s.aborted) { abort(); break; }
			sigs.push(s);
			s.addEventListener('abort', abort, { once: true });
		}
		const cleanup = () => {
			if (aborted) return;
			for (let i = 0; i < sigs.length; i++) sigs[i].removeEventListener('abort', abort);
			sigs.length = 0;
		};
		return { signal: ctrl.signal, cleanup };
	}

	_sleep(ms, signal) {
		return new Promise((resolve, reject) => {
			let id;
			let onAbort;
			const cleanup = () => {
				if (signal && onAbort) signal.removeEventListener('abort', onAbort);
			};
			id = setTimeout(() => { cleanup(); resolve(); }, ms);
			
			
			if (signal) {
				if (signal.aborted) { clearTimeout(id); return reject(new DOMException('Aborted', 'AbortError')); }
				onAbort = () => { clearTimeout(id); cleanup(); reject(new DOMException('Aborted', 'AbortError')); };
				signal.addEventListener('abort', onAbort, { once: true });
			}
		});
	}
}

