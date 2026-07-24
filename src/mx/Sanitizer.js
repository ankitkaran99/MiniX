class MiniX_Sanitizer {
	constructor(options = {}) {
		this.options = {



			allowedTags: [

				'main', 'section', 'article', 'aside', 'header', 'footer', 'nav', 'details', 'summary',

				'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
				'p', 'span', 'div', 'a', 'abbr', 'b', 'i', 'em', 'strong', 'small', 'mark', 'del', 'ins',
				'sub', 'sup', 'blockquote', 'q', 'cite', 'pre', 'code', 'kbd', 'samp', 'var', 'br', 'hr',
				'time', 'address',

				'ul', 'ol', 'li', 'dl', 'dt', 'dd',

				'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',

				'form', 'fieldset', 'legend', 'label', 'input', 'textarea', 'select', 'option',
				'optgroup', 'button', 'datalist', 'output', 'progress', 'meter',

				'img', 'figure', 'figcaption', 'picture', 'source', 'audio', 'video', 'track',

				'template', 'slot',
			],
			allowedAttributes: {

				'*': ['class', 'id', 'style', 'title', 'lang', 'dir', 'hidden', 'tabindex',
					'aria-label', 'aria-labelledby', 'aria-describedby', 'aria-hidden',
					'aria-expanded', 'aria-controls', 'aria-live', 'aria-atomic',
					'aria-checked', 'aria-disabled', 'aria-selected', 'aria-pressed',
					'role', 'data-*', 'x-*', '@*', ':*'],
				a: ['href', 'title', 'target', 'rel', 'download'],
				img: ['src', 'alt', 'width', 'height', 'loading', 'decoding', 'srcset', 'sizes'],
				input: ['type', 'name', 'value', 'placeholder', 'checked', 'disabled',
					'readonly', 'required', 'min', 'max', 'step', 'maxlength',
					'minlength', 'pattern', 'autocomplete', 'autofocus', 'multiple', 'accept'],
				textarea: ['name', 'placeholder', 'rows', 'cols', 'disabled', 'readonly',
					'required', 'maxlength', 'minlength', 'autocomplete', 'autofocus', 'wrap'],
				select: ['name', 'disabled', 'required', 'multiple', 'autofocus', 'size'],
				option: ['value', 'selected', 'disabled'],
				optgroup: ['label', 'disabled'],
				button: ['type', 'name', 'value', 'disabled', 'autofocus'],
				form: ['action', 'method', 'enctype', 'novalidate', 'autocomplete', 'target'],
				label: ['for'],
				fieldset: ['disabled', 'name'],
				table: ['summary', 'border', 'cellpadding', 'cellspacing'],
				th: ['scope', 'colspan', 'rowspan', 'abbr'],
				td: ['colspan', 'rowspan', 'headers'],
				col: ['span'],
				colgroup: ['span'],
				time: ['datetime'],
				track: ['kind', 'src', 'srclang', 'label', 'default'],
				source: ['src', 'srcset', 'sizes', 'type', 'media'],
				audio: ['src', 'controls', 'autoplay', 'loop', 'muted', 'preload'],
				video: ['src', 'controls', 'autoplay', 'loop', 'muted', 'preload',
					'width', 'height', 'poster', 'playsinline'],
				details: ['open'],
				meter: ['value', 'min', 'max', 'low', 'high', 'optimum'],
				progress: ['value', 'max'],
				template: ['x-for', ':key', 'x-bind:key'],
				slot: ['name'],
			},
			...options
		};
	}
	static _UNSAFE_URL_ATTRS = new Set(['href', 'src', 'xlink:href', 'action', 'formaction', 'data']);
	hasDOMPurify() { return typeof window !== 'undefined' && typeof window.DOMPurify !== 'undefined'; }

	_buildAttrLookup(allowedAttributes) {
		if (this._attrLookupCache && this._attrLookupRef === allowedAttributes) {
			return this._attrLookupCache;
		}
		const lookup = {};
		for (const [tag, attrs] of Object.entries(allowedAttributes)) {
			const exact = new Set();
			const wildcards = [];
			for (const pattern of attrs) {
				if (pattern.endsWith('*')) wildcards.push(pattern.slice(0, -1));
				else exact.add(pattern);
			}
			lookup[tag] = { exact, wildcards };
		}
		this._attrLookupRef = allowedAttributes;
		this._attrLookupCache = lookup;
		return lookup;
	}

	_buildTagSet(allowedTags) {
		if (this._tagSetCache && this._tagSetRef === allowedTags) return this._tagSetCache;
		this._tagSetRef = allowedTags;
		this._tagSetCache = new Set(allowedTags);
		return this._tagSetCache;
	}

	sanitize(html, config = {}) {
		const input = String(html ?? '');
		if (this.hasDOMPurify()) {
			const allowedTags = config.allowedTags || this.options.allowedTags || [];
			const allowedAttributes = config.allowedAttributes || this.options.allowedAttributes || {};

			// Cache the addTags array and addAttr Set as long as the config references haven't changed.
			if (this._sanitizeTagsRef !== allowedTags || this._sanitizeAttrRef !== allowedAttributes) {
				this._sanitizeTagsRef = allowedTags;
				this._sanitizeAttrRef = allowedAttributes;
				this._sanitizeAddTags = Array.from(new Set(allowedTags.filter((tag) => typeof tag === 'string' && tag && !tag.includes('*'))));
				// Pre-build the merged ADD_TAGS array (no config.ADD_TAGS yet — merged at call time only when needed).
				this._sanitizeMergedAddTags = this._sanitizeAddTags.slice();
				const addAttr = new Set();
				for (const attrs of Object.values(allowedAttributes)) {
					for (const attr of (Array.isArray(attrs) ? attrs : [])) {
						if (typeof attr !== 'string' || !attr || attr.includes('*')) continue;
						addAttr.add(attr);
					}
				}
				this._sanitizeAddAttr = addAttr;
			}
			const addTags = this._sanitizeAddTags;
			const addAttr = this._sanitizeAddAttr;
			const merged = {
				...config,
				ADD_TAGS: Array.isArray(config.ADD_TAGS) && config.ADD_TAGS.length
					? [...new Set([...config.ADD_TAGS, ...addTags])]
					: this._sanitizeMergedAddTags,
				ADD_ATTR: (attributeName, tagName) => {
					if (typeof config.ADD_ATTR === 'function' && config.ADD_ATTR(attributeName, tagName)) return true;
					if (Array.isArray(config.ADD_ATTR) && config.ADD_ATTR.includes(attributeName)) return true;
					if (addAttr.has(attributeName)) return true;
					if (/^(data-|aria-)/.test(attributeName)) return true;
					if (/^(x-|@|:)/.test(attributeName)) return true;
					return false;
				},
				CUSTOM_ELEMENT_HANDLING: {
					tagNameCheck: (tagName) => {
						const custom = config.CUSTOM_ELEMENT_HANDLING?.tagNameCheck;
						if (custom instanceof RegExp) return custom.test(tagName);
						if (typeof custom === 'function') return !!custom(tagName);
						return false;
					},
					attributeNameCheck: (attr, tagName) => {
						const custom = config.CUSTOM_ELEMENT_HANDLING?.attributeNameCheck;
						if (custom instanceof RegExp && custom.test(attr)) return true;
						if (typeof custom === 'function' && custom(attr, tagName)) return true;
						if (addAttr.has(attr)) return true;
						if (/^(data-|aria-)/.test(attr)) return true;
						if (/^(x-|@|:)/.test(attr)) return true;
						return false;
					},
					allowCustomizedBuiltInElements: config.CUSTOM_ELEMENT_HANDLING?.allowCustomizedBuiltInElements ?? false,
				},
			};
			return window.DOMPurify.sanitize(input, merged);
		}
		return this._fallback(input, config);
	}
	escapeHTML(value) {
		return String(value).replace(/[&<>"']/g, (ch) => {
			switch (ch) {
				case '&': return '&amp;';
				case '<': return '&lt;';
				case '>': return '&gt;';
				case '"': return '&quot;';
				default:  return '&#039;';
			}
		});
	}
	_fallback(html, config = {}) {
		if (typeof document === 'undefined' || !document.createElement) {
			return this.escapeHTML(html);
		}
		const allowedTags = config.allowedTags || this.options.allowedTags;
		const allowedAttributes = config.allowedAttributes || this.options.allowedAttributes;

		const tagSet = this._buildTagSet(allowedTags);
		const attrLookup = this._buildAttrLookup(allowedAttributes);
		const globalLookup = attrLookup['*'] || { exact: new Set(), wildcards: [] };

		const isAttrAllowed = (tag, attrName) => {
			const tagLookup = attrLookup[tag] || { exact: new Set(), wildcards: [] };
			if (globalLookup.exact.has(attrName) || tagLookup.exact.has(attrName)) return true;
			for (const prefix of globalLookup.wildcards) { if (attrName.startsWith(prefix)) return true; }
			for (const prefix of tagLookup.wildcards) { if (attrName.startsWith(prefix)) return true; }
			return false;
		};

		const template = document.createElement('template');
		template.innerHTML = html;
		const clean = (node) => {
			if (node.nodeType === Node.TEXT_NODE) return;
			if (node.nodeType !== Node.ELEMENT_NODE) { node.remove(); return; }
			const tag = node.tagName.toLowerCase();
			if (!tagSet.has(tag)) {
				node.replaceWith(document.createTextNode(node.textContent || ''));
				return;
			}
			// Iterate attributes in reverse — removing during forward iteration shifts indices.
			const attrs = node.attributes;
			for (let i = attrs.length - 1; i >= 0; i--) {
				const attr = attrs[i];
				const attrName = attr.name.toLowerCase();
				const attrValue = String(attr.value || '').trim();
				const unsafeUrlAttr = MiniX_Sanitizer._UNSAFE_URL_ATTRS.has(attrName) && /^(javascript:|data:text\/html)/i.test(attrValue);
				const unsafeStyle = attrName === 'style' && /url\s*\(\s*(['"]?)\s*javascript:|expression\s*\(/i.test(attrValue);
				if (!isAttrAllowed(tag, attrName) || unsafeUrlAttr || unsafeStyle) node.removeAttribute(attr.name);
			}
			// Iterate childNodes in reverse — same reason as attributes.
			const children = node.childNodes;
			for (let i = children.length - 1; i >= 0; i--) clean(children[i]);
		};
		const rootChildren = template.content.childNodes;
		for (let i = rootChildren.length - 1; i >= 0; i--) clean(rootChildren[i]);
		return template.innerHTML;
	}
}

