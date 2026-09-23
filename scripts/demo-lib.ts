// ─── Demo institution generator (pure, deterministic) ────────────────────────
// Builds "Demo Engineering College": ~40 fictional students, realistic transcripts,
// timings and evaluations. Scores are produced by the SAME code the real pipeline uses
// (audio metrics + evaluator validation/grounding + readiness rule), so the dashboard,
// reports and exports behave exactly as they will for a real college.
import type { ModuleSpec } from "../supabase/functions/_shared/module-spec.ts";
import { computeAudioMetrics, type AudioMetrics } from "../supabase/functions/_shared/audio-metrics.ts";
import {
  DIMENSIONS, EVALUATOR_PROMPT_VERSION, validateEvaluation, type Dimension, type EvaluationResult,
} from "../supabase/functions/_shared/evaluator.ts";

export const DEMO_EMAIL_DOMAIN = "demo.hiresume.invalid";
export const DEMO_SLUG = "demo-engineering-college";

// ── Deterministic RNG ────────────────────────────────────────────────────────
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    between: (lo: number, hi: number) => lo + next() * (hi - lo),
    int: (lo: number, hi: number) => Math.floor(lo + next() * (hi - lo + 1)),
    pick: <T,>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)],
    shuffle: <T,>(xs: readonly T[]) => {
      const a2 = [...xs];
      for (let i = a2.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [a2[i], a2[j]] = [a2[j], a2[i]]; }
      return a2;
    },
  };
}
type Rng = ReturnType<typeof rng>;

// ── Content bank ─────────────────────────────────────────────────────────────
interface TopicContent { q: string; facts: [string, string, string]; example: string; wrong: string }

