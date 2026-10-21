// Applies patches.json to upstream's minified bundles. Each upstream release
// renames most minified variables (`at("03zsvda5")` became `rt("03zsvda5")`
// in 9.9.1), so an anchor that no longer matches verbatim is retried with the
// minifier's names as wildcards, and its replacement is rewritten to the new
// names.

export type Patch = {
	group: string;
	file: string;
	find: string;
	replace?: string;
	why: string;
};

export type Applied = {
	src: string;
	// The patch as it matched this build: unchanged when its anchor matched
	// verbatim, otherwise with the new names in `find` and `replace`.
	patch: Patch;
	renames: Map<string, string>;
};

// Every name the minifier assigns in these bundles is 1–3 characters long.
// These are the 1–3 character words that are never its names.
const RESERVED = new Set([
	"do",
	"if",
	"in",
	"of",
	"for",
	"get",
	"let",
	"new",
	"set",
	"try",
	"var",
	"NaN",
	"Map",
	"Set",
	"URL",
	"top",
]);

// Words after which a `/` starts a regular expression, not a division.
const BEFORE_EXPRESSION = new Set([
	"await",
	"case",
	"delete",
	"do",
	"else",
	"in",
	"instanceof",
	"new",
	"of",
	"return",
	"throw",
	"typeof",
	"void",
	"yield",
]);

type Ident = { name: string; start: number; end: number; mangled: boolean };

