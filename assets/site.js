/*
  Site behavior. You shouldn't need to edit this file.
  Settings live in index.html (window.SITE), publications in the BibTeX block
  at the end of index.html, and citation numbers in data/scholar.js.

  What it does:
  - Builds the publication list from BibTeX (venue labels, filters, awards,
    artifact badges, links, abstracts, copyable BibTeX, citation counts)
  - Turns <span data-cite="key1, key2"> into links to those publications
  - Shows Google Scholar stats and a citations-per-year chart
  - Adds GitHub star counts to anything with data-repo="owner/name"
  - Loads YouTube videos only when clicked (data-youtube="VIDEO_ID")
  - Collapses older news items and highlights the current section in the menu
*/
(function () {
    "use strict";

    var G = typeof window !== "undefined" ? window : {};
    var SITE = Object.assign(
        { myName: null, authorStyle: "full", newsLimit: 5, scholarUrl: "" },
        G.SITE || {}
    );
    var SCHOLAR = G.SCHOLAR_DATA || null;

    /* ------------------------------------------------------------------ */
    /* Small helpers                                                       */
    /* ------------------------------------------------------------------ */
    function $(sel, root) { return (root || document).querySelector(sel); }
    function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
    function esc(s) {
        return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
        });
    }
    function fold(s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); }
    function normTitle(s) { return fold(s).replace(/[^a-z0-9]+/g, ""); }
    function fmt(n) { return Number(n).toLocaleString("en-US"); }
    function safeUrl(u) {
        u = String(u || "").trim();
        return /^\s*(javascript|data|vbscript):/i.test(u) ? "#" : u;
    }
    function store(key, val) {
        try {
            if (val === undefined) {
                var raw = localStorage.getItem(key);
                if (!raw) return null;
                var o = JSON.parse(raw);
                return o && o.t > Date.now() - 6 * 3600 * 1000 ? o.v : null;
            }
            localStorage.setItem(key, JSON.stringify({ t: Date.now(), v: val }));
        } catch (e) { return null; }
    }

    /* ------------------------------------------------------------------ */
    /* BibTeX parser                                                       */
    /* ------------------------------------------------------------------ */
    var MONTHS = ["january", "february", "march", "april", "may", "june", "july",
        "august", "september", "october", "november", "december"];

    function parseBibtex(src) {
        var macros = {};
        MONTHS.forEach(function (m) { macros[m.slice(0, 3)] = m.charAt(0).toUpperCase() + m.slice(1); });
        var entries = [];
        var pos = 0;
        while (true) {
            var at = src.indexOf("@", pos);
            if (at === -1) break;
            pos = at + 1;
            var head = /^\s*([A-Za-z]+)\s*([{(])/.exec(src.slice(pos, pos + 80));
            if (!head) continue;
            var type = head[1].toLowerCase();
            var closer = head[2] === "{" ? "}" : ")";
            pos += head[0].length;
            var start = pos, depth = 0, j = pos;
            for (; j < src.length; j++) {
                var c = src[j];
                if (c === "{") depth++;
                    else if (c === "}") { if (depth === 0 && closer === "}") break; depth--; }
                    else if (c === ")" && closer === ")" && depth === 0) break;
            }
            var body = src.slice(start, j);
            pos = j + 1;
            if (type === "comment" || type === "preamble") continue;
            if (type === "string") {
                var s = parseFields(body, macros);
                Object.keys(s.fields).forEach(function (k) { macros[k] = s.fields[k]; });
                continue;
            }
            var comma = body.indexOf(",");
            if (comma === -1) continue;
            var key = body.slice(0, comma).trim();
            var parsed = parseFields(body.slice(comma + 1), macros);
            entries.push({ type: type, key: key, fields: parsed.fields, raw: parsed.raw, order: entries.length });
        }
        return entries;
    }

    function parseFields(s, macros) {
        var fields = {}, raw = {}, order = [];
        var p = 0;
        function skipWs() { while (p < s.length && /\s/.test(s[p])) p++; }
        while (p < s.length) {
            while (p < s.length && /[\s,]/.test(s[p])) p++;
            if (p >= s.length) break;
            var nm = /^([A-Za-z0-9_\-:.+]+)\s*=\s*/.exec(s.slice(p));
            if (!nm) break;
            var name = nm[1].toLowerCase();
            p += nm[0].length;
            var vStart = p, val = "";
            while (p < s.length) {
                skipWs();
                var c = s[p];
                if (c === "{") {
                    var d = 0, q = p;
                    for (; q < s.length; q++) {
                        if (s[q] === "{") d++;
                            else if (s[q] === "}") { d--; if (d === 0) break; }
                    }
                    val += s.slice(p + 1, q);
                    p = q + 1;
                } else if (c === '"') {
                    var d2 = 0, r = p + 1;
                    for (; r < s.length; r++) {
                        if (s[r] === "{") d2++;
                            else if (s[r] === "}") d2--;
                                else if (s[r] === '"' && d2 === 0) break;
                    }
                    val += s.slice(p + 1, r);
                    p = r + 1;
                } else {
                    var w = /^[A-Za-z0-9_\-:.+\/]+/.exec(s.slice(p));
                    if (!w) break;
                    var tok = w[0];
                    val += Object.prototype.hasOwnProperty.call(macros, tok.toLowerCase()) ? macros[tok.toLowerCase()] : tok;
                    p += tok.length;
                }
                skipWs();
                if (s[p] === "#") { p++; continue; }
                break;
            }
            fields[name] = val;
            raw[name] = s.slice(vStart, p).trim();
            order.push(name);
        }
        raw.__order = order;
        return { fields: fields, raw: raw };
    }

    /* LaTeX to plain text (accents, escapes, dashes, quotes) */
    var ACCENTS = { "'": "́", "`": "̀", "^": "̂", '"': "̈", "~": "̃",
        "=": "̄", ".": "̇", u: "̆", v: "̌", H: "̋", c: "̧",
        k: "̨", r: "̊", d: "̣", b: "̱" };
    var SPECIAL = { ss: "ß", o: "ø", O: "Ø", ae: "æ", AE: "Æ", oe: "œ",
        OE: "Œ", aa: "å", AA: "Å", l: "ł", L: "Ł" };
    var GREEK = { alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε",
        theta: "θ", lambda: "λ", mu: "μ", pi: "π", sigma: "σ", tau: "τ",
        phi: "φ", omega: "ω", Delta: "Δ", Sigma: "Σ", Omega: "Ω" };

    function latexToText(s) {
        if (!s) return "";
        var t = String(s);
        t = t.replace(/\\\\/g, " ");
        t = t.replace(/\\\{/g, "").replace(/\\\}/g, "").replace(/\\\$/g, "");
        t = t.replace(/\\([&%#_])/g, "$1");
        t = t.replace(/\\[,;:! ]/g, " ");
        t = t.replace(/\\([ij])(?![A-Za-z])\s*/g, "$1");
        t = t.replace(/\\(['`^"~=.])\s*(?:\{\s*([A-Za-z])\s*\}|([A-Za-z]))/g, function (m, a, x, y) {
            return (x || y) + ACCENTS[a];
        });
        t = t.replace(/\\([uvHckrdb])(?:\s*\{\s*([A-Za-z])\s*\}|\s+([A-Za-z]))/g, function (m, a, x, y) {
            return (x || y) + ACCENTS[a];
        });
        t = t.replace(/\\(ss|ae|AE|oe|OE|aa|AA|o|O|l|L)(?![A-Za-z])\s*/g, function (m, c) { return SPECIAL[c]; });
        t = t.replace(/\\([A-Za-z]+)(?![A-Za-z])\s*/g, function (m, name) { return GREEK[name] || ""; });
        t = t.replace(/---/g, "—").replace(/--/g, "–");
        t = t.replace(/``/g, "“").replace(/''/g, "”").replace(/`/g, "‘");
        t = t.replace(/~/g, " ").replace(/\$/g, "").replace(/[{}]/g, "");
        t = t.replace(//g, "{").replace(//g, "}").replace(//g, "$");
        return t.replace(/\s+/g, " ").trim().normalize("NFC");
    }

    function cleanUrl(v) {
        return String(v || "").replace(/\\url\s*/g, "").replace(/\\([_%&#~])/g, "$1").replace(/[{}]/g, "").trim();
    }

    /* Split at top level (outside braces) on a sticky regex separator */
    function splitTop(s, sep) {
        var parts = [], depth = 0, last = 0;
        for (var i = 0; i < s.length; i++) {
            var c = s[i];
            if (c === "{") depth++;
                else if (c === "}") depth--;
                    else if (depth === 0) {
                        sep.lastIndex = i;
                        var m = sep.exec(s);
                        if (m) { parts.push(s.slice(last, i)); i += m[0].length - 1; last = i + 1; }
                    }
        }
        parts.push(s.slice(last));
        return parts.map(function (x) { return x.trim(); }).filter(Boolean);
    }

    function parseName(raw) {
        if (/^\s*others\s*$/i.test(raw)) return { others: true };
        var parts = splitTop(raw, /,/y), first = "", last = "", jr = "";
        if (parts.length === 1) {
            var words = splitTop(parts[0], /\s+/y);
            if (words.length === 1) { last = words[0]; }
            else {
                var k = words.length - 1;
                while (k - 1 > 0 && /^[a-z]/.test(latexToText(words[k - 1]))) k--;
                first = words.slice(0, k).join(" ");
                last = words.slice(k).join(" ");
            }
        } else if (parts.length === 2) { last = parts[0]; first = parts[1]; }
        else { last = parts[0]; jr = parts[1]; first = parts.slice(2).join(" "); }
        return { first: latexToText(first), last: latexToText(last), jr: latexToText(jr) };
    }

    function initials(first) {
        return first.split(/\s+/).filter(Boolean).map(function (w) {
            return w.split("-").map(function (p) {
                var ch = Array.from(p)[0] || "";
                return /[A-Za-zÀ-ɏ]/.test(ch) ? ch + "." : p;
            }).join("-");
        }).join(" ");
    }

    function displayName(n) {
        var first = SITE.authorStyle === "initials" && n.first ? initials(n.first) : n.first;
        return (first ? first + " " : "") + n.last + (n.jr ? ", " + n.jr : "");
    }

    function isMe(n) {
        var me = SITE.myName;
        if (!me || !me.last || n.others) return false;
        if (fold(n.last) !== fold(me.last)) return false;
        if (!n.first || !me.first) return true;
        return fold(n.first).charAt(0) === fold(me.first).charAt(0);
    }

    function nameSet(v) {
        var set = {};
        latexToText(v || "").split(/\s*(?:[;,]|\band\b)\s*/i).forEach(function (x) {
            x = fold(x).trim();
            if (x) set[x] = true;
        });
        return set;
    }

    /* ------------------------------------------------------------------ */
    /* Publication model                                                   */
    /* ------------------------------------------------------------------ */
    var KIND_LABEL = { conference: "Conference", journal: "Journal", workshop: "Workshop", invited: "Invited",
        preprint: "Preprint", thesis: "Thesis", patent: "Patent", other: "Other" };
    var FILTER_LABEL = { conference: "Conference", journal: "Journal", workshop: "Workshop", invited: "Invited",
        preprint: "Preprints", thesis: "Theses", patent: "Patents", other: "Other" };
    var WEBSITE_FIELDS = ["abbr", "kind", "selected", "award", "pdf", "code", "dataset", "slides",
        "video", "poster", "artifacts", "equal", "mentees", "scholar", "abstract", "arxiv"];

    function kindOf(type, f) {
        if (f.kind) {
            var k = f.kind.toLowerCase().trim();
            return KIND_LABEL[k] ? k : "other";
        }
        var venue = latexToText(f.booktitle || f.journal || f.howpublished || f.publisher || "");
        if (/\barxiv\b|\bcorr\b|biorxiv|medrxiv|techrxiv|ssrn|cryptology e?print|\bpreprint\b/i.test(venue)) return "preprint";
        if (/workshop/i.test(venue)) return "workshop";
        switch (type) {
            case "inproceedings": case "conference": case "proceedings": case "incollection": return "conference";
            case "article": return venue ? "journal" : "preprint";
            case "phdthesis": case "mastersthesis": return "thesis";
            case "patent": return "patent";
            case "misc": case "unpublished": case "techreport": return "preprint";
            default: return "other";
        }
    }

    // Common ECE journals, so DBLP and Google Scholar exports get a short label
    // without an abbr field. Add abbr = {...} to any entry to override.
    var JOURNALS = [
        [/computer.?aided design of integrated circuits|comput\.? aided des\.? integr/i, "TCAD"],
        [/very large scale integration|trans\.? very large scale/i, "TVLSI"],
        [/transactions on computers$|trans\.? computers$/i, "TC"],
        [/design automation of electronic systems|trans\.? design autom/i, "TODAES"],
        [/information forensics and security|trans\.? inf\.? forensics/i, "TIFS"],
        [/dependable and secure computing|trans\.? dependable secur/i, "TDSC"],
        [/circuits and systems\s*(i|--\s*i|—\s*i):|circuits syst\.? i\b|circuits and systems i\b/i, "TCAS-I"],
        [/circuits and systems\s*(ii|--\s*ii|—\s*ii):|circuits syst\.? ii\b|circuits and systems ii\b/i, "TCAS-II"],
        [/journal of solid.?state circuits|j\.? solid.?state circuits/i, "JSSC"],
        [/architecture and code optimization|trans\.? archit\.? code optim/i, "TACO"],
        [/^ieee micro$/i, "IEEE Micro"],
        [/computer architecture letters|comput\.? archit\.? lett/i, "CAL"],
        [/embedded systems letters|embed\.? syst\.? lett/i, "ESL"],
        [/transactions on embedded computing|trans\.? embed\.? comput/i, "TECS"],
        [/hardware and systems security|j\.? hardw\.? syst\.? secur/i, "HaSS"],
        [/cryptographic hardware and embedded systems|tches/i, "TCHES"]
    ];

    var CONFERENCES = [
        [/usenix security/i, "USENIX Sec"],
        [/asia conference on computer and communications security|asia ?ccs/i, "AsiaCCS"],
        [/computer and communications security/i, "CCS"],
        [/dependable systems and networks/i, "DSN"],
        [/machine learning for cad/i, "MLCAD"],
        [/european test symposium/i, "ETS"],
        [/system.on.chip conference/i, "SOCC"],
        [/mixed design of integrated circuits/i, "MIXDES"],
        [/llm.aided design/i, "LAD"],
        [/symposium on security and privacy/i, "S&P"],
        [/network and distributed system security/i, "NDSS"],
        [/hardware.oriented security and trust/i, "HOST"],
        [/cryptographic hardware and embedded systems/i, "CHES"],
        [/international symposium on computer architecture/i, "ISCA"],
        [/symposium on microarchitecture/i, "MICRO"],
        [/architectural support for programming languages/i, "ASPLOS"],
        [/high.performance computer architecture/i, "HPCA"],
        [/asia and south pacific design automation/i, "ASP-DAC"],
        [/design,? automation (and|&) test in europe/i, "DATE"],
        [/international conference on computer.aided design/i, "ICCAD"],
        [/design automation conference/i, "DAC"],
        [/solid.state circuits conference/i, "ISSCC"],
        [/custom integrated circuits conference/i, "CICC"],
        [/field.programmable gate arrays/i, "FPGA"],
        [/field.programmable logic and applications/i, "FPL"],
        [/international test conference/i, "ITC"],
        [/vlsi test symposium/i, "VTS"],
        [/great lakes symposium on vlsi/i, "GLSVLSI"],
        [/international symposium on circuits and systems/i, "ISCAS"]
    ];

    function deriveAbbr(venue, kind) {
        if (kind === "preprint" && /arxiv|\bcorr\b/i.test(venue)) return "arXiv";
        var table = kind === "journal" ? JOURNALS : kind === "conference" || kind === "workshop" || kind === "invited" ? CONFERENCES : [];
        for (var i = 0; i < table.length; i++) if (table[i][0].test(venue)) return table[i][1];
        var m = venue.match(/\(([A-Z][A-Za-z0-9&+\-\/' ]{1,20})\)\s*$/) ||
            venue.match(/\(([A-Z][A-Z0-9&+\-\/']{1,12})(?:\s*'?\d{2,4})?\)/) ||
            venue.match(/\b([A-Z][A-Z0-9&+\-]{1,11})\s*'?(?:19|20)\d{2}\b/);
        if (m) return m[1].replace(/\s*'?\d{2,4}$/, "").trim();
        if (venue && venue.length <= 14) return venue;
        return KIND_LABEL[kind];
    }

    function monthNum(v) {
        if (!v) return 0;
        var n = parseInt(v, 10);
        if (n >= 1 && n <= 12) return n;
        var s = fold(latexToText(v)).slice(0, 3);
        for (var i = 0; i < 12; i++) if (MONTHS[i].slice(0, 3) === s) return i + 1;
        return 0;
    }

    function isTrue(v) { return /^(true|yes|1)$/i.test(String(v || "").trim()); }

    function buildPub(e) {
        var f = e.fields;
        var tx = function (k) { return latexToText(f[k] || ""); };
        var kind = kindOf(e.type, f);
        var venue = tx("booktitle") || tx("journal") || tx("howpublished") || tx("school") || tx("publisher");
        var authors = splitTop(f.author || "", /\s+and\s+/iy).map(parseName);
        var year = parseInt(String(f.year || "").replace(/[^\d]/g, ""), 10) || 0;
        var links = [];
        function add(label, url) {
            url = safeUrl(cleanUrl(url));
            if (url && !links.some(function (l) { return l.url === url; })) links.push({ label: label, url: url });
        }
        if (f.pdf) add("PDF", f.pdf);
        var arxivId = f.arxiv || ((/arxiv/i.test((f.archiveprefix || "") + (f.eprinttype || "")) && f.eprint) ? f.eprint : "");
        if (arxivId) add("arXiv", /^https?:/.test(cleanUrl(arxivId)) ? arxivId : "https://arxiv.org/abs/" + cleanUrl(arxivId));
        if (f.doi) add("DOI", "https://doi.org/" + cleanUrl(f.doi).replace(/^https?:\/\/(dx\.)?doi\.org\//i, ""));
        if (f.url && !/doi\.org|arxiv\.org\/abs/i.test(f.url)) add("Link", f.url);
        [["code", "Code"], ["dataset", "Dataset"], ["slides", "Slides"], ["video", "Video"], ["poster", "Poster"]]
            .forEach(function (x) { if (f[x[0]]) add(x[1], f[x[0]]); });

        var abbr = tx("abbr") || deriveAbbr(venue, kind);
        return {
            key: e.key,
            anchor: "pub-" + e.key.replace(/[^A-Za-z0-9_-]/g, "-"),
            type: e.type, kind: kind, f: f, tx: tx, order: e.order,
            title: tx("title"),
            authors: authors,
            year: year,
            month: monthNum(f.month),
            venue: venue,
            abbr: abbr,
            selected: isTrue(f.selected),
            awards: tx("award").split(/\s*;\s*/).filter(Boolean),
            artifacts: tx("artifacts"),
            equal: nameSet(f.equal),
            mentees: nameSet(f.mentees),
            links: links,
            abstract: tx("abstract"),
            bibtex: toBibtex(e)
        };
    }

    function toBibtex(e) {
        var names = (e.raw.__order || []).filter(function (n) { return WEBSITE_FIELDS.indexOf(n) === -1; });
        var width = names.reduce(function (w, n) { return Math.max(w, n.length); }, 0);
        var lines = names.map(function (n) {
            return "  " + n + new Array(width - n.length + 1).join(" ") + " = " + e.raw[n];
        });
        return "@" + e.type + "{" + e.key + ",\n" + lines.join(",\n") + "\n}";
    }

    /* ------------------------------------------------------------------ */
    /* Google Scholar matching                                             */
    /* ------------------------------------------------------------------ */
    var scholarPubs = (function () {
        if (!SCHOLAR || !Array.isArray(SCHOLAR.publications)) return null;
        var byId = {}, list = [];
        SCHOLAR.publications.forEach(function (p) {
            list.push({ n: normTitle(p.title), p: p });
            if (p.id) byId[p.id] = p;
        });
        return { byId: byId, list: list };
    })();

    function citationsFor(pub) {
        if (!scholarPubs) return null;
        var sid = cleanUrl(pub.f.scholar || "");
        if (sid) {
            if (/^(none|false|no)$/i.test(sid)) return null;
            return scholarPubs.byId[sid] ? scholarPubs.byId[sid].citations : null;
        }
        var n = normTitle(pub.title);
        if (n.length < 10) return null;
        var best = null;
        for (var i = 0; i < scholarPubs.list.length; i++) {
            var t = scholarPubs.list[i].n, c = scholarPubs.list[i].p.citations;
            if (t === n) return c;
            var shorter = t.length < n.length ? t : n, longer = t.length < n.length ? n : t;
            var close = (shorter.length >= 30 && longer.indexOf(shorter) === 0) ||
                (t.length >= 50 && n.length >= 50 && t.slice(0, 50) === n.slice(0, 50));
            if (close && (best === null || c > best)) best = c;
        }
        return best;
    }

    /* ------------------------------------------------------------------ */
    /* Rendering publications                                              */
    /* ------------------------------------------------------------------ */
    function authorsHtml(pub) {
        var names = pub.authors.filter(function (a) { return !a.others; });
        var etal = names.length < pub.authors.length;
        var html = names.map(function (a) {
            var marks = "";
            if (pub.equal[fold(a.last)]) marks += "*";
            if (pub.mentees[fold(a.last)]) marks += "†";
            var name = esc(displayName(a)).replace(/ /g, "&nbsp;");
            if (isMe(a)) name = '<span class="me">' + name + "</span>";
            return name + (marks ? "<sup>" + marks + "</sup>" : "");
        });
        var out;
        if (html.length <= 1) out = html.join("");
            else if (html.length === 2 && !etal) out = html.join(" and ");
                else out = etal ? html.join(", ") : html.slice(0, -1).join(", ") + ", and " + html[html.length - 1];
        return out + (etal ? " et&nbsp;al." : "");
    }

    function sentence(parts) {
        return parts.filter(Boolean).map(function (p) {
            return /[.?!]$/.test(p.replace(/<[^>]+>/g, "")) ? p : p + ".";
        }).join(" ");
    }

    function venueHtml(pub) {
        var tx = pub.tx, f = pub.f, parts = [];
        if (pub.type === "phdthesis" || pub.type === "mastersthesis") {
            parts.push((pub.type === "phdthesis" ? "Ph.D. dissertation" : "Master’s thesis") +
                (tx("school") ? ", " + esc(tx("school")) : ""));
        } else if (f.journal && /^corr$/i.test(tx("journal"))) {
            parts.push("<i>arXiv preprint</i>" + (f.eprint ? " arXiv:" + esc(cleanUrl(f.eprint)) : ""));
        } else if (f.journal) {
            var s = "<i>" + esc(tx("journal")) + "</i>";
            if (f.volume) s += ", vol.&nbsp;" + esc(tx("volume"));
            if (f.number) s += ", no.&nbsp;" + esc(tx("number"));
            if (f.pages) s += ", pp.&nbsp;" + esc(tx("pages"));
            parts.push(s);
        } else if (f.booktitle) {
            parts.push("<i>" + esc(tx("booktitle")) + "</i>");
        } else if (pub.venue) {
            parts.push(esc(pub.venue));
        }
        if (pub.kind === "preprint" && f.eprint && pub.venue.indexOf(cleanUrl(f.eprint)) === -1 && !/^corr$/i.test(pub.venue) &&
            /arxiv/i.test((f.archiveprefix || "") + (f.eprinttype || ""))) {
            parts.push("arXiv:" + esc(cleanUrl(f.eprint)));
        }
        if (f.note) parts.push(esc(tx("note")));
        return sentence(parts);
    }

    function pubHtml(pub) {
        var main = pub.links[0];
        var title = esc(pub.title);
        if (main) title = '<a href="' + esc(main.url) + '">' + title + "</a>";

        var flags = [];
        pub.awards.forEach(function (a) { flags.push('<span class="award">' + esc(a) + "</span>"); });
        if (pub.artifacts) flags.push('<span class="artifacts">Artifact evaluation: ' + esc(pub.artifacts.toLowerCase()) + "</span>");
        var cites = citationsFor(pub);
        if (cites) flags.push('<span class="cites">Cited by ' + fmt(cites) + "</span>");

        var id = pub.anchor;
        var links = pub.links.map(function (l) {
            return '<li><a href="' + esc(l.url) + '">' + esc(l.label) + "</a></li>";
        });
        if (pub.abstract) links.push('<li><button type="button" class="toggle" aria-expanded="false" aria-controls="' + id + '-abs">Abstract</button></li>');
        links.push('<li><button type="button" class="toggle" aria-expanded="false" aria-controls="' + id + '-bib">BibTeX</button></li>');

        return '' +
            '<p class="venue">' + esc(pub.abbr) + (pub.year ? '<span class="yr">' + pub.year + "</span>" : "") + "</p>" +
            '<div class="pub-body">' +
            '<h3 class="pub-title">' + title + "</h3>" +
            (pub.authors.length ? '<p class="authors">' + authorsHtml(pub) + "</p>" : "") +
            '<p class="pub-venue">' + venueHtml(pub) + "</p>" +
            (flags.length ? '<p class="pub-flags">' + flags.join("") + "</p>" : "") +
            '<ul class="links">' + links.join("") + "</ul>" +
            (pub.abstract ? '<div class="panel abstract" id="' + id + '-abs" hidden><p>' + esc(pub.abstract) + "</p></div>" : "") +
            '<div class="panel bib" id="' + id + '-bib" hidden><pre>' + esc(pub.bibtex) + '</pre>' +
            '<button type="button" class="copy">Copy BibTeX</button></div>' +
            "</div>";
    }

    var pubsByKey = {};
    var pubsList = [];
    var currentFilter = "all";

    // Reads the .bib file named in SITE.bibFile (default "publications.bib").
    // If it can't be fetched, which happens when index.html is opened straight
    // from disk, it falls back to a BibTeX block in index.html if there is one.
    function loadBibliography() {
        var inline = $("#bibliography");
        var fallback = inline ? inline.textContent : "";
        var file = SITE.bibFile === undefined ? "data/publications.bib" : SITE.bibFile;
        if (!file) return Promise.resolve(fallback);
        return fetch(file, { cache: "no-cache" })
            .then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
            .catch(function () { return fallback; });
    }

    function renderPublications(bibText) {
        var list = $("#pub-list");
        if (!list) return;
        var pubs = parseBibtex(bibText || "").map(buildPub);
        if (!pubs.length) {
            list.innerHTML = location.protocol === "file:"
                ? '<li class="empty">Publications load from publications.bib, which browsers block for pages opened from disk. Preview the site with a local server instead (see the README).</li>'
                : '<li class="empty">No publications found. Check that publications.bib is next to index.html.</li>';
            return;
        }
        pubs.sort(function (a, b) {
            return (b.year - a.year) || (b.month - a.month) || (a.order - b.order);
        });
        pubsList = pubs;
        var frag = document.createDocumentFragment();
        pubs.forEach(function (p) {
            pubsByKey[p.key] = p;
            var li = document.createElement("li");
            li.id = p.anchor;
            li.className = "pub";
            li.setAttribute("data-kind", p.kind);
            if (p.selected) li.setAttribute("data-selected", "");
            li.innerHTML = pubHtml(p);
            frag.appendChild(li);
        });
        list.innerHTML = "";
        list.appendChild(frag);

        // Legend for * and dagger marks
        var legend = $("#pub-legend");
        var hasEq = pubs.some(function (p) { return Object.keys(p.equal).length; });
        var hasMt = pubs.some(function (p) { return Object.keys(p.mentees).length; });
        if (legend && (hasEq || hasMt)) {
            legend.innerHTML = (hasEq ? "<span><sup>*</sup>&#8202;Equal contribution</span>" : "") +
                (hasMt ? "<span><sup>†</sup>&#8202;Student I mentored</span>" : "");
            legend.hidden = false;
        }

        buildFilters(pubs);
    }

    function buildFilters(pubs) {
        var bar = $("#pub-filters");
        if (!bar) return;
        var counts = { all: pubs.length, selected: 0 };
        pubs.forEach(function (p) {
            counts[p.kind] = (counts[p.kind] || 0) + 1;
            if (p.selected) counts.selected++;
        });
        var kinds = Object.keys(FILTER_LABEL).filter(function (k) { return counts[k]; });
        if (kinds.length < 2 && !counts.selected) return;
        var opts = [["all", "All"]];
        if (counts.selected) opts.push(["selected", "Selected"]);
        kinds.forEach(function (k) { opts.push([k, FILTER_LABEL[k]]); });
        bar.innerHTML = opts.map(function (o) {
            return '<button type="button" data-filter="' + o[0] + '" aria-pressed="false">' + o[1] +
                ' <span class="n">' + counts[o[0]] + "</span></button>";
        }).join("");
        bar.hidden = false;
        bar.addEventListener("click", function (e) {
            var b = e.target.closest("button[data-filter]");
            if (b) applyFilter(b.getAttribute("data-filter"), true);
        });
        applyFilter(SITE.pubFilter || "all", false);
    }

    function applyFilter(filter, announce) {
        currentFilter = filter;
        var shown = 0;
        $$("#pub-list > li.pub").forEach(function (li) {
            var show = filter === "all" ||
                (filter === "selected" ? li.hasAttribute("data-selected") : li.getAttribute("data-kind") === filter);
            li.hidden = !show;
            if (show) shown++;
        });
        $$("#pub-filters button").forEach(function (b) {
            b.setAttribute("aria-pressed", String(b.getAttribute("data-filter") === filter));
        });
        var status = $("#pub-status");
        if (status && announce) status.textContent = "Showing " + shown + " publication" + (shown === 1 ? "" : "s") + ".";
    }

    function wirePublicationEvents() {
        document.addEventListener("click", function (e) {
            var t = e.target.closest(".toggle");
            if (t) {
                var panel = document.getElementById(t.getAttribute("aria-controls"));
                var open = t.getAttribute("aria-expanded") === "true";
                t.setAttribute("aria-expanded", String(!open));
                if (panel) panel.hidden = open;
                return;
            }
            var c = e.target.closest(".copy");
            if (c) { copyBib(c); return; }
            var a = e.target.closest('a[href^="#pub-"]');
            if (a) {
                var li = document.getElementById(a.getAttribute("href").slice(1));
                if (li && li.hidden) applyFilter("all", true);
                if (li) setTimeout(function () { flash(li); }, 50);
            }
            var ca = e.target.closest('a[href^="#comp-"], a[href^="#tapeout-"]');
            if (ca) {
                var tr = document.getElementById(ca.getAttribute("href").slice(1));
                if (tr) setTimeout(function () { flash(tr); }, 50);
            }
        });
    }

    function copyBib(btn) {
        var pre = btn.parentNode.querySelector("pre");
        var text = pre.textContent;
        function done(ok) {
            btn.textContent = ok ? "Copied" : "Select the text above and copy it";
            setTimeout(function () { btn.textContent = "Copy BibTeX"; }, 2000);
        }
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(text).then(function () { done(true); }, function () { fallback(); });
        } else fallback();
        function fallback() {
            var range = document.createRange();
            range.selectNodeContents(pre);
            var sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
            var ok = false;
            try { ok = document.execCommand("copy"); } catch (err) { ok = false; }
            done(ok);
        }
    }

    function flash(el) {
        el.classList.remove("flash");
        void el.offsetWidth;
        el.classList.add("flash");
    }

    /* Research section: <span data-cite="key1, key2"> */
    function renderCitations() {
        $$("[data-cite]").forEach(function (el) {
            var keys = el.getAttribute("data-cite").split(/[\s,]+/).filter(Boolean);
            el.innerHTML = keys.map(function (k) {
                var p = pubsByKey[k];
                if (!p) return '<span class="cite-missing" title="No BibTeX entry with this key">' + esc(k) + "?</span>";
                return '<a href="#' + p.anchor + '">' + esc(p.abbr) + (p.year ? "&nbsp;" + p.year : "") + "</a>";
            }).join(", ");
        });
    }

    /* ------------------------------------------------------------------ */
    /* Google Scholar panel                                                */
    /* ------------------------------------------------------------------ */
    function renderScholar() {
        var panel = $("#scholar-panel");
        if (!panel || !SCHOLAR || SCHOLAR.citations == null) return;
        var cpy = SCHOLAR.cites_per_year || {};
        var years = Object.keys(cpy).map(Number).filter(Boolean).sort(function (a, b) { return a - b; }).slice(-8);
        var vals = years.map(function (y) { return Number(cpy[y]) || 0; });
        var max = Math.max.apply(null, [1].concat(vals));
        var maxIdx = vals.lastIndexOf(Math.max.apply(null, [0].concat(vals)));
        var thisYear = new Date().getFullYear();
        var profile = safeUrl(SCHOLAR.profile || SITE.scholarUrl || "https://scholar.google.com");

        var chart = "";
        if (years.length > 1) {
            var cols = years.map(function (y, i) {
                var v = vals[i];
                var label = y + (y === thisYear ? " (so far)" : "") + ": " + fmt(v) + " citation" + (v === 1 ? "" : "s");
                var h = v ? Math.max(4, Math.round(v / max * 100)) : 0;
                return '<div class="col" role="listitem" tabindex="0" aria-label="' + esc(label) + '" data-tip="' + esc(label) + '">' +
                    '<span class="bar" style="height:' + h + '%">' + (i === maxIdx && v ? '<span class="cap">' + fmt(v) + "</span>" : "") + "</span></div>";
            }).join("");
            chart = '<div class="cite-chart">' +
                '<div class="cols" role="list" aria-label="Citations per year">' + cols + "</div>" +
                '<div class="cite-axis" aria-hidden="true"><span>' + years[0] + "</span><span>" + years[years.length - 1] + "</span></div>" +
                '<div class="cite-tip" aria-hidden="true" hidden></div></div>';
        }

        var updated = "";
        if (SCHOLAR.updated) {
            var d = new Date(SCHOLAR.updated + "T12:00:00");
            if (!isNaN(d)) updated = ", updated " + d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
        }
        panel.innerHTML =
            '<dl class="scholar-stats">' +
                "<div><dt>Citations</dt><dd>" + fmt(SCHOLAR.citations) + "</dd></div>" +
                "<div><dt>h-index</dt><dd>" + fmt(SCHOLAR.h_index) + "</dd></div>" +
                "<div><dt>i10-index</dt><dd>" + fmt(SCHOLAR.i10_index) + "</dd></div>" +
                "</dl>" + chart +
                '<p class="scholar-note">' +
                (SCHOLAR.example ? '<strong class="example-flag">These are example numbers.</strong> They’re replaced with yours the first time the Scholar update runs. ' : "") +
                'From <a href="' + esc(profile) + '">Google Scholar</a>' + updated + ".</p>";
        panel.hidden = false;

        var tip = $(".cite-tip", panel), wrap = $(".cite-chart", panel);
        if (!tip) return;
        function show(col) {
            tip.textContent = col.getAttribute("data-tip");
            tip.hidden = false;
            var w = wrap.clientWidth, tw = tip.offsetWidth;
            var x = col.offsetLeft + col.offsetWidth / 2 - tw / 2;
            tip.style.left = Math.max(0, Math.min(w - tw, x)) + "px";
            $$(".col", panel).forEach(function (c) { c.classList.toggle("dim", c !== col); });
        }
        function hide() { tip.hidden = true; $$(".col", panel).forEach(function (c) { c.classList.remove("dim"); }); }
        $$(".col", panel).forEach(function (col) {
            col.addEventListener("pointerenter", function () { show(col); });
            col.addEventListener("focus", function () { show(col); });
            col.addEventListener("pointerleave", hide);
            col.addEventListener("blur", hide);
        });
    }

    /* ------------------------------------------------------------------ */
    /* Competition: team-count bars and running totals                     */
    /* ------------------------------------------------------------------ */
    var editions = [];

    function renderCompetition() {
        var table = $("#editions");
        if (!table) return;
        var rows = $$("tbody tr", table);
        var seen = {};
        editions = rows.map(function (r) {
            var ch = $(".ch", r);
            var when = parseWhen(r.getAttribute("data-when"));
            var year = parseInt(r.getAttribute("data-year") || (r.cells[0] && r.cells[0].textContent), 10) ||
                (when.length ? when[0].a.date.getUTCFullYear() : 0);
            if (year && !r.id) {
                seen[year] = (seen[year] || 0) + 1;
                r.id = "comp-" + year + (seen[year] > 1 ? "-" + seen[year] : "");
            }
            var first = ch && ch.firstChild;
            var title = first ? first.textContent.trim() : "";
            var url = r.getAttribute("data-url") || (first && first.nodeName === "A" ? first.getAttribute("href") : "");
            url = url ? safeUrl(url) : "";
            if (url && first && first.nodeType === 3 && title) {
                var link = document.createElement("a");
                link.href = url;
                link.textContent = title;
                ch.replaceChild(link, first);
            }
            var venue = (r.getAttribute("data-venue") || "").trim();
            var shown = venue || when.filter(function (w) { return w.venue; }).map(function (w) {
                return (w.label ? w.label + ": " : "") + w.venue;
            }).join("; ");
            if (shown && ch && !$(".comp-venue", ch)) {
                var v = document.createElement("small");
                v.className = "comp-venue";
                v.textContent = shown;
                ch.appendChild(v);
            }
            return {
                row: r, year: year, when: when, url: url, title: title, venue: venue,
                teams: parseInt(r.getAttribute("data-teams"), 10) || 0,
                current: r.hasAttribute("data-current")
            };
        }).filter(function (e) { return e.year; });
        var max = Math.max.apply(null, [1].concat(editions.map(function (e) { return e.teams; })));
        editions.forEach(function (e) {
            var cell = $(".teams", e.row);
            if (!cell || !e.teams) return;
            var frac = (e.teams / max).toFixed(3);
            cell.innerHTML = '<span class="tbar' + (e.current ? " current" : "") + '">' +
                '<i style="width:calc((100% - 5.5rem) * ' + frac + ')"></i>' +
                "<span>" + fmt(e.teams) + (e.current ? " so far" : "") + "</span></span>";
        });
        var total = editions.reduce(function (s, e) { return s + e.teams; }, 0);
        var first = Math.min.apply(null, editions.map(function (e) { return e.year; }));
        var words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
            "eleven", "twelve", "thirteen", "fourteen", "fifteen"];
        $$("[data-comp]").forEach(function (el) {
            var k = el.getAttribute("data-comp");
            if (k === "editions") {
                var w = words[editions.length] || String(editions.length);
                el.textContent = el.hasAttribute("data-cap") ? w.charAt(0).toUpperCase() + w.slice(1) : w;
            }
            if (k === "teams") el.textContent = fmt(total);
            if (k === "first" && isFinite(first)) el.textContent = first;
        });
    }

    /* ------------------------------------------------------------------ */
    /* Hero: career drawn as a waveform (stages, papers, competition)      */
    /* ------------------------------------------------------------------ */
    function ym(s) {
        var m = /^(\d{4})(?:-(\d{1,2}))?/.exec(String(s || ""));
        return m ? Number(m[1]) + ((Number(m[2] || 1) - 1) / 12) : null;
    }

    // "2024-03-15", "2024-03" or "2024" as a fractional year. With end=true,
    // returns the end of that day, month or year.
    function toYear(s, end) {
        var m = /^\s*(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?\s*$/.exec(s || "");
        if (!m) return null;
        var y = +m[1], mo = m[2] ? +m[2] - 1 : (end ? 11 : 0);
        var d = m[3] ? +m[3] : (end ? new Date(Date.UTC(y, mo + 1, 0)).getUTCDate() : 1);
        var at = Date.UTC(y, mo, d) + (end ? 86400000 : 0);
        var y0 = Date.UTC(y, 0, 1), y1 = Date.UTC(y + 1, 0, 1);
        return { t: y + (at - y0) / (y1 - y0), date: new Date(Date.UTC(y, mo, d)), prec: m[3] ? "day" : m[2] ? "month" : "year" };
    }

    // data-when="Qualifier: 2024-09-14/2024-10-20 @ Online; Final: 2024-11-08/2024-11-09 @ ICCAD 2024, San Jose"
    // Ranges (start/end) separated by commas, or by semicolons if any venue contains a comma.
    // Each range can have a "Label:" prefix and an "@ venue" suffix.
    function parseWhen(str) {
        str = String(str || "");
        return str.split(str.indexOf(";") > -1 ? ";" : ",").map(function (part) {
            part = part.trim();
            if (!part) return null;
            var venue = "", at = part.indexOf("@");
            if (at > -1) { venue = part.slice(at + 1).trim(); part = part.slice(0, at).trim(); }
            var label = "", m = /^([^:]+):\s*(.+)$/.exec(part);
            if (m) { label = m[1].trim(); part = m[2]; }
            var ends = part.split("/");
            var a = toYear(ends[0], false), b = toYear(ends[1] || ends[0], true);
            return a && b && b.t > a.t ? { label: label, venue: venue, a: a, b: b } : null;
        }).filter(Boolean);
    }

    function fmtRange(r) {
        var a = r.a.date, b = r.b.date;
        function mon(d) { return d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }); }
        var ya = a.getUTCFullYear(), yb = b.getUTCFullYear();
        if (r.a.prec === "year") return ya === yb ? String(ya) : ya + "\u2013" + yb;
        if (r.a.prec === "month" || r.b.prec === "month") {
            if (ya !== yb) return mon(a) + " " + ya + " \u2013 " + mon(b) + " " + yb;
            return (mon(a) === mon(b) ? mon(a) : mon(a) + "\u2013" + mon(b)) + " " + ya;
        }
        var da = a.getUTCDate(), db = b.getUTCDate();
        if (ya !== yb) return mon(a) + " " + da + ", " + ya + " \u2013 " + mon(b) + " " + db + ", " + yb;
        if (a.getUTCMonth() !== b.getUTCMonth()) return mon(a) + " " + da + " \u2013 " + mon(b) + " " + db + ", " + ya;
        return mon(a) + " " + da + (da !== db ? "\u2013" + db : "") + ", " + ya;
    }

    var traceAnimated = false;

    function renderTrace() {
        var fig = $("#trace");
        if (!fig) return;
        var scroller = $(".trace-scroll", fig), tip = $(".trace-tip", fig);
        var cfg = Object.assign({ stages: [], next: "", competition: "", compMonths: [9, 11] }, SITE.trace || {});
        var stages = (cfg.stages || []).map(function (s) {
            return { label: s.label, short: s.short || s.label, a: ym(s.from), b: ym(s.to), from: s.from, to: s.to };
        }).filter(function (s) { return s.a !== null && s.b !== null && s.b > s.a; })
        .sort(function (p, q) { return p.a - q.a; });

        // One pulse per paper. Papers with a month sit mid-month; papers without one
        // are spread evenly across their year so they don't stack on the same date.
        var noMonth = {};
        pubsList.forEach(function (p) {
            if (p.year && !p.month) (noMonth[p.year] = noMonth[p.year] || []).push(p);
        });
        var papers = pubsList.filter(function (p) { return p.year; }).map(function (p) {
            var list = noMonth[p.year];
            var t = p.month ? p.year + (p.month - 0.5) / 12
                : p.year + (list.indexOf(p) + 1) / (list.length + 1);
            return { t: t, pub: p };
        }).sort(function (p, q) { return p.t - q.t; });
        var cm = cfg.compMonths, comps = [];
        if (cfg.competition) editions.forEach(function (e) {
            var spans = e.when.length ? e.when :
                [{ label: "", a: { t: e.year + (cm[0] - 1) / 12 }, b: { t: e.year + cm[1] / 12 }, guessed: true }];
            spans.forEach(function (s) { comps.push({ a: s.a.t, b: s.b.t, span: s, e: e }); });
        });

        // Tapeouts: any element with data-tapeout="YYYY-MM" (the Hardware list)
        var tapeouts = cfg.tapeout === "" ? [] : $$("[data-tapeout]").map(function (el, i) {
            var w = parseWhen(el.getAttribute("data-tapeout"))[0];
            if (!w) return null;
            if (!el.id) el.id = "tapeout-" + (i + 1);
            var nameEl = $(".project-name", el);
            return { a: w.a.t, b: Math.max(w.b.t, w.a.t + 1 / 12), span: w,
                name: nameEl ? nameEl.textContent.trim() : "Tapeout", href: "#" + el.id };
        }).filter(Boolean);

        var now = new Date();
        var tNow = now.getFullYear() + now.getMonth() / 12 + (now.getDate() - 1) / 365;
        var starts = [], ends = [tNow];
        stages.forEach(function (s) { starts.push(s.a); ends.push(s.b); });
        papers.forEach(function (p) { starts.push(p.t); ends.push(p.t); });
        comps.forEach(function (c) { starts.push(c.a); ends.push(c.b); });
        tapeouts.forEach(function (t) { starts.push(t.a); ends.push(t.b); });
        if (!starts.length) { fig.hidden = true; return; }
        var t0 = Math.floor(Math.min.apply(null, starts) - 0.2);
        var lastEnd = Math.max.apply(null, ends);
        var t1 = Math.ceil(lastEnd + (cfg.next ? 0.9 : 0.2));

        var rows = [{ name: "career", type: "bus" }];
        if (papers.length) rows.push({ name: "papers", type: "papers" });
        if (tapeouts.length) rows.push({ name: cfg.tapeout || "tapeout", type: "tapeout" });
        if (comps.length) rows.push({ name: cfg.competition, type: "comp" });

        var W = Math.max(scroller.clientWidth, 300);
        var narrow = W < 520;
        var longest = Math.max.apply(null, rows.map(function (r) { return String(r.name).length; }));
        var padL = Math.max(narrow ? 84 : 96, Math.ceil(longest * (narrow ? 6.2 : 6.8)) + (narrow ? 18 : 24));
        var padR = narrow ? 8 : 14, top = 16, rowH = narrow ? 32 : 36, axisH = 20;
        fig.classList.toggle("narrow", narrow);
        var H = top + rows.length * rowH + axisH;
        var span = W - padL - padR;
        function x(t) { return padL + (t - t0) / (t1 - t0) * span; }
        function n(v) { return Math.round(v * 10) / 10; }

        var out = [];
        out.push('<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + " " + H + '" role="group" aria-label="' + esc(traceSummary(stages, papers, comps, cfg, tapeouts)) + '">');
        out.push('<defs><pattern id="wv-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
            '<rect width="5" height="5" fill="transparent"></rect><line x1="0" y1="0" x2="0" y2="5" style="stroke:var(--ch1);stroke-width:1.3"></line></pattern></defs>');

        // Graticule: one division per year
        var yearW = x(t0 + 1) - x(t0);
        var every = yearW < 18 ? 3 : yearW < 36 ? 2 : 1;
        for (var y = t0; y <= t1; y++) {
            out.push('<line class="grid" x1="' + n(x(y)) + '" y1="' + (top - 4) + '" x2="' + n(x(y)) + '" y2="' + (H - axisH + 4) + '"></line>');
            if (y < t1 && (y - t0) % every === 0) {
                out.push('<text class="axis" x="' + n(x(y + 0.5)) + '" y="' + (H - 6) + '" text-anchor="middle">' + y + "</text>");
            }
        }
        rows.forEach(function (r, i) {
            var y0 = top + i * rowH;
            out.push('<line class="grid" x1="0" y1="' + (y0 + rowH) + '" x2="' + W + '" y2="' + (y0 + rowH) + '"></line>');
            out.push('<text class="sig-name" x="' + (narrow ? 10 : 14) + '" y="' + (y0 + rowH / 2 + 4) + '">' + esc(r.name) + "</text>");
        });

        out.push('<g class="' + (traceAnimated ? "" : "sweep") + '">');
        rows.forEach(function (r, i) {
            var y0 = top + i * rowH, hi = y0 + 8, lo = y0 + rowH - 8, mid = (hi + lo) / 2;
            if (r.type === "bus") out.push(busRow(stages, cfg, x, t0, t1, hi, lo, mid, n));
            if (r.type === "papers") out.push(pulseRow(papers.map(function (g) {
                var p = g.pub;
                return { a: g.t - 0.5 / 12, b: g.t + 0.5 / 12, href: "#" + p.anchor, mark: p.awards.length > 0,
                    tip: p.abbr + " " + p.year + ": " + p.title + (p.awards.length ? " (" + p.awards.join(", ") + ")" : "") };
            }), "w2", x, hi, lo, y0, rowH, W, padL, padR, n));
            if (r.type === "tapeout") out.push(pulseRow(tapeouts.map(function (t) {
                return { a: t.a, b: t.b, href: t.href, tip: t.name + "\n" + fmtRange(t.span) };
            }), "w4", x, hi, lo, y0, rowH, W, padL, padR, n));
            if (r.type === "comp") out.push(pulseRow(comps.map(function (c) {
                var lines = [(cfg.competitionName || r.name) + " " + c.e.year + (c.e.title ? ": " + c.e.title : "")];
                var dates = c.span.guessed ? "" : fmtRange(c.span);
                if (c.span.label || dates) lines.push(c.span.label + (c.span.label && dates ? ": " : "") + dates);
                if (c.span.venue || c.e.venue) lines.push(c.span.venue || c.e.venue);
                if (c.e.teams) lines.push(fmt(c.e.teams) + " teams" + (c.e.current ? " so far" : ""));
                return { a: c.a, b: c.b, href: c.e.url || "#" + c.e.row.id, tip: lines.join("\n") };
            }), "w3", x, hi, lo, y0, rowH, W, padL, padR, n));
        });
        out.push("</g>");

        if (tNow > t0 && tNow < t1) {
            var xn = n(x(tNow));
            out.push('<rect class="future" x="' + xn + '" y="' + top + '" width="' + n(W - padR - xn) + '" height="' + (rows.length * rowH) + '"></rect>');
            out.push('<line class="now-line" x1="' + xn + '" y1="' + (top - 4) + '" x2="' + xn + '" y2="' + (H - axisH + 4) + '"></line>');
            out.push('<text class="now-label" x="' + xn + '" y="10" text-anchor="middle">now</text>');
        }
        out.push("</svg>");
        scroller.innerHTML = out.join("");
        traceAnimated = true;
        if (scroller.scrollWidth > scroller.clientWidth) scroller.scrollLeft = scroller.scrollWidth;

        // Tooltips
        function show(a) {
            tip.textContent = a.getAttribute("data-tip");
            tip.hidden = false;
            var fr = fig.querySelector(".trace").getBoundingClientRect(), er = a.getBoundingClientRect();
            var tw = tip.offsetWidth, th = tip.offsetHeight;
            var left = er.left - fr.left + er.width / 2 - tw / 2;
            tip.style.left = Math.max(6, Math.min(fr.width - tw - 6, left)) + "px";
            var topPos = er.top - fr.top - th - 6;
            tip.style.top = (topPos < 0 ? er.bottom - fr.top + 6 : topPos) + "px";
        }
        function hide() { tip.hidden = true; }
        $$("[data-tip]", scroller).forEach(function (a) {
            a.addEventListener("pointerenter", function () { show(a); });
            a.addEventListener("focus", function () { show(a); });
            // On touch screens, keep the tooltip up after the tap; it hides when focus moves on
            a.addEventListener("pointerleave", function (e) { if (e.pointerType !== "touch") hide(); });
            a.addEventListener("blur", hide);
        });
    }

    function busRow(stages, cfg, x, t0, t1, hi, lo, mid, n) {
        var out = [], cursor = t0;
        function hiz(a, b) {
            if (b - a <= 0) return;
            out.push('<line class="hiz" x1="' + n(x(a)) + '" y1="' + mid + '" x2="' + n(x(b)) + '" y2="' + mid + '"></line>');
        }
        function shape(xa, xb, cls) {
            var s = Math.min(4, (xb - xa) / 2);
            return '<path class="' + cls + '" d="M' + n(xa) + " " + mid + "L" + n(xa + s) + " " + hi + "L" + n(xb - s) + " " + hi +
                "L" + n(xb) + " " + mid + "L" + n(xb - s) + " " + lo + "L" + n(xa + s) + " " + lo + 'Z"></path>';
        }
        function label(text, short, xa, xb, cls) {
            var room = xb - xa - 10, pick = null;
            if (text.length * 6.4 <= room) pick = text;
                else if (short && short.length * 6.4 <= room) pick = short;
            if (!pick) return "";
            return '<text class="' + cls + '" x="' + n((xa + xb) / 2) + '" y="' + (mid + 3.5) + '" text-anchor="middle">' + esc(pick) + "</text>";
        }
        var now = new Date(), tNow = now.getFullYear() + now.getMonth() / 12;
        stages.forEach(function (s) {
            hiz(cursor, s.a);
            var xa = x(s.a), xb = x(s.b);
            var span = parseWhen(s.from + "/" + s.to)[0];
            var tipText = s.label + (span ? "\n" + fmtRange(span) + (s.b > tNow ? " (expected)" : "") : "");
            out.push('<g class="stage" tabindex="0" role="img" data-tip="' + esc(tipText) + '" aria-label="' + esc(tipText) + '">' +
                shape(xa, xb, "bus") + label(s.label, s.short, xa, xb, "bus-label") + "</g>");
            cursor = s.b;
        });
        if (cfg.next) {
            var xa = x(cursor), xb = x(t1);
            out.push('<g class="stage" tabindex="0" role="img" data-tip="Next: ' + esc(cfg.next) + '" aria-label="Next: ' + esc(cfg.next) + '">' +
                shape(xa, xb, "unknown") + "</g>");
            out.push(label(cfg.next, "", xa, xb, "bus-label"));
        } else {
            hiz(cursor, t1);
        }
        return out.join("");
    }

    function pulseRow(items, cls, x, hi, lo, y0, rowH, W, padL, padR, n) {
        var MINW = 3, GAP = 3;
        var spans = items.map(function (it) {
            var xa = x(it.a), xb = Math.max(x(it.b), xa + MINW);
            return { xa: xa, xb: xb, it: it };
        }).sort(function (p, q) { return p.xa - q.xa; });
        // Every item gets its own pulse. Where pulses would touch or overlap, split
        // their shared time window evenly (widening it if needed) so each one shows.
        for (var pass = 0; pass < 8; pass++) {
            var clusters = [], cur = null;
            spans.forEach(function (s) {
                if (cur && s.xa < cur.end + GAP - 0.01) { cur.items.push(s); cur.end = Math.max(cur.end, s.xb); }
                else { cur = { start: s.xa, end: s.xb, items: [s] }; clusters.push(cur); }
            });
            var moved = false;
            clusters.forEach(function (c) {
                var k = c.items.length;
                if (k < 2) return;
                var span = Math.max(c.end - c.start, k * MINW + (k - 1) * GAP);
                var start = Math.max(padL + 1, Math.min(W - padR - span - 1, (c.start + c.end) / 2 - span / 2));
                var slot = (span - (k - 1) * GAP) / k;
                c.items.forEach(function (s, i) { s.xa = start + i * (slot + GAP); s.xb = s.xa + slot; });
                moved = true;
            });
            if (!moved) break;
            spans.sort(function (p, q) { return p.xa - q.xa; });
        }
        var d = "M" + padL + " " + lo, lastX = padL;
        spans.forEach(function (s) {
            var xa = Math.max(s.xa, lastX);
            if (s.xb <= lastX) return;
            d += "L" + n(xa) + " " + lo + "L" + n(xa) + " " + hi + "L" + n(s.xb) + " " + hi + "L" + n(s.xb) + " " + lo;
            lastX = s.xb;
        });
        d += "L" + n(W - padR) + " " + lo;
        var out = ['<path class="wave ' + cls + '" d="' + d + '"></path>'];
        spans.forEach(function (s) {
            var c = (s.xa + s.xb) / 2;
            if (s.it.mark) out.push('<path class="award" d="M' + n(c) + " " + (hi - 8) + "l3.2 3.2-3.2 3.2-3.2-3.2z" + '"></path>');
            var prev = spans[spans.indexOf(s) - 1], next = spans[spans.indexOf(s) + 1];
            var left = Math.max(s.xa - 5, prev ? (prev.xb + s.xa) / 2 : -Infinity);
            var right = Math.min(s.xb + 5, next ? (s.xb + next.xa) / 2 : Infinity);
            out.push('<a href="' + esc(s.it.href) + '" data-tip="' + esc(s.it.tip) + '" aria-label="' + esc(s.it.tip) + '">' +
                '<rect class="hit" x="' + n(left) + '" y="' + (y0 + 2) + '" width="' + n(right - left) + '" height="' + (rowH - 4) + '" rx="2"></rect></a>');
        });
        return out.join("");
    }

    function traceSummary(stages, papers, comps, cfg, tapeouts) {
        var parts = stages.map(function (s) { return s.label + " " + Math.floor(s.a) + " to " + Math.floor(s.b); });
        if (cfg.next) parts.push("next: " + cfg.next);
        var count = papers.length;
        if (count) parts.push(count + " papers");
        if (tapeouts && tapeouts.length) parts.push(tapeouts.length + (tapeouts.length === 1 ? " tapeout" : " tapeouts"));
        if (comps.length) parts.push((cfg.competitionName || cfg.competition) + " run " + editions.length + " times");
        return "Career timeline. " + parts.join("; ") + ".";
    }

    function setupTraceResize() {
        var fig = $("#trace");
        if (!fig || !("ResizeObserver" in window)) return;
        var lastW = 0, timer = null;
        new ResizeObserver(function (entries) {
            var w = Math.round(entries[0].contentRect.width);
            if (!lastW) { lastW = w; return; }
            if (Math.abs(w - lastW) < 8) return;
            lastW = w;
            clearTimeout(timer);
            timer = setTimeout(renderTrace, 120);
        }).observe(fig);
    }

    /* ------------------------------------------------------------------ */
    /* GitHub: pinned repositories                                         */
    /* ------------------------------------------------------------------ */
    function renderGithub() {
        var list = $("#gh-repos");
        if (!list) return;
        var cfg = Object.assign({ user: "", show: 6, repos: [] }, SITE.github || {});
        var user = String(cfg.user || "").trim();
        var placeholder = !user || /^your-username$/i.test(user);
        var data = G.GITHUB_DATA;
        var api = "https://api.github.com";

        function getJSON(url) {
            return fetch(url, { headers: { Accept: "application/vnd.github+json" } })
                .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
        }
        function fromRest(j) {
            return { owner: j.owner && j.owner.login, name: j.name, url: j.html_url, description: j.description,
                language: j.language, stars: j.stargazers_count, forks: j.forks_count, pushed_at: j.pushed_at };
        }

        if (cfg.repos && cfg.repos.length) {
            var key = "gh-manual:" + cfg.repos.join(",");
            var cached = store(key);
            if (cached) return paintRepos(cached, "manual", { user: user });
            Promise.all(cfg.repos.map(function (r) { return getJSON(api + "/repos/" + r).then(fromRest, function () { return null; }); }))
                .then(function (rs) { rs = rs.filter(Boolean); store(key, rs); paintRepos(rs, "manual", { user: user }); });
            return;
        }
        var matches = data && Array.isArray(data.repos) && data.repos.length &&
            ((placeholder && data.example) || (!placeholder && fold(data.user) === fold(user)));
        if (matches) return paintRepos(data.repos, data.source || "pinned", data);
        if (placeholder) {
            $("#gh-head").innerHTML = "Set your GitHub username in the settings at the top of index.html to list your repositories here.";
            return;
        }
        var ck = "gh-top:" + user, hit = store(ck);
        if (hit) return paintRepos(hit.repos, "top", hit);
        Promise.all([
            getJSON(api + "/users/" + encodeURIComponent(user) + "/repos?per_page=100&type=owner&sort=pushed"),
            getJSON(api + "/users/" + encodeURIComponent(user)).catch(function () { return {}; })
        ]).then(function (res) {
                var repos = res[0].filter(function (r) { return !r.fork && !r.archived; })
                .sort(function (a, b) { return (b.stargazers_count - a.stargazers_count) || (Date.parse(b.pushed_at) - Date.parse(a.pushed_at)); })
                .slice(0, cfg.show).map(fromRest);
                var meta = { user: user, public_repos: res[1].public_repos, repos: repos };
                store(ck, meta);
                paintRepos(repos, "top", meta);
            }).catch(function () {
                $("#gh-head").innerHTML = 'See my repositories on <a href="https://github.com/' + esc(user) + '">GitHub</a>.';
            });
    }

    function paintRepos(repos, source, meta) {
        var cfg = SITE.github || {};
        var user = meta.user || cfg.user || "";
        var label = { pinned: "Pinned on GitHub", top: "Most-starred on GitHub", manual: "On GitHub" }[source] || "On GitHub";
        var profile = "https://github.com/" + encodeURIComponent(user);
        $("#gh-head").innerHTML = "<strong>" + label + "</strong>" +
            '<a href="' + esc(profile) + '">' + (meta.public_repos ? "All " + fmt(meta.public_repos) + " repositories" : "All repositories") + "</a>";
        $("#gh-repos").innerHTML = repos.slice(0, cfg.show || 6).map(function (r) {
            var owner = r.owner && fold(r.owner) !== fold(user) ? '<span class="repo-owner">' + esc(r.owner) + "/</span>" : "";
            var meta2 = [];
            if (r.language) meta2.push("<span>" + esc(r.language) + "</span>");
            meta2.push('<span aria-label="' + fmt(r.stars || 0) + ' stars">★ ' + fmt(r.stars || 0) + "</span>");
            if (r.forks) meta2.push("<span>" + fmt(r.forks) + " fork" + (r.forks === 1 ? "" : "s") + "</span>");
            if (r.pushed_at) {
                var d = new Date(r.pushed_at);
                if (!isNaN(d)) meta2.push("<span>Updated " + d.toLocaleDateString("en-US", { month: "short", year: "numeric" }) + "</span>");
            }
            return '<li class="repo"><a class="repo-name" href="' + esc(safeUrl(r.url)) + '">' + owner + esc(r.name) + "</a>" +
                (r.description ? '<p class="repo-desc">' + esc(r.description) + "</p>" : '<p class="repo-desc"></p>') +
                '<p class="repo-meta">' + meta2.join("") + "</p></li>";
        }).join("");
        var note = $("#gh-note");
        if (note) {
            var bits = [];
            if (meta.example) bits.push("<strong class=\"example-flag\">These are example repositories.</strong> They’re replaced with your pinned repositories the first time the weekly update runs.");
                else if (meta.updated) {
                    var d = new Date(meta.updated + "T12:00:00");
                    if (!isNaN(d)) bits.push("Updated " + d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) + ".");
                }
            note.innerHTML = bits.join(" ");
            note.hidden = !bits.length;
        }
    }

    /* ------------------------------------------------------------------ */
    /* GitHub stars                                                        */
    /* ------------------------------------------------------------------ */
    function loadStars() {
        $$("[data-repo]").forEach(function (el) {
            var repo = (el.getAttribute("data-repo") || "").trim();
            var out = $(".repo-stars", el);
            if (!out || !/^[\w.-]+\/[\w.-]+$/.test(repo) || /^your-username\//i.test(repo)) return;
            function paint(d) { out.textContent = fmt(d.stars) + " star" + (d.stars === 1 ? "" : "s"); }
            var cached = store("gh:" + repo);
            if (cached) { paint(cached); return; }
            fetch("https://api.github.com/repos/" + repo, { headers: { Accept: "application/vnd.github+json" } })
                .then(function (r) { return r.ok ? r.json() : null; })
                .then(function (j) {
                    if (!j) return;
                    var d = { stars: j.stargazers_count || 0 };
                    store("gh:" + repo, d);
                    paint(d);
                })
                .catch(function () {});
        });
    }

    /* ------------------------------------------------------------------ */
    /* YouTube: load only when clicked (faster page, no tracking until then) */
    /* ------------------------------------------------------------------ */
    function setupVideos() {
        $$(".video[data-youtube]").forEach(function (box) {
            var id = (box.getAttribute("data-youtube") || "").trim();
            var title = box.getAttribute("data-title") || "Video";
            if (!/^[\w-]{11}$/.test(id)) {
                box.classList.add("video-empty");
                box.innerHTML = "<p>Add a YouTube video ID to <code>data-youtube</code> to show your talk here.</p>";
                return;
            }
            box.innerHTML = '<button type="button" class="video-play" aria-label="Play video: ' + esc(title) + '">' +
                '<img src="https://i.ytimg.com/vi/' + id + '/hqdefault.jpg" alt="" loading="lazy">' +
                '<span class="play-icon" aria-hidden="true"><svg viewBox="0 0 64 64" width="64" height="64">' +
                '<circle cx="32" cy="32" r="32"></circle><path d="M26 20 46 32 26 44Z"></path></svg></span></button>';
            box.querySelector("button").addEventListener("click", function () {
                box.innerHTML = '<iframe src="https://www.youtube-nocookie.com/embed/' + id + '?autoplay=1&rel=0" title="' +
                    esc(title) + '" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" ' +
                    'referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>';
            });
        });
    }

    /* ------------------------------------------------------------------ */
    /* News: show the latest few                                           */
    /* ------------------------------------------------------------------ */
    function setupNews() {
        var list = $("#news-list");
        if (!list) return;
        var items = $$(":scope > li", list), limit = SITE.newsLimit;
        if (items.length <= limit) return;
        items.slice(limit).forEach(function (li) { li.hidden = true; });
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "text-button";
        btn.textContent = "Show all news (" + items.length + ")";
        btn.addEventListener("click", function () {
            items.forEach(function (li) { li.hidden = false; });
            btn.remove();
            items[limit].setAttribute("tabindex", "-1");
            items[limit].focus({ preventScroll: true });
        });
        list.insertAdjacentElement("afterend", btn);
    }

    /* ------------------------------------------------------------------ */
    /* Sidebar: mark the section currently on screen                       */
    /* ------------------------------------------------------------------ */
    function setupScrollSpy() {
        if (!("IntersectionObserver" in window)) return;
        var links = $$(".nav a[href^='#']");
        var byId = {};
        links.forEach(function (a) { byId[a.getAttribute("href").slice(1)] = a; });
        var io = new IntersectionObserver(function (entries) {
            entries.forEach(function (en) {
                if (!en.isIntersecting) return;
                links.forEach(function (a) { a.removeAttribute("aria-current"); });
                var a = byId[en.target.id];
                if (a) a.setAttribute("aria-current", "location");
            });
        }, { rootMargin: "-15% 0px -75% 0px" });
        Object.keys(byId).forEach(function (id) {
            var s = document.getElementById(id);
            if (s) io.observe(s);
        });
    }

    function init() {
        try { renderScholar(); } catch (e) { console.error("Scholar:", e); }
        try { renderCompetition(); } catch (e) { console.error("Competition:", e); }
        try { renderGithub(); } catch (e) { console.error("GitHub:", e); }
        wirePublicationEvents();
        loadStars();
        setupVideos();
        setupNews();
        setupScrollSpy();
        loadBibliography().then(function (bibText) {
            try { renderPublications(bibText); } catch (e) { console.error("Publications:", e); }
            try { renderCitations(); } catch (e) { console.error("Citations:", e); }
            try { renderTrace(); setupTraceResize(); } catch (e) { console.error("Trace:", e); }
            // The list just changed the page height, so return to any #section in the URL
            var target = location.hash && document.getElementById(location.hash.slice(1));
            if (target) {
                target.scrollIntoView();
                if (location.hash.indexOf("#pub-") === 0) flash(target);
            }
        });
    }

    // Exposed for testing in Node
    if (typeof module !== "undefined" && module.exports) {
        module.exports = { parseBibtex: parseBibtex, latexToText: latexToText, parseName: parseName,
            buildPub: buildPub, kindOf: kindOf, deriveAbbr: deriveAbbr, splitTop: splitTop,
            authorsHtml: authorsHtml, venueHtml: venueHtml, citationsFor: citationsFor, monthNum: monthNum,
            _setSite: function (s) { Object.assign(SITE, s); } };
        return;
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
        else init();
})();
