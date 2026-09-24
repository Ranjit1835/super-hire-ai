import type { Article } from "./types";

export const aiMockInterviewGuide: Article = {
  slug: "ai-mock-interview-guide",
  category: "Interviews",
  title: "How to Use AI Mock Interviews to Prepare for Placements and Jobs",
  seoTitle: "AI Mock Interview: How to Practise and Actually Improve",
  description:
    "How AI mock interviews work, a 2-week practice plan, how to answer technical and HR questions out loud, and how to use your feedback report to improve.",
  published: "2026-09-24",
  updated: "2026-09-24",
  readMinutes: 6,
  keywords: ["AI mock interview", "mock interview online free", "interview practice", "mock interview for freshers", "HR interview practice"],
  body: [
    { type: "p", text: "Most candidates prepare for interviews by reading questions and answers. Then, in the real interview, they find that knowing an answer and **saying it clearly under pressure** are different skills. Mock interviews close that gap — and AI mock interviews let you practise any time, as often as you need, without booking a senior or a friend." },

    { type: "h2", text: "How an AI mock interview works" },
    { type: "ol", items: [
      "You choose a role or topic — for example SQL, Java, HR round or a company-style fresher round.",
      "The AI interviewer asks a question out loud. You answer by speaking (or typing).",
      "Based on your answer, it asks a follow-up: deeper if you did well, simpler or a different angle if you struggled.",
      "At the end you get a report: scores for technical depth, communication and structure, the exact moments that went well or badly, and what to practise next.",
    ] },
    { type: "tip", title: "Why follow-ups matter", text: "Real interviewers rarely ask a list of unrelated questions. They dig into your answer. Practice that only uses fixed question lists does not prepare you for “Why?” and “What would happen if…?”." },

    { type: "h2", text: "A 2-week practice plan" },
    { type: "table", head: ["Days", "Focus", "What to do"], rows: [
      ["1–2", "Baseline", "One full interview in your main skill and one HR round. Don’t prepare — you want an honest starting point."],
      ["3–6", "Weakest topics", "Read up on the 2–3 lowest-scoring topics from your report, then take a short interview on just those."],
      ["7", "HR and projects", "Practise “Tell me about yourself”, your final-year project, and “Why this company?” until each is under 2 minutes."],
      ["8–12", "Mixed rounds", "One interview a day, alternating technical and HR. Compare reports: are the same gaps repeating?"],
      ["13–14", "Simulation", "Full rounds in the time and conditions of the real thing — quiet room, headphones, no notes."],
    ] },

    { type: "h2", text: "How to answer out loud" },
    { type: "h3", text: "Technical questions: define, explain, example" },
    { type: "example", bad: "“Normalisation is… removing redundancy. Like 1NF, 2NF, 3NF.”", good: "“Normalisation is organising tables to reduce duplicate data and update problems. For example, if a student table stores the department name on every row, renaming a department means updating hundreds of rows. In 3NF we move department into its own table and store only the department ID.”", note: "Definition → why it matters → a concrete example. Interviewers look for the example." },
    { type: "h3", text: "HR and behavioural questions: STAR" },
    { type: "p", text: "Use **Situation, Task, Action, Result**: a sentence of context, what you had to do, what *you* did, and what happened — with a number if possible. Keep it to about 60–90 seconds." },
    { type: "h3", text: "When you don’t know" },
    { type: "p", text: "Say what you do know and reason aloud: “I haven’t used Kafka directly, but I understand it is a message queue for streaming events; I’d expect it to be used where…”. A calm, honest partial answer scores far better than silence or bluffing." },

    { type: "h2", text: "Getting the most from your feedback" },
    { type: "ul", items: [
      "**Read the evidence, not just the score.** Good reports quote your own words; look at what exactly was weak.",
      "**Track two numbers across attempts** — your weakest topic score and your communication score — rather than the overall number.",
      "**Watch your filler words and pace.** If the report shows many “umm/like” or very fast speech, practise pausing instead.",
      "**Re-take the same topic** after studying it. Improvement on the same topic is the clearest sign you are ready.",
    ] },

    { type: "h2", text: "Set up for a good session" },
    { type: "ul", items: [
      "Use Chrome or Edge on a laptop; allow microphone access.",
      "Use earphones with a mic in shared rooms or labs — it makes speech recognition much more accurate.",
      "Sit somewhere quiet and speak at a normal pace, facing the mic.",
    ] },

    { type: "h2", text: "Try it" },
    { type: "p", text: "HiResume’s AI voice interviewer adapts its questions to your answers and gives an evidence-based report at the end. Many colleges and training institutes also use it to run placement practice for whole batches — see [HiResume for colleges](/college-placement)." },
    { type: "cta", kind: "interview" },
  ],
  faq: [
    { q: "Are AI mock interviews useful for campus placements?", a: "Yes — they are useful for practising technical rounds on core subjects (DBMS, OOP, DSA, a programming language) and HR rounds, as often as needed, with feedback on both content and communication." },
    { q: "Can I practise a mock interview by voice?", a: "Yes. HiResume’s interviewer speaks its questions and listens to your spoken answers in Chrome or Edge. You can switch to typing if speech recognition is not available." },
  ],
};
