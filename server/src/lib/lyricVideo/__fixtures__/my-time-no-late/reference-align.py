"""Align the lyric sheet to Whisper word timings, line by line.

Each row names the lyric line, the Whisper source that heard it best and the
window of that source to look in. Sheet words are sequence-matched to the
Whisper words in the window (accents and case ignored); unmatched sheet words
are spread evenly between their matched neighbours. Rows with explicit word
times (a list of (word, start) pairs) bypass matching: those are hand-set
where every Whisper pass clumped or missed the words.

Writes lines.json: [{section, kind, effect, text, start, end, words:[{text,start,end}]}]
"""
import json, os, re, unicodedata
from difflib import SequenceMatcher

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = {
    "mix": "whisper_mix.json",
    "A": "vox/segvox_A.json",
    "B1": "vox/segvox_B1.json",
    "B2": "vox/segvox_B2.json",
    "Cmix": "segmix_C.json",
    "W1": "vox/segvox_W1.json",
    "W2": "vox/segvox_W2.json",
    "W3": "vox/segvox_W3.json",
    "D": "vox/segvox_D.json",
}
words_by_src = {}
for k, f in SRC.items():
    j = json.load(open(os.path.join(HERE, f), encoding="utf8"))
    words_by_src[k] = [{"word": w["word"], "start": float(w["start"]), "end": float(w["end"])} for w in j["words"]]


def norm(s):
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.lower().replace("’", "'")
    return re.sub(r"[^a-z0-9']", "", s)