const CONTENT: Record<string, TopicContent> = {
  // SQL
  "Joins": { q: "Can you explain the difference between an inner join and a left join?", facts: ["An inner join returns only the rows that have matching values in both tables.", "A left join returns every row from the left table and fills nulls where there is no match on the right.", "The join condition is usually on a foreign key like department id."], example: "For example, joining employees with departments on department id shows which employee works where.", wrong: "A left join and an inner join give the same result, only the order of columns changes." },
  "Aggregates with GROUP BY": { q: "How would you find the number of employees in each department?", facts: ["I would use COUNT with GROUP BY on the department column.", "HAVING is used to filter groups after aggregation, while WHERE filters rows before grouping.", "Every non-aggregated column in the select list must be in the GROUP BY."], example: "For example, select department, count star from employees group by department having count greater than five.", wrong: "We can use WHERE count greater than five directly to filter the departments." },
  "Subqueries": { q: "How would you find the second highest salary?", facts: ["I can select the maximum salary where salary is less than the maximum salary from a subquery.", "A correlated subquery runs once for every row of the outer query.", "Another way is using DENSE_RANK over salary in descending order and picking rank two."], example: "For example, select max salary from employees where salary is less than select max salary from employees.", wrong: "We can just order by salary and take the second row, duplicates do not matter." },
  "Indexes": { q: "What is an index and when would you avoid creating one?", facts: ["An index is a data structure, usually a B-tree, that makes lookups on a column faster.", "Indexes speed up reads but slow down inserts and updates because the index must also be updated.", "Columns with very few distinct values or small tables often do not benefit from an index."], example: "For example, an index on the email column makes login lookups fast.", wrong: "An index is a backup copy of the table that the database uses if the table is lost." },
  "Normalization": { q: "What is normalization and why do we do it?", facts: ["Normalization organises tables to reduce redundancy and avoid update anomalies.", "First normal form needs atomic values, second removes partial dependency, and third removes transitive dependency.", "Sometimes we denormalize for reporting performance."], example: "For example, storing the department name in every employee row repeats data, so we move it to a department table.", wrong: "Normalization means converting all the values in a table to lowercase so they are consistent." },
  "Transactions and ACID": { q: "What does ACID mean in the context of transactions?", facts: ["ACID stands for atomicity, consistency, isolation and durability.", "Atomicity means all steps of a transaction happen or none of them happen, so we roll back on failure.", "Durability means once committed, the data survives a crash."], example: "For example, in a bank transfer the debit and the credit must both succeed or both be rolled back.", wrong: "ACID is a type of index that makes the queries faster." },
  // Java
  "OOP basics": { q: "What are the four pillars of object-oriented programming?", facts: ["The four pillars are encapsulation, abstraction, inheritance and polymorphism.", "A class is a blueprint and an object is an instance of that class with its own state.", "Encapsulation hides data using private fields and exposes it through methods."], example: "For example, a BankAccount class keeps the balance private and exposes deposit and withdraw methods.", wrong: "OOP means writing the whole program inside the main method in an organised way." },
  "Inheritance and polymorphism": { q: "What is the difference between method overloading and overriding?", facts: ["Overloading is the same method name with different parameters in the same class, decided at compile time.", "Overriding is a subclass giving its own implementation of a parent method, decided at runtime.", "Runtime polymorphism lets a parent reference call the child's overridden method."], example: "For example, a Shape reference pointing to a Circle calls the Circle's area method.", wrong: "Overloading and overriding are the same thing, both just mean using a method many times." },
  "Interfaces and abstraction": { q: "When would you use an interface instead of an abstract class?", facts: ["An interface defines a contract that many unrelated classes can implement.", "A class can implement multiple interfaces but extend only one abstract class.", "An abstract class can hold state and constructors, which an interface cannot."], example: "For example, both a Printer and a Scanner can implement a Connectable interface.", wrong: "An interface is used only for connecting Java to a database." },
  "Exception handling": { q: "What is the difference between checked and unchecked exceptions?", facts: ["Checked exceptions must be handled or declared with throws, and the compiler enforces it.", "Unchecked exceptions extend RuntimeException and usually indicate programming errors.", "The finally block runs whether or not an exception occurs, so we close resources there."], example: "For example, IOException is checked, while NullPointerException is unchecked.", wrong: "Checked exceptions are the ones that we already tested, unchecked ones are not tested yet." },
  "Strings and immutability": { q: "Why are strings immutable in Java?", facts: ["Strings are immutable so they can be safely shared from the string pool.", "Immutability makes strings thread safe and safe to use as HashMap keys.", "StringBuilder is used when we need to modify text many times."], example: "For example, concatenating in a loop creates many objects, so StringBuilder is better.", wrong: "Strings are immutable because Java does not allow changing any variable after it is declared." },
  "Collections basics": { q: "How is an ArrayList different from a LinkedList?", facts: ["An ArrayList is backed by an array, so random access by index is fast.", "A LinkedList uses nodes, so inserting in the middle is cheaper but access by index is slow.", "Both implement the List interface and keep insertion order."], example: "For example, I would use an ArrayList for a list of students that we mostly read by index.", wrong: "ArrayList stores only numbers while LinkedList stores only strings." },
  // DSA
  "Time complexity": { q: "What is the time complexity of binary search, and why?", facts: ["Binary search is O of log n because it halves the search space every step.", "Big O describes how running time grows with input size in the worst case.", "A nested loop over the same array is usually O of n squared."], example: "For example, searching one million sorted numbers takes about twenty comparisons.", wrong: "Binary search is O of n because it has to look at every element once." },
  "Arrays and strings": { q: "How would you check if a string is a palindrome?", facts: ["I would use two pointers, one from the start and one from the end, and compare characters.", "If all pairs match until the pointers meet, it is a palindrome.", "This takes linear time and constant extra space."], example: "For example, for madam the pointers compare m with m, a with a, and stop at d.", wrong: "I would sort the string and check if the sorted string is the same as the original." },
  "Linked lists": { q: "How would you find the middle of a linked list in one pass?", facts: ["I would use a slow pointer that moves one step and a fast pointer that moves two steps.", "When the fast pointer reaches the end, the slow pointer is at the middle.", "The same idea detects a cycle, because the pointers meet if there is a loop."], example: "For example, in a list of five nodes the slow pointer stops at the third node.", wrong: "I would count the nodes and then the middle is always the head of the list." },
  "Stacks and queues": { q: "How would you check whether brackets in an expression are balanced?", facts: ["I would push every opening bracket onto a stack.", "For a closing bracket I pop and check that it matches the opening one.", "At the end the stack must be empty for the expression to be balanced."], example: "For example, for open brace, open bracket, close bracket, close brace every pop matches.", wrong: "I would use a queue so the first bracket is always checked with the last bracket." },
  "Hashing": { q: "How would you find duplicates in an array efficiently?", facts: ["I would insert elements into a HashSet and report any element that is already present.", "Hash lookups are average constant time, so the whole check is linear.", "Collisions are handled with chaining or open addressing."], example: "For example, for the array three, one, three the set already has three when we see it again.", wrong: "Hashing means encrypting the array so duplicates are removed automatically." },
  "Binary search": { q: "What conditions must hold before you can apply binary search?", facts: ["The data must be sorted, otherwise we cannot discard half of the range.", "We compare with the middle element and move the low or high boundary.", "The loop stops when low crosses high, which means the element is absent."], example: "For example, to find twenty in a sorted list we check the middle and move right if it is smaller.", wrong: "Binary search works on any array because it checks elements in pairs." },
  // HR
  "Self introduction": { q: "Please introduce yourself.", facts: ["I am a final-year computer science student and I enjoy building backend applications.", "I have worked on a college project using Java and MySQL and I completed an internship at a local startup.", "Outside academics I coordinate the coding club and practise problems regularly."], example: "Recently I led a team of four for our department tech fest website.", wrong: "My name is as per the resume, I am from the college, that's all." },
  "Final-year project": { q: "Tell me about your final-year project and your role in it.", facts: ["Our project is an attendance system that uses face recognition and stores records in a database.", "I built the backend APIs and designed the database schema.", "The biggest challenge was accuracy in low light, so we added image preprocessing."], example: "We reduced wrong matches by adjusting the threshold after testing with fifty students.", wrong: "The project was done by the team, I don't remember the exact technology used." },
  "Teamwork and conflict": { q: "Describe a time you had a disagreement in a team and how you handled it.", facts: ["During our project two members wanted different databases, so we listed the pros and cons together.", "I suggested a small prototype with both options to decide with data.", "We agreed on the option that met the deadline and I documented the decision."], example: "The prototype showed that MySQL was simpler for our team, so everyone accepted it.", wrong: "I don't face conflicts, I usually just do what others say." },
  "Strengths and weaknesses": { q: "What is one strength and one weakness of yours?", facts: ["My strength is consistency, I practise coding problems every day.", "My weakness was public speaking, so I joined the college debate club to improve.", "I now volunteer to present our project reviews."], example: "Last semester I presented our project to the external examiner without notes.", wrong: "My weakness is that I work too hard, and I have no other weakness." },
  "Career goals": { q: "Where do you see yourself in the next three years?", facts: ["I want to grow as a backend developer and understand how large systems are designed.", "I plan to learn cloud deployment and get certified in the first two years.", "I would like to mentor juniors once I am confident in the domain."], example: "I have already started an online course on cloud fundamentals.", wrong: "I am not sure, I will see what the company gives me." },
};

