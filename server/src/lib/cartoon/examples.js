/**
 * The example cartoon scripts on the "Start from an example" shelf (spec
 * section 7.2). Opening one copies its script into a new project, so each must
 * parse cleanly, fit the 40 second rule with room to spare, and be good enough
 * to film as it stands.
 *
 * Every cast look is specific (age, skin, hair, clothing colours and one
 * distinctive detail) because it is repeated in every clip prompt and drives
 * the character portrait. Every line is one speaker and at most 18 words, so it
 * fits one shot. The last line lands the verse's point. A cast member may act
 * without speaking (the great fish in Jonah), and then needs no voice note.
 *
 * Jesus appears only in "Five Loaves and Two Fish", and says only the King
 * James words of John 6:10 ("Make the men sit down."), shown with reverence.
 * Its verse is the range John 6:9-10 so the scripture check sees his words.
 * `unquotedJesusLines` in scripture.js checks this in the tests.
 */

const LOST_LAMB = `# The Lost Lamb
Verse: Luke 15:4
Style: 3D family film

Cast:
- Eli: a shepherd boy about eight, warm light-brown skin, curly dark hair, brown wool tunic with a red woven belt, carrying a little wooden crook taller than he is. Voice: bright and eager, a young boy.
- Pip: a small fluffy white lamb with a pink nose, one black ear and a tiny brass bell on a blue ribbon round its neck. Voice: tiny, soft and wobbly.
- Grandma: Eli's grandmother about seventy, deep olive skin with smile lines, a long silver braid under a saffron-yellow headscarf, holding a glowing clay lantern. Voice: low, slow and kind, an old woman.

Scene: The sheepfold at sunset, wide, the flock settling behind a low stone wall
Grandma: "Ninety-nine sheep are home, Eli. But I can't hear Pip's little bell."
Eli: "Then I'm going to find Pip. Keep the lantern lit!"
(Eli runs out through the gate, crook in hand.)

Scene: A rocky hillside at dusk, low angle, wind moving through the long grass
Eli: "Pip? Pip, where are you?"
(A faint bell tinkles from behind a big rock.)

Scene: Behind the rock, close-up, a lamb caught in a thorn bush
Pip: "I'm stuck in the thorns, Eli! I thought nobody would come."
(Eli gently lifts Pip free and hugs the lamb close.)
Eli: "Ninety-nine were safe, but you were lost. So I came for you."
`;

const DAVID_GIANT = `# David and the Giant
Verse: 1 Samuel 17:45
Style: 3D family film

Cast:
- David: a shepherd boy about twelve, sun-browned skin, wild copper-red curls, a sheepskin vest over a cream tunic, a leather sling wrapped round one wrist. Voice: clear, steady and brave, a boy.
- Ronen: a soldier of Israel about fifty, dark brown skin, a grey-flecked beard, a dented bronze helmet and a battered round wooden shield. Voice: gruff and worried, an older man.
- Goliath: an enormous Philistine warrior, sun-bronzed weathered skin, a black braided beard, gleaming bronze armour and a spear as long as a tree. Voice: deep, booming and slow.

Scene: Israel's camp on the hillside, morning, wide over the tents
Ronen: "Nobody will fight him, boy. Look at the size of him!"
David: "God saved me from a lion. He will save me today."
(David kneels at the stream and picks five smooth stones.)

Scene: The valley floor, low angle looking far up at Goliath
Goliath: "Ha! They sent a little shepherd boy to fight me?"

Scene: The valley floor, close-up on David looking up, wind in his hair
David: "You trust your sword and spear. I trust the living God."
(David swings his sling once, twice, and lets the stone fly.)

Scene: Israel's camp, wide, soldiers cheering and raising their shields
Ronen: "The giant fell! The boy was small, but his God is great."
`;

const JONAH = `# Jonah Says No
Verse: Jonah 2:10
Style: Claymation

Cast:
- Jonah: a prophet about forty, tan skin, a bushy black beard, big worried eyebrows, a rumpled mustard-yellow robe and a bulging travel sack. Voice: grumbly and nervous, a grown man.
- Captain: an old sea captain about sixty-five, deep brown skin, white stubble, a striped red-and-white headwrap and a gold hoop earring. Voice: rough, loud and salty, an old sailor.
- Fish: a gigantic friendly blue-grey fish shaped like a whale, barnacles on its nose, tiny kind eyes and a wide gentle smile.

Scene: A small wooden ship in a wild storm, wide, rain lashing the deck
Captain: "Wake up! This storm will sink us! Who are you running from?"
Jonah: "From God. He said go to Nineveh, and I said no."
(Jonah hangs his head as a huge wave rises over the ship.)

Scene: Inside a giant creature's dark belly, close-up, lit by glowing green seaweed
Jonah: "I was wrong, Lord. I'm sorry. Please give me another chance."
(A warm golden light fills the belly, and everything gently tilts upward.)

Scene: A sunny beach at dawn, wide, Jonah sitting up in the wet sand beside the great fish in the shallows
Jonah: "The Lord told the fish to let me go! A second chance!"
(The great fish gives Jonah a gentle nudge with its nose, then splashes away.)
Jonah: "This time, Lord, I'll go wherever you send me."
`;

