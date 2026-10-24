# Cartoon mode: talking Bible cartoons under 40 seconds

Status: approved 2026-10-24. The operator delegated the open questions and told me to proceed with the build ("I commit you to make the decision on those questions on my behalf. Continue to implement").

Where something is marked **(my call)**, it is my decision under that delegation. Everything else is either the operator's decision or a fact measured in the test.

## 1. Intent

BibleFuel can already turn a written script into a narrated video (Scene script, "Human" mode). Cartoon mode adds a second kind of film: a short animated Bible story where the **characters speak their own lines on screen**, as in the talking-cartoon test of 2026-10-24.

The operator wants it to look more elegant and "next gen" than the test, with characters of their own choosing, not only the shepherd boy and the lamb. It should feel like a finished family-film short that a parent would share, not an AI demo.

**Why now.** The test showed it can be done cheaply (about $0.076 a second) with the tools already wired in. Short talking cartoons suit TikTok, Shorts and Reels, where the Sthill Waters and BibleFuel channels already post.

## 2. What the test proved (2026-10-24, files in `Documents\BibleFuel\talking-cartoon-test-2026-10-24`)

- Seedance 2.0 Mini with `generate_audio: true` costs the same as without audio: $1.14 for 15 s at 720p, 9:16.
- A line in quotes in the prompt is spoken word for word, with matching mouth movement.
- Starting a clip from the previous clip's last frame (`first_frame` role) gives a seamless join, and a cartoon frame is not refused the way a realistic face can be.
- Repeating one fixed description of each character in every prompt kept them recognisably the same across two shots.
- gpt-4o-transcribe heard the lines correctly; whisper-1 invented words on this audio.
- The finish (concat, verse card, music ducked under speech, gold kinetic captions, end card, -14 LUFS) made it look like a product.

**Not yet tested:** whether a character's *voice* stays the same from clip to clip; more than two shots; two characters speaking in one shot; a character portrait given to Seedance as a reference image; anything longer than 15 s. Phase C0 tests these before the build (section 9).

## 3. Goals

1. An admin picks **Human** or **Cartoon** when starting a Scene script. Cartoon opens the cartoon journey; Human is unchanged.
2. The script comes from either source: **BibleFuel writes it** from a verse or theme, or the admin **pastes their own**.
3. **Example scripts** are on hand to read and start from, and the empty editor shows a placeholder sample.
4. **Many characters and looks**: any cast the script names, in a choice of art styles. Not just a boy and a lamb.
5. Characters **speak their lines on screen**, word for word, in a voice that suits them.
6. **No cartoon is longer than 40 seconds.**
7. The finished film is polished: steady faces, clean audio, captions, a verse card and an end card, ready to post.
8. Cost is known before money is spent, and every paid clip is kept.

## 4. Non-goals

- Access for non-admin users (admins only for now).
- Films longer than 40 seconds, or multi-part series stitched into one long film.
- Generated music (music comes from the existing library).
- Text-to-speech voices lip-synced onto a cartoon (the voice comes from the video model).
- Calling the style "Pixar" anywhere: not in the UI, prompts, titles or posts, because it is a trademark **(my call)**. The style is named "3D family film".
- Any change to Human mode.

## 5. Anti-goals (it fails even if it "works" when...)

- The admin is surprised by a cost.
- The admin's words are rewritten: a pasted or approved script is spoken exactly as written.
- Garbled text appears in the picture (the video model never draws text; we draw all text).
- A character's face or voice visibly changes between shots.
- A mouth moves for the wrong speaker.
- Music drowns out speech.
- A cut lands in the middle of a word.

## 6. Constraints

- **40 s cap on the finished film, verse card and end card included (my call).** The story itself then gets about 35 s.
- Seedance clips are 4-12 s. Each spoken line must fit in one shot of at most 12 s; a longer line is refused at the script step with a note saying which line to shorten.
- **Admins only:** every route uses `requireSuperAdmin`, like Scene script today.
- **Spend:** every paid call goes through the spend ledger (`reserveSpend` / `settleSpend` / `releaseSpend` in `server/src/lib/videoGen/spend.js`) and the existing monthly cap.
- **Prod limits:** FFmpeg 5.1 on prod, no swap, Remotion renders take the heavy-job gate, files over 100 MB cannot pass Cloudflare. A 40 s 720p film is far under 100 MB.
- **Deploys kill running renders:** a cartoon must be restartable from its saved clips without paying again.
- Seedance today sends `generate_audio: false` (`submitSeedanceTask` in `seedance.js`); it needs a new option to turn audio on.
- The image chain (`generateBibleImage`) takes no reference images; character-consistent storyboard frames need a new path that sends the portraits to Gemini 2.5 Flash Image.

## 7. The journey