const FOLLOW_UPS = ["Can you give me a concrete example of that?", "What happens in an edge case, for example with duplicate or missing values?", "How would you explain that to a junior who is new to it?"];
const FILLERS = ["basically", "actually", "like", "you know", "um", "uh"];

export const DEMO_MODULES: Array<{ key: string; spec: ModuleSpec }> = [
  { key: "sql", spec: { name: "SQL", type: "skill", description: "Relational databases and writing queries.", topics: ["Joins", "Aggregates with GROUP BY", "Subqueries", "Indexes", "Normalization", "Transactions and ACID"], pass_threshold: 6, max_turns: 10, max_minutes: 15 } },
  { key: "java", spec: { name: "Java Fundamentals", type: "skill", description: "Core Java and OOP at fresher depth.", topics: ["OOP basics", "Inheritance and polymorphism", "Interfaces and abstraction", "Exception handling", "Strings and immutability", "Collections basics"], pass_threshold: 6, max_turns: 10, max_minutes: 15 } },
  { key: "dsa", spec: { name: "DSA Basics", type: "skill", description: "Data structures and problem-solving approach.", topics: ["Time complexity", "Arrays and strings", "Linked lists", "Stacks and queues", "Hashing", "Binary search"], pass_threshold: 6, max_turns: 10, max_minutes: 18 } },
  { key: "hr", spec: { name: "HR / Behavioral", type: "hr", description: "Self-introduction, projects and behavioural questions.", topics: ["Self introduction", "Final-year project", "Teamwork and conflict", "Strengths and weaknesses", "Career goals"], pass_threshold: 6, max_turns: 8, max_minutes: 12 } },
];

