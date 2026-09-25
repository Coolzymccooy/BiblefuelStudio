export function buildFreeLeadMagnet(title){
  const verses = [
    { ref: "Philippians 4:6-7", text: "Do not be anxious about anything... the peace of God... will guard your hearts." },
    { ref: "1 Peter 5:7", text: "Cast all your anxiety on Him because He cares for you." },
    { ref: "Psalm 34:18", text: "The Lord is close to the brokenhearted." },
    { ref: "Isaiah 41:10", text: "Do not fear, for I am with you... I will strengthen you." },
    { ref: "Matthew 11:28", text: "Come to Me... and I will give you rest." },
    { ref: "Joshua 1:9", text: "Be strong and courageous... the Lord your God is with you." },
    { ref: "Psalm 56:3", text: "When I am afraid, I will trust in You." },
  ];
  const lines = [];
  lines.push(`# ${title}`);
  lines.push(``);
  lines.push(`A simple devotional from **@Biblefuel** to help you find calm, courage, and peace through God's Word.`);
  lines.push(``);
  verses.forEach((v, i) => {
    lines.push(`## Day ${i+1}: ${v.ref}`);
    lines.push(`**Verse:** ${v.text}`);
    lines.push(``);
    lines.push(`**Reflection:** Breathe. God is present. This moment does not control your future — God does.`);
    lines.push(``);
    lines.push(`**Prayer:** Lord, I give You what I cannot carry. Fill my heart with Your peace. Amen.`);
    lines.push(``);
  });
  lines.push(`---`);
  lines.push(`Want more? Check the **Biblefuel 30-Day Devotional**.`);
  return lines.join("\n");
}

export function buildPaidDevotional(title){
  const themes = [
    "Peace in anxiety","Strength in weakness","Trust in uncertainty","Hope in delay","Joy in hardship",
    "Guidance in decisions","Healing in heartbreak","Courage in fear","Patience in waiting","Faith in storms",
    "Grace in failure","Wisdom in words","Rest in God","Prayer as a habit","Forgiveness and freedom",
    "Purpose and calling","Contentment","Spiritual discipline","God’s presence","Love and compassion",
    "Renewed mind","Protection","Provision","Humility","Serving others","Identity in Christ",
    "The power of Scripture","Worship","Community","Endurance"
  ];
  const lines = [];
  lines.push(`# ${title}`);
  lines.push(``);
  lines.push(`A calm, simple 30-day devotional designed for daily consistency (5–7 minutes).`);
  lines.push(``);
  themes.forEach((t, i) => {
    lines.push(`## Day ${i+1}: ${t}`);
    lines.push(`**Verse:** (Add your chosen verse here)`);
    lines.push(``);
    lines.push(`**Reflection (2–4 lines):**`);
    lines.push(`- What is God teaching you about ${t.toLowerCase()}?`);
    lines.push(`- What can you release to God today?`);
    lines.push(``);
    lines.push(`**Prayer:**`);
    lines.push(`Lord, shape my heart today. Help me walk in ${t.toLowerCase()}. Amen.`);
    lines.push(``);
    lines.push(`**Journal prompt:**`);
    lines.push(`Write one sentence about what you will do today because of this verse.`);
    lines.push(``);
  });
  lines.push(`---`);
  lines.push(`**Bonus:** Recommended faith journals & devotionals (add your affiliate links).`);
  return lines.join("\n");
}