# (section, kind, effect, text, source, t0, t1) or (section, kind, effect, text, [(word, start), ...], end)
ROWS = [
    ("intro", "lead", "title", "Eh-yeah, eh-yeah!", "mix", 0.0, 5.2),
    ("intro", "lead", "stack", "Dem say make I calm down...", "mix", 5.5, 7.7),
    ("intro", "lead", "slam", "I say, no wahala!", "mix", 7.7, 10.6),
    ("intro", "lead", "stack", "But when my blessing land...", "mix", 11.8, 14.2),
    ("intro", "lead", "pop", "Abeg, no tell me make I keep quiet!", "mix", 14.3, 16.7),
    ("intro", "lead", "slam", "Oya!", "mix", 16.9, 17.7),

    ("verse1", "lead", "stack", "I remember days wey the road no clear,", "mix", 17.7, 21.6),
    ("verse1", "lead", "pop", "Pocket nearly empty but my dreams dey there.", "mix", 22.6, 26.2),
    ("verse1", "lead", "stack", "Everybody moving, I dey wonder when,", "mix", 27.0, 30.6),
    ("verse1", "lead", "pop", "But my mama tell me,", "mix", 31.4, 33.0),
    ("verse1", "yoruba", "quote", "Ọmọ mi, believe again.", "mix", 33.0, 35.2),
    ("verse1", "lead", "stack", "Some dey buy house, some dey buy car,", "mix", 36.0, 39.6),
    ("verse1", "lead", "pop", "Me I still dey hustle, but I know who I are.", "mix", 40.2, 44.6),
    ("verse1", "lead", "stack", "I no dey measure my life with another man's clock,", "mix", 44.9, 48.4),
    ("verse1", "lead", "quote", "Na God hold the key, nobody fit change my lock.", "mix", 48.6, 52.7),

    ("pre", "lead", "stack", "Small small, everything dey align,", "mix", 53.0, 57.6),
    ("pre", "lead", "stack", "No be your timetable, na my own time.", "mix", 58.0, 61.8),
    ("pre", "lead", "curve", "If you see me dance,", "mix", 61.9, 63.5),
    ("pre", "lead", "stack", "no ask me why,", "mix", 63.8, 65.0),
    ("pre", "lead", "quote", "You no know the tears wey I cry last night.", "mix", 65.1, 70.4),

    ("chorus1", "lead", "slam", "Who talk say I no go shine?", "A", 71.0, 73.8),
    ("chorus1", "lead", "slam", "Who talk say the joy no mine?", "A", 73.9, 76.0),
    ("chorus1", "response", "echo", "(WHO TALK SAY?!)", [("(WHO", 76.45), ("TALK", 76.85), ("SAY?!)", 77.15)], 77.7),
    ("chorus1", "lead", "stack", "See as the table don turn around!", "A", 78.4, 80.3),
    ("chorus1", "lead", "pop", "Na grace carry me, I no fall down!", "A", 80.4, 82.6),
    ("chorus1", "lead", "stack", "Oya give me space, make I celebrate!", "A", 82.7, 84.6),
    ("chorus1", "lead", "frame", "My time no late, my time no late!", "A", 84.7, 87.0),
    ("chorus1", "lead", "slam", "Who talk say? Eh! Who talk say?!", "A", 87.1, 89.05),

    ("verse2", "lead", "stack", "From Lagos traffic to the London rain,", "A", 89.05, 91.3),
    ("verse2", "lead", "pop", "Everywhere you go, everybody get pain.", "A", 91.4, 93.6),
    ("verse2", "lead", "stack", "Some dey work double shift just to pay their bills,", "A", 93.6, 95.75),
    ("verse2", "lead", "quote", "Some dey smile outside but inside no peace.", "A", 95.8, 98.1),
    ("verse2", "lead", "stack", "But I get one message, make you hear am well,", "B1", 97.4, 100.4),
    ("verse2", "lead", "pop", "Your present condition no be where you go dwell.", "B1", 100.4, 102.5),
    ("verse2", "lead", "quote", "No be every closed door mean say you don fail,", "B1", 102.6, 104.7),
    ("verse2", "lead", "stack", "Sometimes na better road dey after the bend.", "B1", 104.7, 107.3),

    ("bridge", "yoruba", "quote", "Oluwa, mo dúpẹ́,", "B2", 107.4, 109.4),
    ("bridge", "soft", "stack", "For the days I couldn't see.", "B2", 109.5, 111.7),
    ("bridge", "soft", "pop", "When my strength was almost gone,", "B2", 111.8, 114.1),
    ("bridge", "soft", "quote", "You still put a song in me.", "B2", 114.2, 116.0),
    ("bridge", "lead", "stack", "And if tomorrow bring another fight,", [("And", 115.95), ("if", 116.4), ("tomorrow", 117.4), ("bring", 118.24), ("another", 118.78), ("fight,", 119.9)], 120.9),
    ("bridge", "lead", "slam", "I go still dey dance tonight.", [("I", 126.0), ("go", 126.4), ("still", 126.66), ("dey", 127.3), ("dance", 127.82), ("tonight.", 128.7)], 129.6),
    ("bridge", "lead", "stack", "Because the darkness", "Cmix", 134.0, 136.1),
    ("bridge", "lead", "slam", "no fit swallow my light!", "Cmix", 136.1, 138.9),

    ("final", "lead", "slam", "WHO TALK SAY?!", "W1", 141.5, 143.8),
    ("final", "response", "echo", "(WHO TALK SAY?!)", [("(WHO", 143.95), ("TALK", 144.2), ("SAY?!)", 144.42)], 144.65),
    ("final", "lead", "frame", "MY TIME NO LATE!", "W1", 144.66, 146.1),
    ("final", "response", "echo", "(NO DEY LATE!)", "W1", 146.2, 147.3),
    ("final", "lead", "slam", "WHO TALK SAY?!", [("WHO", 147.58), ("TALK", 147.9), ("SAY?!", 148.2)], 148.7),
    ("final", "response", "echo", "(WHO TALK SAY?!)", [("(WHO", 149.0), ("TALK", 149.22), ("SAY?!)", 149.44)], 149.65),
    ("final", "lead", "slam", "MY JOY NO FAKE!", [("MY", 149.7), ("JOY", 149.95), ("NO", 150.28), ("FAKE!", 150.6)], 151.2),
    ("final", "response", "echo", "(E NO FAKE!)", [("(E", 151.3), ("NO", 151.55), ("FAKE!)", 151.75)], 152.05),
    ("final", "lead", "stack", "Dem fit count me out,", "D", 151.85, 153.4),
    ("final", "lead", "pop", "But dem no fit count my blessings!", "D", 153.2, 155.7),
    ("final", "lead", "slam", "Oya dance, dance, dance!", "W3", 156.0, 158.3),
    ("final", "lead", "frame", "This one na celebration!", "W3", 158.3, 159.9),

    ("outro", "lead", "curve", "Who talk say?", "W3", 162.3, 163.6),
    ("outro", "lead", "slam", "Who talk say?", "W3", 163.7, 164.9),
    ("outro", "lead", "stack", "Nobody fit stop wetin God don start!", "W3", 166.6, 169.7),
    ("outro", "lead", "slam", "Eh-yeah!", "W3", 172.3, 174.1),
]

MIN_WORD = 0.08