// ── Students ─────────────────────────────────────────────────────────────────
const FIRST = ["Aarav", "Aditi", "Akhil", "Ananya", "Arjun", "Bhavana", "Charan", "Deepika", "Dinesh", "Divya", "Gautham", "Harika", "Harsha", "Ishita", "Karthik", "Keerthi", "Kiran", "Lakshmi", "Manoj", "Meghana", "Mohan", "Naveen", "Nikhil", "Pavani", "Pooja", "Praveen", "Priya", "Rahul", "Ramya", "Ravi", "Sai", "Sandeep", "Shreya", "Sneha", "Srikanth", "Swathi", "Tejaswini", "Varun", "Vinay", "Yamini", "Zoya", "Abhishek"];
const LAST = ["Reddy", "Rao", "Kumar", "Sharma", "Naidu", "Iyer", "Varma", "Nair", "Patel", "Chowdary", "Gupta", "Menon", "Shetty", "Das", "Pillai", "Yadav", "Joshi", "Prasad"];

type Archetype = "star" | "improver" | "steady" | "needs_technical" | "needs_communication" | "needs_analytical" | "struggling" | "not_attempted";
const ARCHETYPES: Array<[Archetype, number]> = [
  ["star", 5], ["improver", 8], ["steady", 6], ["needs_technical", 6], ["needs_communication", 6], ["needs_analytical", 3], ["struggling", 3], ["not_attempted", 3],
];

/** Base 0–10 skill levels per archetype: [technical, communication, analytical]. */
const BASE: Record<Exclude<Archetype, "not_attempted">, [number, number, number]> = {
  star: [8.1, 7.9, 7.7],
  improver: [3.6, 4.6, 4.3],
  steady: [5.6, 5.8, 6.0],
  needs_technical: [3.4, 6.4, 4.8],
  needs_communication: [6.2, 3.2, 5.6],
  needs_analytical: [5.8, 6.0, 3.2],
  struggling: [2.8, 3.4, 2.9],
};

export interface DemoTurn { turn_index: number; role: "interviewer" | "student"; content: string; topic: string; difficulty: "beginner" | "intermediate" | "advanced"; meta: Record<string, unknown> }
export interface DemoInterview {
  key: string; student_key: string; module_key: string; started_at: string; completed_at: string;
  end_reason: "max_turns" | "topics_covered"; state: Record<string, unknown>; turns: DemoTurn[];
  evaluation: { result: EvaluationResult; metrics: AudioMetrics; overall: number | null; readiness: string; primary_gap: string; version: string };
}
export interface DemoStudent { key: string; full_name: string; email: string; roll_no: string; batch_key: string; archetype: Archetype }
export interface DemoDataset {
  org: { name: string; slug: string; type: "college"; plan_id: "pilot"; is_demo: true; plan_starts_at: string; plan_ends_at: string };
  batches: Array<{ key: string; name: string; department: string; course: string }>;
  modules: typeof DEMO_MODULES;
  students: DemoStudent[];
  interviews: DemoInterview[];
}

const clamp = (n: number, lo = 1, hi = 9.8) => Math.round(Math.min(hi, Math.max(lo, n)) * 10) / 10;

function withFillers(text: string, rate: number, r: Rng): string {
  if (rate <= 0) return text;
  return text.split(" ").map((w, i) => (i > 0 && r.next() < rate ? `${r.pick(FILLERS)} ${w}` : w)).join(" ");
}

/** Answer text for a quality 0–1; always built from sentences that make sense for the topic. */
function answerFor(c: TopicContent, quality: number, r: Rng): string {
  const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
  if (quality >= 0.75) return `${c.facts[0]} ${c.facts[1]} ${c.example}${r.next() < 0.5 ? ` ${c.facts[2]}` : ""}`;
  if (quality >= 0.55) return `${c.facts[0]} I think ${lower(c.facts[2])}`;
  if (quality >= 0.35) return `I think ${lower(c.facts[0])} But ${lower(c.wrong)}`;
  return r.next() < 0.5 ? `I'm not fully sure about this. ${c.wrong}` : `I don't remember exactly. ${c.wrong}`;
}

