import { Link } from "react-router-dom";
import { SEOHead } from "@/components/SEOHead";
import { PublicNavbar } from "@/components/PublicNavbar";
import { PublicFooter } from "@/components/PublicFooter";
import { GRIEVANCE_OFFICER, MIN_AGE, PRIVACY_EMAIL, PRIVACY_NOTICE_VERSION, PRIVACY_RESPONSE_DAYS } from "@/lib/privacy";

// Privacy notice under India's Digital Personal Data Protection Act 2023 and Rules 2025: what we collect and why, who
// processes it, how long we keep it, how to use your rights, withdraw consent or complain, and who to contact.
// Keep it in plain words and in step with the code: a new kind of data or a new provider must be added here first.

const COLLECT: { what: string; why: string }[] = [
  { what: "Account: your name, email address and password (stored only as a secure hash), or your Google account ID if you sign in with Google.",
    why: "To create your account, sign you in and keep your work in one place." },
  { what: "Resumes you upload or build: the file and the text in it, such as your education, work history, skills and contact details.",
    why: "To score your resume, suggest fixes, and build or edit resumes in Resume Studio." },
  { what: "Mock interviews: your spoken answers (turned into text), the questions asked and the feedback.",
    why: "To run the interview and give you feedback on your answers." },
  { what: "Payments: what you bought, the amount, and the order and payment references. Card, UPI and bank details go to Razorpay, not to us.",
    why: "To give you what you paid for, and to keep the billing records the law requires." },
  { what: "Sign-in and security records: sign-in times, device and browser, IP address, and failed sign-in attempts.",
    why: "To keep your account safe, stop abuse, and investigate problems." },
  { what: "Resumes checked without an account (guest scans).",
    why: "To show you the result. They are deleted after 7 days unless you sign in to keep them." },
];

const PROCESSORS: { name: string; does: string; where: string }[] = [
  { name: "Supabase", does: "Database, sign-in and file storage", where: "Singapore" },
  { name: "Vercel", does: "Hosting this website", where: "Global network" },
  { name: "Google (Gemini)", does: "AI analysis of resume text and interview answers", where: "Google data centres" },
  { name: "Google", does: "Sign in with Google; speech for interview voices (when enabled)", where: "Google data centres" },
  { name: "Groq", does: "Transcription for voice interviews (when enabled)", where: "United States" },
  { name: "Sarvam AI", does: "Indian-language speech for voice interviews (when enabled)", where: "India" },
  { name: "Razorpay", does: "Taking payments", where: "India" },
  { name: "Resend", does: "Sending account and invite emails", where: "United States" },
];

const KEEP: { what: string; how: string }[] = [
  { what: "Your account, resumes and interviews", how: "Until you delete them or your account." },
  { what: "Guest scans", how: "7 days." },
  { what: "Payment and billing records", how: "8 years, as Indian tax law requires, in a restricted store that the app does not use." },
  { what: "Security and sign-in records", how: "Up to 1 year, then deleted." },
  { what: "College and company programmes", how: "As set by your college or company; proctoring evidence is deleted automatically after its retention period (90 days unless they set another)." },
];

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return <h2 id={id} className="text-xl sm:text-2xl font-bold tracking-tight mt-10 mb-3 scroll-mt-24">{children}</h2>;
}