const LOAVES_FISHES = `# Five Loaves and Two Fish
Verse: John 6:9-10
Style: 3D family film

Cast:
- Tobi: a boy about nine, dark brown skin, short tight curls, a gap-toothed grin, a sky-blue tunic, carrying a small woven basket under a red checked cloth. Voice: shy but bright, a young boy.
- Andrew: a fisherman about thirty-five, ruddy tanned skin, sandy-brown hair and beard, a green tunic with the sleeves rolled up, rope-worn hands. Voice: friendly and practical, a grown man.
- Jesus: a man about thirty, warm olive-brown skin, dark shoulder-length hair and a short beard, kind dark eyes and a calm, steady gaze, a cream linen robe with a deep blue sash. Voice: warm, calm and gentle, a grown man.

Scene: A grassy hillside crowded with families, wide, late afternoon
Andrew: "Thousands of hungry people, and no food anywhere. What can we do?"
Tobi: "I have my lunch, sir. You can have all of it."
(Tobi lifts the cloth: five small loaves and two little fish.)
Andrew: "That's kind, Tobi, but it's barely enough for one."

Scene: Beside Jesus on the hillside, slow push-in, soft golden light
Jesus: "Make the men sit down."
(Jesus takes Tobi's basket, looks up to heaven and gives thanks.)

Scene: The hillside at sunset, wide, families sharing bread and fish
Tobi: "I only gave my little lunch, and Jesus made it enough for everyone."
`;

const RUTH = `# Ruth Stays
Verse: Ruth 1:16
Style: Storybook

Cast:
- Naomi: a widow about sixty, weathered tan skin, grey hair under a faded plum-purple shawl, tired gentle eyes, leaning on a knotted walking stick. Voice: soft, low and weary, an older woman.
- Ruth: a young widow about twenty-five, deep brown skin, long black braids wrapped in a rust-orange headscarf, a cream dress and a small bundle tied on her back. Voice: quiet, warm and determined, a young woman.

Scene: A dusty crossroads at sunrise, wide, the road to Bethlehem stretching away
Naomi: "Go home, dear Ruth. I have nothing left to give you."
Ruth: "I don't need anything, Naomi. I just want to be with you."
(Ruth takes Naomi's wrinkled hands in hers.)

Scene: The crossroads, close-up on both faces, soft morning light
Ruth: "You showed me your God is faithful. Now he's my God too."
Naomi: "Then come, my daughter. We'll go home to Bethlehem together."

Scene: The road to Bethlehem, three-quarter side angle on both faces as they walk, warm golden light
Ruth: "From now on, Naomi, you'll never walk this road alone."
(They walk on arm in arm into the golden light.)
`;

function example(id, title, verse, blurb, markdown) {
  return Object.freeze({ id, title, verse, blurb, markdown });
}

/** The example shelf, in the order it is shown. */
export const EXAMPLES = Object.freeze([
  example("lost-lamb", "The Lost Lamb", "Luke 15:4",
    "A shepherd boy leaves ninety-nine safe sheep to find one little lamb lost in the thorns.", LOST_LAMB),
  example("david-giant", "David and the Giant", "1 Samuel 17:45",
    "A young shepherd faces a giant with a sling, five stones and a big trust in God.", DAVID_GIANT),
  example("jonah", "Jonah Says No", "Jonah 2:10",
    "Jonah runs away from God, ends up inside a great fish and is given a second chance.", JONAH),
  example("loaves-fishes", "Five Loaves and Two Fish", "John 6:9-10",
    "A boy shares his small lunch, and Jesus feeds a whole hillside of families with it.", LOAVES_FISHES),
  example("ruth", "Ruth Stays", "Ruth 1:16",
    "Ruth chooses to stay with Naomi on the long road home and to trust Naomi's God.", RUTH),
]);

/** The grey sample an empty script editor shows. */
export const PLACEHOLDER = EXAMPLES[0].markdown;