def align(text, src, t0, t1):
    heard = [w for w in words_by_src[src] if t0 <= w["start"] <= t1]
    sheet = text.split()
    # Hyphenated sheet words match as their parts ("Eh-yeah" ~ "Eh" "yeah").
    parts = []  # (sheet index, normalised part)
    for i, s in enumerate(sheet):
        for p in s.split("-"):
            if norm(p):
                parts.append((i, norm(p)))
    a = [p for _, p in parts]
    b = [norm(w["word"]) for w in heard]
    sm = SequenceMatcher(None, a, b, autojunk=False)
    matched = {}  # part index -> heard index
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            for k in range(i2 - i1):
                matched[i1 + k] = j1 + k
        elif tag == "replace" and (i2 - i1) == (j2 - j1):
            for k in range(i2 - i1):  # same count, different spelling: a mishearing, keep the time
                matched[i1 + k] = j1 + k
    # First/last part of the window: anchor to the window if unmatched.
    starts = [None] * len(parts)
    for pi, hi in matched.items():
        starts[pi] = heard[hi]["start"]
    if starts[0] is None:
        starts[0] = heard[0]["start"] if heard else t0
    end_time = heard[matched[max(matched)]]["end"] if matched else t1
    if max(matched, default=-1) < len(parts) - 1:
        end_time = min(t1, max(end_time, (heard[-1]["end"] if heard else t1)))
    # Interpolate gaps.
    i = 0
    while i < len(starts):
        if starts[i] is None:
            j = i
            while j < len(starts) and starts[j] is None:
                j += 1
            lo = starts[i - 1]
            hi = starts[j] if j < len(starts) else end_time
            n = j - i + 1
            for k in range(i, j):
                starts[k] = lo + (hi - lo) * (k - i + 1) / n
            i = j
        else:
            i += 1
    # Collapse parts back to sheet words: a word starts at its first part.
    word_starts = []
    for i in range(len(sheet)):
        ps = [starts[pi] for pi, (si, _) in enumerate(parts) if si == i]
        word_starts.append(ps[0] if ps else None)
    for i, s in enumerate(word_starts):  # a punctuation-only token takes its neighbour's time
        if s is None:
            word_starts[i] = word_starts[i - 1] if i else t0
    unmatched = [sheet[si] for pi, (si, _) in enumerate(parts) if pi not in matched]
    return sheet, word_starts, end_time, unmatched


def finish(sheet, word_starts, end_time):
    out = []
    for i, (txt, st) in enumerate(zip(sheet, word_starts)):
        nxt = word_starts[i + 1] if i + 1 < len(sheet) else end_time
        en = max(st + MIN_WORD, nxt if i + 1 < len(sheet) else end_time)
        out.append({"text": txt, "start": round(st, 3), "end": round(en, 3)})
    # Enforce monotonic starts.
    for i in range(1, len(out)):
        if out[i]["start"] < out[i - 1]["start"] + MIN_WORD:
            out[i]["start"] = round(out[i - 1]["start"] + MIN_WORD, 3)
            out[i - 1]["end"] = out[i]["start"]
    return out


lines = []
report = []
for row in ROWS:
    section, kind, effect, text = row[:4]
    if isinstance(row[4], list):
        sheet = [w for w, _ in row[4]]
        starts = [s for _, s in row[4]]
        words = finish(sheet, starts, row[5])
        note = "manual"
    else:
        sheet, starts, end_time, unmatched = align(text, row[4], row[5], row[6])
        words = finish(sheet, starts, end_time)
        note = ("interp: " + " ".join(unmatched)) if unmatched else "ok"
    lines.append({
        "section": section, "kind": kind, "effect": effect, "text": text,
        "start": words[0]["start"], "end": words[-1]["end"], "words": words,
    })
    report.append(f"{words[0]['start']:7.2f}-{words[-1]['end']:7.2f} {effect:6} {text:50} {note}")

# Lines never overlap: a line ends where the next begins at the latest.
for a, b in zip(lines, lines[1:]):
    if a["end"] > b["start"]:
        a["end"] = b["start"]
        a["words"][-1]["end"] = min(a["words"][-1]["end"], b["start"])

json.dump(lines, open(os.path.join(HERE, "lines.json"), "w", encoding="utf8"), ensure_ascii=False, indent=1)
open(os.path.join(HERE, "lines_report.txt"), "w", encoding="utf8").write("\n".join(report))
print("\n".join(report))