export default function Privacy() {
  const mail = <a className="text-primary hover:underline" href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a>;
  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Privacy Notice - HiResume"
        description="What personal data HiResume collects and why, who processes it, how long we keep it, and how to access, correct or delete your data or withdraw consent."
        path="/privacy"
        keywords="HiResume privacy, privacy notice, DPDP, data protection, delete account"
        breadcrumbs={[{ name: "Home", path: "/" }, { name: "Privacy", path: "/privacy" }]}
      />
      <PublicNavbar />
      <main className="container max-w-3xl px-4 pt-28 sm:pt-32 pb-20 text-[15px] leading-relaxed text-muted-foreground">
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground">Privacy notice</h1>
        <p className="mt-3">Version {PRIVACY_NOTICE_VERSION}. This notice explains how HiResume handles your personal data under India's
          Digital Personal Data Protection Act, 2023 and the DPDP Rules, 2025.</p>

        <nav aria-label="On this page" className="mt-6 rounded-lg border border-border/60 p-4 text-sm">
          <ul className="grid sm:grid-cols-2 gap-1.5">
            {[["collect", "What we collect and why"], ["colleges", "Colleges and companies"], ["share", "Who processes it"],
              ["keep", "How long we keep it"], ["rights", "Your rights"], ["withdraw", "Withdrawing consent"],
              ["children", "Under 18"], ["security", "Security and breaches"], ["contact", "Contact and complaints"]].map(([id, label]) => (
              <li key={id}><a className="hover:text-foreground" href={`#${id}`}>{label}</a></li>
            ))}
          </ul>
        </nav>

        <H2 id="collect">What we collect and why</H2>
        <p>We collect only what each feature needs, and we use it only for that purpose. We don't sell your data, show you
          targeted ads, or use your data to train our own AI models.</p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead><tr className="text-left text-foreground"><th className="py-2 pr-4 font-semibold">What</th><th className="py-2 font-semibold">Why</th></tr></thead>
            <tbody>
              {COLLECT.map((r) => (
                <tr key={r.what} className="border-t border-border/50 align-top">
                  <td className="py-2.5 pr-4">{r.what}</td><td className="py-2.5">{r.why}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <H2 id="colleges">Colleges and companies</H2>
        <p>When your college or a company uses HiResume for placements or hiring, they decide what is collected and why, and
          HiResume processes it for them. That can include your roll number, name, email, phone, department, batch, marks
          and date of birth (provided by your college), your test answers and code, interview answers, and, only with your
          separate consent before each proctored test or interview, camera, screen and audio checks. You see each purpose,
          who sees it and how long it is kept before you agree. Requests about this data can go to your college or company,
          or to us, and we will pass them on.</p>

        <H2 id="share">Who processes your data</H2>
        <p>These providers process data for us under their own security and deletion terms. Some are outside India, which the
          Act allows except for countries the Government restricts.</p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead><tr className="text-left text-foreground"><th className="py-2 pr-4 font-semibold">Provider</th><th className="py-2 pr-4 font-semibold">What they do</th><th className="py-2 font-semibold">Where</th></tr></thead>
            <tbody>
              {PROCESSORS.map((p) => (
                <tr key={p.name + p.does} className="border-t border-border/50 align-top">
                  <td className="py-2.5 pr-4 text-foreground">{p.name}</td><td className="py-2.5 pr-4">{p.does}</td><td className="py-2.5">{p.where}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <H2 id="keep">How long we keep it</H2>
        <ul className="space-y-1.5 list-disc pl-5">
          {KEEP.map((k) => <li key={k.what}><span className="text-foreground">{k.what}:</span> {k.how}</li>)}
        </ul>

        <H2 id="rights">Your rights</H2>
        <ul className="space-y-1.5 list-disc pl-5">
          <li><span className="text-foreground">See your data:</span> your resumes, analyses and interviews are in your dashboard. For a full summary, email {mail}.</li>
          <li><span className="text-foreground">Correct it:</span> edit your resumes and profile in the app, or email us.</li>
          <li><span className="text-foreground">Delete it:</span> use <Link className="text-primary hover:underline" to="/account">Account → Delete my account</Link>. Everything is removed except the billing records the law makes us keep.</li>
          <li><span className="text-foreground">Nominate someone</span> to use these rights for you if you die or can't act: email us with their name and contact.</li>
          <li><span className="text-foreground">Complain:</span> to us first (below); if you're not satisfied, to the Data Protection Board of India.</li>
        </ul>
        <p className="mt-3">We reply within {PRIVACY_RESPONSE_DAYS} days, and never later than the 90 days the Rules allow.</p>

        <H2 id="withdraw">Withdrawing consent</H2>
        <p>Leaving is as easy as joining. You can delete your account from the account page at any time, or email {mail}.
          For a college or company programme, you can withdraw your proctoring consent before a test or interview, or ask
          your college or company, or us. Withdrawing doesn't undo processing that already happened.</p>

        <H2 id="children">Under 18</H2>
        <p>HiResume accounts are for people aged {MIN_AGE} or over; you confirm your age when you sign up. College accounts for
          students under {MIN_AGE} are kept on hold and not activated. If you think a child has signed up, email {mail} and we
          will delete the account.</p>

        <H2 id="security">Security and breaches</H2>
        <p>Data is encrypted in transit, each college or company can reach only its own data, and changes made by college,
          company and HiResume staff are logged. If a breach affects your data, we will tell you without delay, with what happened, what it means for
          you and what to do, and report it to the Data Protection Board as the Rules require.</p>

        <H2 id="contact">Contact and complaints</H2>
        <p>{GRIEVANCE_OFFICER}: {mail}. Write to us to use your rights, withdraw consent or complain. If you're not satisfied
          with our answer, you can complain to the Data Protection Board of India.</p>
        <p className="mt-3">We'll update this notice when what we do changes, and tell you in the app or by email if the change matters to you.</p>
      </main>
      <PublicFooter />
    </div>
  );
}