### 7.1 Start: Human or Cartoon
Starting a new Scene script shows two large choices, **Human** (today's flow, unchanged) and **Cartoon**. Cartoon projects are listed alongside Human ones in the project list, with a small "Cartoon" tag.

### 7.2 Script
Three ways in, on one screen:
- **Paste** a script into the editor. An empty editor shows a grey placeholder sample in the cartoon script format so the admin sees the shape at a glance.
- **Write it for me:** the admin gives a verse or a theme, and optionally the cast and a style. BibleFuel drafts a script that fits the 40 s rule. The draft opens in the same editor; from then on it is the admin's text and is spoken exactly as written.
- **Start from an example:** a shelf of example scripts. Opening one copies it into a new project with its cast and style ready.

**Example scripts (my call on the titles; I write them during the build and the operator reviews them):**
1. *The Lost Lamb* (Luke 15:4): the test, redone at the new quality bar.
2. *David and the Giant* (1 Samuel 17:45): David, Goliath (seen mostly from below), a soldier.
3. *Jonah Says No* (Jonah 1:3; 2:10): Jonah, a sailor, the great fish.
4. *Five Loaves and Two Fish* (John 6:9): the boy with the basket, Andrew.
5. *Ruth Stays* (Ruth 1:16): Ruth and Naomi.

**A live meter** under the editor shows the estimated length out of 40 s and the estimated cost. Over 40 s, the Next button is disabled and the meter names the scene to trim.

**Cartoon script format (my call):**

```
# The Lost Lamb
Verse: Luke 15:4
Style: 3D family film

Cast:
- Eli: a shepherd boy about eight, curly dark hair, brown wool tunic, big warm brown eyes. Voice: bright and eager.
- Pip: a small fluffy white lamb with a pink nose and one black ear. Voice: tiny and soft.

Scene: Hillside at dusk, wide
Eli: "Pip? Pip, where are you?"
(Pip bleats from behind a rock.)

Scene: Behind the rock, close-up
Pip: "I'm stuck, Eli!"
Eli: "I've got you. I'll always come for you."
```

- `Name: "line"` is a spoken line. `(text in brackets)` is action with no speech. `Scene:` starts a new place; the text after the comma is the director's note.
- The parser is deterministic (no LLM), like Human mode's. Unknown lines are listed as ignored, never silently dropped.

**Jesus as a character (my call, delegated by the operator 2026-10-24):** Jesus may appear and speak, but in BibleFuel-written scripts and in the examples he speaks only words quoted exactly from scripture, never invented dialogue, and is always shown with reverence (no slapstick, no comic voice). A pasted script is still spoken exactly as the admin wrote it.

**What "write it for me" must obey:** at most 3 speaking characters, at most 8 shots, each line at most about 25 words, a total that fits 35 s, and the verse quoted exactly from the Bible text BibleFuel already holds (the LLM never types the verse itself).

### 7.3 Cast
One card per character: name, look (a fixed description repeated in every prompt), voice note (for example "deep, slow, kind"), and a **portrait** made from the look in the chosen style (about $0.04 each). The admin can re-make a portrait until it is right, then approves it.

Approved characters are saved to the admin's **character shelf** and can be reused in later cartoons, so a recurring character (Eli and Pip, say) looks the same across a series.

### 7.4 Style
One art style per film, chosen once:
- **3D family film** (default): soft global light, rounded shapes, expressive large eyes, rich colour.
- **Storybook:** painted, textured, warm paper tones.
- **Claymation:** handmade clay look, gentle stop-motion feel.

The style text is added to every portrait, storyboard and clip prompt.

### 7.5 Storyboard
One still per shot, made with Gemini 2.5 Flash Image using the approved portraits as references (about $0.04 each). They show as a filmstrip with each shot's line beneath. The admin approves the whole strip in one tap, or re-makes any frame. This is the cheap place to catch a wrong face or a bad composition before paying for video.

Each shot has a **director's note** (close-up, wide, over-the-shoulder, slow push-in, and so on), taken from the script or chosen automatically, and editable.

### 7.6 Film
**What one shot is (my call):** one spoken line is one shot. An action line in brackets joins the shot before it in the same scene; at the start of a scene it becomes its own silent shot of 4 s. So the number of paid clips is the number of lines plus any scene-opening actions, at most 8. This is a new planner: Human mode's `planShots` splits by time and knows nothing of speakers.

Each shot becomes one Seedance 2.0 Mini clip, 720p, with `generate_audio: true`:
- **One speaker per shot,** named in the prompt with their look and voice note. The quoted line is the only speech in the prompt. Shots with only action are marked silent ("no one speaks").
- **The first frame** is the previous clip's last frame when the shot continues the same moment, or the shot's storyboard still when it cuts to a new angle (my call: the planner decides from whether the scene changes; the admin can flip it).
- **Shot length** is worked out from the line: words at about 2.5 a second, plus a breath, between 4 and 12 s (my call on the rate; C0 confirms it).
- The prompt asks for no background music (our music goes on later) and carries the existing "no text" line.
- Shots that start from a storyboard still are ordered in parallel; continuing shots wait for the shot before them.
- The price is shown before the order; the $10 benchmark warning from Human mode applies. A full cartoon should come in around $3.
- Any single shot can be re-made. A re-make never deletes the old clip; every paid clip goes into the visual library.

**Speech check:** after each clip arrives, its audio is transcribed with gpt-4o-transcribe and compared with the script line. A clip whose speech differs is flagged "Speech doesn't match" with a Re-make button. It is never re-made automatically, because that costs money.

**Before any order, the whole film must fit the monthly cap (my call).** The estimate for every shot not yet made is checked against what is left of the monthly AI video cap (`VIDEO_GEN_MONTHLY_CAP_USD`, shared with every other AI video feature). If it does not fit, nothing is ordered, and the message names the amount short. A film is never left half-made because the cap ran out partway.

**When a shot can't be made as planned (my call):**
- *A still or clip is refused as a real person.* Today `submitSeedanceTask` quietly falls back to text only, which would drop the approved face. Cartoon shots turn that fallback off: the shot is marked "Refused" and the admin re-makes the still. Nothing is charged for the refusal.
- *A clip fails.* Its reservation is released (no charge). Shots chained from its last frame wait, and one Retry re-orders the failed shot and then the ones waiting on it.
- *A middle shot is re-made.* The next shot, if it was chained from this one's last frame, is marked "Out of date: starts from the old frame". The admin can re-make it, with the price shown, or keep it. It is never re-made automatically.

### 7.7 Finish and render
Rendered with Remotion, as in Human mode:
- the clips in order, with their own audio: the dialogue and the natural sound Seedance adds (wind, footsteps, a bleat). The prompt asks for no music (my call);
- a music bed from the library, ducked automatically under speech. The speech windows come from the clip audio itself, found by silence detection, not from a transcript (my call: gpt-4o-transcribe gives no word times, and whisper-1 invents words on this audio). If C0 shows Seedance adds its own music despite the prompt, the bed is off by default for cartoons;
- kinetic captions of the dialogue (on by default, one switch turns them off), with the speaker's name in a small label the first time each character speaks (my call);
- an opening verse card and the end card;
- loudness to -14 LUFS.

The result goes to the admin's outputs with the existing Publish options (YouTube, TikTok). The thumbnail is the best storyboard still, and the post caption carries the verse.

### 7.8 Formats
9:16 by default. 16:9 needs Human mode's landscape layout (Phase 2 slice E) first, so it comes in C2.

## 8. Quality bar ("next gen")

1. Faces stay the same: approved portraits are the reference for every storyboard still, and continuing shots chain last frame to first frame.
2. Voices stay the same: the same voice note in every prompt for a character, plus whatever C0 proves works (a fixed seed, a reference clip). **Fallback if C0 shows voices drift:** narrator-led cartoons where characters say only short lines, so a change is hard to hear.
3. Only the speaker's mouth moves: one speaker per shot.
4. Music never covers speech: automatic ducking, checked in the render.
5. No garbled text: the video and image models are told to draw no text; all text is ours.
6. No cut inside a word: shots end on a breath, and the render trims to it.
7. The spoken words match the script: the speech check flags any clip that drifts.

## 9. Phases

**C0, spike (paid, about $3-4, hard stop at $5; spend approved under the operator's delegation of 2026-10-24).** One throwaway run, outside the product:
- one character in 3 shots, to hear whether the voice stays the same (with and without a fixed seed);
- a portrait sent as a reference image, to see whether faces hold better than with a description alone;
- 4 shots chained from last frames;
- two characters speaking in one shot, to see whether the right mouth moves;
- two or three Gemini storyboard stills made from one approved portrait, to see whether Gemini holds the face (every first frame depends on it). The local Gemini key has no image quota, so this part uses the prod key or a billed key;
- whether Seedance adds its own music when the prompt asks for none;
- a measured speaking rate, for the shot-length rule.

The result decides the prompt template, whether two-speaker shots are allowed, and whether the voice fallback is needed. It is reported back before C1 starts.

**C1, the full journey:** the Human/Cartoon choice; script paste, write and examples with the live meter; cast with portraits and the character shelf; style; storyboard; film with the speech check; finish, render and publish; ledger and library throughout; admins only.

**C2, polish:** 16:9 (after slice E); picking the thumbnail from any frame; more example scripts and styles; series of cartoons sharing a cast.

## 10. Left to the builder

- Storage shape. My suggestion: the same per-user Scene script store with `mode: "cartoon"` and the extra fields (style, cast with portraits, storyboard, per-shot first-frame source, speech check), so the project list, library, render jobs and restart logic are reused.
- Route names (under `/api/scene-script`, admins only).
- How caption word timings are found. The script text is always what is shown; timings may come from whisper-1 word times aligned with `alignWords`, falling back to `spreadWords` across the speech window found by silence detection.
- Prompt wording, within the rules above.
- How many shots are ordered at once.

## 11. Tests

- Parser: the format above, ignored lines, a line too long for one shot, over 40 s.
- Shot length and the 40 s total, including the cards.
- Prompt builder: names the one speaker, repeats the look and voice note, marks silent shots, adds the style and the no-text line, never contains "Pixar".
- Cost estimate and the ledger: reserve, settle, release on refusal.
- Speech check scoring against a script line.
- Routes refuse non-admins.
- An end-to-end run with Seedance, Gemini and transcription stubbed.

## 12. Success

- From an example script, an admin gets a finished 35-40 s talking cartoon for under $4.
- Faces and voices hold across shots; no garbled text; every line is spoken as written.
- The operator would post it without apology.
