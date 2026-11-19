import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";

type Job = {
  id: string;
  title: string;
  status: "open" | "in_progress" | "done";
  customers: { name: string; town: string } | null;
  quotes: { id: string; amount_pence: number }[];
};

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  return (
    <main>
      <h1>Job board (lab)</h1>
      {session ? <Jobs email={session.user.email ?? ""} /> : <SignIn />}
      <Contact />
    </main>
  );
}

function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        setError(error?.message ?? "");
      }}
    >
      <input placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input placeholder="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <button>Sign in</button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}

function Jobs({ email }: { email: string }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [summary, setSummary] = useState<{ status: string; job_count: number }[]>([]);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("jobs")
      .select("id, title, status, customers(name, town), quotes(id, amount_pence)")
      .order("created_at");
    setJobs((data as Job[] | null) ?? []);
    const { data: s } = await supabase.rpc("job_summary");
    setSummary(s ?? []);
  }, []);

  useEffect(() => {
    load();
    const channel = supabase
      .channel("jobs")
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load]);

  return (
    <section>
      <p>
        Signed in as {email} <button onClick={() => supabase.auth.signOut()}>Sign out</button>
      </p>
      <p>{summary.map((s) => `${s.status}: ${s.job_count}`).join(" · ")}</p>
      <ul>
        {jobs.map((job) => (
          <JobRow key={job.id} job={job} />
        ))}
      </ul>
    </section>
  );
}

function JobRow({ job }: { job: Job }) {
  const [files, setFiles] = useState<string[]>([]);
  const [total, setTotal] = useState<string>("");

  const listFiles = useCallback(async () => {
    const { data } = await supabase.storage.from("job-files").list(job.id);
    setFiles((data ?? []).map((f) => f.name));
  }, [job.id]);

  return (
    <li>
      <strong>{job.title}</strong> ({job.status}) for {job.customers?.name}, {job.customers?.town}{" "}
      <button onClick={listFiles}>Files</button>
      {job.quotes[0] && (
        <button
          onClick={async () => {
            const { data, error } = await supabase.functions.invoke("quote-total", {
              body: { quote_id: job.quotes[0].id },
            });
            setTotal(error ? "error" : `£${(data.total_pence / 100).toFixed(2)} incl. VAT`);
          }}
        >
          Quote total
        </button>
      )}
      {total && <span> {total}</span>}
      {files.length > 0 && (
        <ul>
          {files.map((name) => (
            <li key={name}>
              <button
                onClick={async () => {
                  const { data } = await supabase.storage
                    .from("job-files")
                    .createSignedUrl(`${job.id}/${name}`, 60);
                  if (data) window.open(data.signedUrl);
                }}
              >
                {name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        type="file"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          await supabase.storage.from("job-files").upload(`${job.id}/${file.name}`, file);
          listFiles();
        }}
      />
    </li>
  );
}

function Contact() {
  const [sent, setSent] = useState("");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        const res = await fetch("/api/contact", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: form.get("name"), message: form.get("message") }),
        });
        setSent(res.ok ? "Thanks, we'll be in touch." : "Sorry, that didn't send.");
      }}
    >
      <h2>Contact us</h2>
      <input name="name" placeholder="name" />
      <textarea name="message" placeholder="message" />
      <button>Send</button>
      {sent && <p>{sent}</p>}
    </form>
  );
}
