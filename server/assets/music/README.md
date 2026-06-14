# Default music library

23 royalty-free gospel/worship/cinematic beds, free for commercial use (no
attribution required). The manifest that maps each file to a library id, label,
and mood lives in `server/src/lib/musicLibrary.js`.

To change a track: overwrite the file, KEEPING the same filename. To add/remove
tracks or change labels/moods/the default, edit the manifest (and update the
counts in `server/src/lib/musicLibrary.test.js`).

The five `*-gospel-*` / `nothing-compares` tracks are gospel SONGS with vocals —
they are selectable but are labelled "(vocal)" because lyrics clash when used as
a bed under narration. The auto-applied default (`01-peaceful-worship.mp3`) is an
instrumental calm worship piano track, safe to sit under a voiceover.