// Identifier tokens of a minified fragment, which may start or end mid-
// statement. `mangled` marks names the minifier chose: 1–3 characters, not a
// reserved word, not after `.` or `?.`, and not an object key. Property names,
// keys, strings and longer globals keep their spelling across releases.
export function identifiers(code: string): Ident[] {
	const out: Ident[] = [];
	// One entry per open `{`: true when it is a template's `${`.
	const braces: boolean[] = [];
	// The previous token: a punctuator, "x" for an operand, or "kw" for a word
	// in BEFORE_EXPRESSION.
	let prev = "";
	let i = 0;
	const n = code.length;
	const nextChar = (from: number) => code.slice(from).match(/\S/)?.[0];
	// Skips template text up to its closing backtick or next `${`.
	const template = () => {
		while (i < n) {
			if (code[i] === "\\") i += 2;
			else if (code[i] === "`") {
				i++;
				prev = "x";
				return;
			} else if (code[i] === "$" && code[i + 1] === "{") {
				i += 2;
				braces.push(true);
				prev = "{";
				return;
			} else i++;
		}
	};
	while (i < n) {
		const c = code[i];
		if (/\s/.test(c)) i++;
		else if (code.startsWith("/*", i)) {
			const end = code.indexOf("*/", i + 2);
			i = end < 0 ? n : end + 2;
		} else if (code.startsWith("//", i)) {
			const end = code.indexOf("\n", i);
			i = end < 0 ? n : end;
		} else if (c === '"' || c === "'") {
			i++;
			while (i < n && code[i] !== c) i += code[i] === "\\" ? 2 : 1;
			i++;
			prev = "x";
		} else if (c === "`") {
			i++;
			template();
		} else if (
			c === "/" &&
			(prev === "" || prev === "kw" || (prev !== "x" && !")]}".includes(prev)))
		) {
			let inClass = false;
			for (i++; i < n; i++) {
				if (code[i] === "\\") i++;
				else if (code[i] === "[") inClass = true;
				else if (code[i] === "]") inClass = false;
				else if (code[i] === "/" && !inClass) break;
			}
			i++;
			while (i < n && /[a-z]/.test(code[i])) i++;
			prev = "x";
		} else if (/\d/.test(c) || (c === "." && /\d/.test(code[i + 1] ?? ""))) {
			while (i < n && /[\w.]/.test(code[i])) i++;
			prev = "x";
		} else if (/[A-Za-z_$#]/.test(c)) {
			let j = i + 1;
			while (j < n && /[\w$]/.test(code[j])) j++;
			const name = code.slice(i, j);
			if (c !== "#") {
				const key = (prev === "{" || prev === ",") && nextChar(j) === ":";
				out.push({
					name,
					start: i,
					end: j,
					mangled:
						name.length <= 3 && !RESERVED.has(name) && prev !== "." && !key,
				});
			}
			prev = BEFORE_EXPRESSION.has(name) ? "kw" : "x";
			i = j;
		} else if (c === "?" && code[i + 1] === "." && !/\d/.test(code[i + 2])) {
			prev = ".";
			i += 2;
		} else {
			if (c === "{") braces.push(false);
			i++;
			if (c === "}" && braces.pop()) template();
			else prev = c;
		}
	}
	return out;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

// A regular expression matching `find` with each minified name replaced by a
// fresh 1–3 character name. Repeats of a name must get the same new name.
function pattern(find: string) {
	const names: string[] = [];
	let src = /^[\w$]/.test(find) ? "(?<![\\w$])" : "";
	let pos = 0;
	for (const t of identifiers(find)) {
		if (!t.mangled) continue;
		src += escapeRegExp(find.slice(pos, t.start));
		let k = names.indexOf(t.name);
		if (k < 0) {
			k = names.push(t.name) - 1;
			src += `(?<![\\w$])(?<n${k}>[A-Za-z_$][\\w$]{0,2})(?![\\w$])`;
		} else src += `(?<![\\w$])\\k<n${k}>(?![\\w$])`;
		pos = t.end;
	}
	src += escapeRegExp(find.slice(pos));
	if (/[\w$]$/.test(find)) src += "(?![\\w$])";
	return { re: new RegExp(src, "g"), names };
}

// Renames the minified names in `code`, all at once.
function rename(code: string, renames: Map<string, string>) {
	let out = "";
	let pos = 0;
	for (const t of identifiers(code)) {
		const to = t.mangled && renames.get(t.name);
		if (!to) continue;
		out += code.slice(pos, t.start) + to;
		pos = t.end;
	}
	return out + code.slice(pos);
}

// Applies `patch` to `src`. Its anchor must match exactly once, verbatim or
// under renamed minified names. A renamed match is refused if the replacement
// uses a minified name the anchor doesn't contain, since nothing says what that
// name became.
export function applyPatch(src: string, patch: Patch): Applied | string {
	const { find, replace } = patch;
	const verbatim = src.split(find).length - 1;
	if (verbatim === 1)
		return {
			src: replace === undefined ? src : src.replace(find, () => replace),
			patch,
			renames: new Map(),
		};

	const { re, names } = pattern(find);
	const hits = [...src.matchAll(re)].filter((m) => {
		const bound = names.map((_, k) => m.groups?.[`n${k}`] ?? "");
		return (
			!bound.some((b) => RESERVED.has(b)) &&
			new Set(bound).size === bound.length
		);
	});
	if (hits.length !== 1)
		return `anchor matched ${hits.length} times${verbatim ? " (verbatim)" : ""}`;

	const [hit] = hits;
	const renames = new Map<string, string>();
	names.forEach((name, k) => {
		const to = hit.groups?.[`n${k}`];
		if (to && to !== name) renames.set(name, to);
	});
	const unpinned = new Set(
		identifiers(replace ?? "")
			.filter((t) => t.mangled && !names.includes(t.name))
			.map((t) => t.name),
	);
	if (renames.size && unpinned.size)
		return `anchor matched with renamed ${describe(renames)}, but the replacement also uses ${[...unpinned].join(", ")}, which the anchor doesn't contain`;

	const at = hit.index ?? 0;
	const moved = {
		...patch,
		find: hit[0],
		...(replace === undefined ? {} : { replace: rename(replace, renames) }),
	};
	return {
		src:
			src.slice(0, at) +
			(moved.replace ?? hit[0]) +
			src.slice(at + hit[0].length),
		patch: moved,
		renames,
	};
}

export const describe = (renames: Map<string, string>) =>
	[...renames].map(([from, to]) => `${from}→${to}`).join(", ");