const DIFFS = ["beginner", "intermediate", "advanced"] as const;
const REASON: Record<"high" | "mid" | "low", Record<Dimension, string>> = {
  high: {
    technical_knowledge: "Explains core concepts correctly and goes beyond definitions.",
    communication: "Answers are well structured, to the point and use examples.",
    language: "Clear sentences with appropriate technical vocabulary.",
    analytical_thinking: "Reasons about why and compares alternatives sensibly.",
    problem_solving: "Breaks problems down and proposes an efficient approach.",
    confidence: "Answers promptly and stays composed on follow-ups.",
    role_specific_knowledge: "Strong command of this module's topics for a fresher.",
    resume_project_knowledge: "Explains own project contribution and technical choices clearly.",
  },
  mid: {
    technical_knowledge: "Knows the basics but misses deeper points on follow-ups.",
    communication: "Understandable, but answers sometimes lack structure or examples.",
    language: "Generally clear with occasional awkward phrasing.",
    analytical_thinking: "Some reasoning, but comparisons and trade-offs are shallow.",
    problem_solving: "Reaches a workable approach with prompting.",
    confidence: "Mostly steady, with some hesitation on harder questions.",
    role_specific_knowledge: "Covers the main topics at a basic level.",
    resume_project_knowledge: "Describes the project but own role and decisions are vague.",
  },
  low: {
    technical_knowledge: "Several conceptual mistakes; answers are mostly memorised phrases.",
    communication: "Answers are unstructured, with long pauses and frequent fillers.",
    language: "Frequent grammatical issues make answers harder to follow.",
    analytical_thinking: "Struggles to explain why or compare options.",
    problem_solving: "Does not reach a workable approach even with hints.",
    confidence: "Long pauses before answering and frequent hedging.",
    role_specific_knowledge: "Significant gaps in this module's topics.",
    resume_project_knowledge: "Cannot explain own contribution to the project.",
  },
};
const band = (s: number) => (s >= 7 ? "high" : s >= 5 ? "mid" : "low");

const FILLER_WORDS = new Set(["um", "uh", "like", "basically", "actually", "you", "know"]);

/** A readable quote: one whole sentence (up to 26 words), never starting or ending on a filler. */
function quoteFrom(text: string, r: Rng): string {
  const sentences = text.split(/(?<=[.?!])\s+/).filter((s) => s.split(" ").length >= 5);
  const sentence = sentences.length ? r.pick(sentences) : text;
  const words = sentence.split(" ").slice(0, 26);
  while (words.length > 4 && FILLER_WORDS.has(words[words.length - 1].toLowerCase().replace(/[.,?!]/g, ""))) words.pop();
  while (words.length > 4 && FILLER_WORDS.has(words[0].toLowerCase().replace(/[.,?!]/g, ""))) words.shift();
  return words.join(" ").replace(/[,;]$/, "");
}

