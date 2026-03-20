export default function HomePage() {
  return (
    <main className="min-h-screen p-10">
      <div className="mx-auto max-w-4xl rounded-3xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-slate-500">
          DCS Alert
        </p>
        <h1 className="mt-2 text-3xl font-bold">Alert Dashboard</h1>
        <p className="mt-3 text-slate-600">
          Vercel deployment is working. Next step is connecting Supabase.
        </p>
      </div>
    </main>
  );
}