export function generateDemo(opts: { seed?: number; now?: Date; students?: number } = {}): DemoDataset {
  const r = rng(opts.seed ?? 2026);
  const now = opts.now ?? new Date();
  const day = 86_400_000;
  const batches = [
    { key: "cse-a", name: "CSE 2026 - Section A", department: "CSE", course: "B.Tech" },
    { key: "cse-b", name: "CSE 2026 - Section B", department: "CSE", course: "B.Tech" },
    { key: "ece", name: "ECE 2026", department: "ECE", course: "B.Tech" },
  ];

  // Students
  const archetypes = ARCHETYPES.flatMap(([a, n]) => Array.from({ length: n }, () => a));
  const total = opts.students ?? archetypes.length;
  const order = r.shuffle(archetypes).slice(0, total);
  const usedNames = new Set<string>();
  const students: DemoStudent[] = order.map((archetype, i) => {
    let name = "";
    do { name = `${r.pick(FIRST)} ${r.pick(LAST)}`; } while (usedNames.has(name));
    usedNames.add(name);
    const batch = i % 5 === 4 ? "ece" : i % 2 === 0 ? "cse-a" : "cse-b";
    const dept = batch === "ece" ? "04" : "05";
    const key = `s${String(i + 1).padStart(2, "0")}`;
    return {
      key, archetype, full_name: name, batch_key: batch,
      roll_no: `21B91A${dept}${String(i + 1).padStart(2, "0")}`,
      email: `${name.toLowerCase().replace(/\s+/g, ".")}.${key}@${DEMO_EMAIL_DOMAIN}`,
    };
  });

  // Interviews
  const interviews: DemoInterview[] = [];
  const modByKey = Object.fromEntries(DEMO_MODULES.map((m) => [m.key, m]));
  for (const s of students) {
    if (s.archetype === "not_attempted") continue;
    const plan: string[] =
      s.archetype === "improver" ? ["sql", "sql", "java", "sql", r.pick(["dsa", "hr"])].slice(0, r.int(3, 5))
      : s.archetype === "star" ? r.shuffle(["sql", "java", "dsa", "hr"]).slice(0, r.int(3, 4))
      : r.shuffle(["sql", "java", "dsa", "hr", "sql"]).slice(0, r.int(2, 4));
    const base = BASE[s.archetype];
    // Spread across the last ~5 weeks, oldest first, weekday lab hours (IST).
    const starts = plan.map((_, k) => {
      const daysAgo = Math.round(34 - (k * 30) / Math.max(1, plan.length - 1) - r.between(0, 3));
      const d = new Date(now.getTime() - Math.max(1, daysAgo) * day);
      if (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
      if (d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
      d.setUTCHours(4 + r.int(0, 6), r.int(0, 59), 0, 0); // 09:30–16:30 IST
      return d;
    });

    plan.forEach((moduleKey, k) => {
      const mod = modByKey[moduleKey];
      const spec = mod.spec;
      const gain = s.archetype === "improver" ? k * 0.9 : s.archetype === "star" ? 0.1 * k : 0.25 * k;
      const noise = () => r.between(-0.6, 0.6);
      const tech = clamp(base[0] + gain + noise());
      const comm = clamp(base[1] + gain * 0.7 + noise());
      const anal = clamp(base[2] + gain * 0.8 + noise());
      const hrModule = spec.type === "hr";

      const topics = hrModule ? spec.topics : r.shuffle(spec.topics).slice(0, r.int(4, 6));
      const turns: DemoTurn[] = [];
      const answers: string[] = [];
      const perTopic: Record<string, number> = {};
      let difficulty: (typeof DIFFS)[number] = "beginner";
      let idx = 0;
      const wpm = comm < 5 ? r.between(88, 108) : r.between(118, 152);
      const fillerRate = comm < 5 ? 0.09 : comm < 6.5 ? 0.035 : 0.008;
      for (const topic of topics) {
        if (idx >= spec.max_turns) break;
        const c = CONTENT[topic];
        const topicSkill = hrModule ? comm : (tech * 0.7 + anal * 0.3);
        const q1 = clamp(topicSkill + r.between(-1.4, 1.4), 1, 9.8);
        perTopic[topic] = q1;
        const asks = q1 >= 6.5 && idx < spec.max_turns - 1 && r.next() < 0.45 ? 2 : 1;
        for (let a = 0; a < asks && idx < spec.max_turns; a++) {
          idx++;
          const question = a === 0 ? (idx === 1 ? `Hi, welcome to your ${spec.name} practice interview. ${c.q}` : c.q) : r.pick(FOLLOW_UPS);
          turns.push({ turn_index: idx, role: "interviewer", content: question, topic, difficulty, meta: {} });
          const quality = Math.min(1, Math.max(0, (q1 + (a === 1 ? -0.8 : 0)) / 10));
          const text = withFillers(answerFor(c, quality, r), fillerRate, r);
          answers.push(text);
          const words = text.split(" ").length;
          const speech = Math.round((words / wpm) * 60000);
          turns.push({
            turn_index: idx, role: "student", content: text, topic, difficulty,
            meta: {
              input_mode: "voice", stt_lang: "en-IN", question_tts_ms: Math.round(r.between(4000, 9000)),
              response_latency_ms: Math.round(comm < 5 ? r.between(4200, 9500) : r.between(900, 3400)),
              speech_ms: speech, max_pause_ms: Math.round(comm < 5 ? r.between(2500, 4800) : r.between(600, 2200)),
              restarts: 0, ended_by: r.next() < 0.6 ? "silence" : "button", avg_confidence: Math.round(r.between(0.78, 0.95) * 1000) / 1000,
              words, chars: text.length,
            },
          });
          difficulty = quality >= 0.75 ? DIFFS[Math.min(2, DIFFS.indexOf(difficulty) + 1)] : quality < 0.45 ? DIFFS[Math.max(0, DIFFS.indexOf(difficulty) - 1)] : difficulty;
        }
      }

      const metrics = computeAudioMetrics(turns.filter((t) => t.role === "student").map((t) => ({
        content: t.content, difficulty: t.difficulty, meta: t.meta as { input_mode: "voice"; response_latency_ms: number; speech_ms: number; max_pause_ms: number },
      })));

      // Model-style output → the real validator (grounding + readiness rule).
      const dimScore: Record<Dimension, number | null> = {
        technical_knowledge: hrModule ? null : tech,
        role_specific_knowledge: hrModule ? comm : tech,
        communication: comm,
        language: clamp(comm + r.between(-0.5, 0.8)),
        confidence: clamp(comm + r.between(-0.8, 0.4)),
        analytical_thinking: anal,
        problem_solving: hrModule ? null : clamp(anal + r.between(-0.6, 0.6)),
        resume_project_knowledge: hrModule ? clamp(comm + r.between(-0.5, 1)) : null,
      };
      const quotePool = answers.filter((a) => a.split(" ").length >= 7);
      const dims = Object.fromEntries(DIMENSIONS.map((d) => {
        const sc = dimScore[d];
        if (sc === null || !quotePool.length) return [d, { insufficient_data: true, score: 0, evidence: [], reason: "Not enough evidence in this interview." }];
        return [d, { insufficient_data: false, score: sc, evidence: [quoteFrom(r.pick(quotePool), r)], reason: REASON[band(sc)][d] }];
      }));
      const per_topic = spec.topics.map((t) => {
        const sc = perTopic[t];
        const ans = answers[turns.filter((x) => x.role === "student").findIndex((x) => x.topic === t)];
        return sc === undefined || !ans
          ? { topic: t, insufficient_data: true, score: 0, evidence: [], reason: "Not assessed in this interview." }
          : { topic: t, insufficient_data: false, score: sc, evidence: [quoteFrom(ans, r)], reason: sc >= 7 ? "Clear and correct with an example." : sc >= 5 ? "Correct basics, limited depth." : "Key misconception or no clear answer." };
      });
      const groups: Array<[string, number]> = [["technical", tech], ["communication", comm], ["analytical", anal]];
      const weakest = groups.sort((a, b) => a[1] - b[1])[0][0];
      const weakTopics = Object.entries(perTopic).sort((a, b) => a[1] - b[1]).slice(0, 2).map(([t]) => t);
      const primary_gap = weakest === "technical"
        ? `Conceptual depth in ${weakTopics.join(" and ")}.`
        : weakest === "communication"
          ? "Answers are hesitant and unstructured, with long pauses and filler words."
          : "Struggles to reason step by step about approaches and trade-offs.";
      const model = {
        dimensions: dims, per_topic, primary_gap,
        readiness_level: tech >= 6.5 && comm >= 6 ? "ready" : tech < 4.5 ? "not_ready" : "developing",
        recommended_focus: [
          ...weakTopics.map((t) => `Revise ${t} and practise explaining it with a small example.`),
          weakest === "communication" ? "Practise 60-second structured answers: point, example, summary." : "Solve two problems a day and say the approach out loud before coding.",
        ],
      };
      const { result, errors } = validateEvaluation(model, spec, answers);
      if (!result) throw new Error(`demo evaluation invalid: ${errors.join("; ")}`);

      const started = starts[k];
      const minutes = Math.min(spec.max_minutes, Math.round(idx * r.between(1.1, 1.6)));
      const completed = new Date(started.getTime() + minutes * 60_000);
      const covered = [...new Set(turns.map((t) => t.topic))];
      interviews.push({
        key: `${s.key}-i${k + 1}`, student_key: s.key, module_key: moduleKey,
        started_at: started.toISOString(), completed_at: completed.toISOString(),
        end_reason: idx >= spec.max_turns ? "max_turns" : "topics_covered",
        state: {
          module_id: "", current_topic: covered.at(-1), difficulty, topics_covered: covered,
          topics_remaining: spec.topics.filter((t) => !covered.includes(t)), turn_count: idx, questions_on_topic: 1,
          per_topic_signal: Object.fromEntries(covered.map((t) => [t, { asked: turns.filter((x) => x.role === "student" && x.topic === t).length, strong: 0, adequate: 0, weak: 0, scores: [perTopic[t]], last: null }])),
        },
        turns,
        evaluation: {
          result, metrics, overall: result.overall_score, readiness: result.readiness_level, primary_gap: result.primary_gap,
          version: EVALUATOR_PROMPT_VERSION,
        },
      });
    });
  }

  return {
    org: {
      name: "Demo Engineering College", slug: DEMO_SLUG, type: "college", plan_id: "pilot", is_demo: true,
      plan_starts_at: new Date(now.getTime() - 40 * day).toISOString(),
      plan_ends_at: new Date(now.getTime() + 365 * day).toISOString(),
    },
    batches, modules: DEMO_MODULES, students, interviews,
  };
}
