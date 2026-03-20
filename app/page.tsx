"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function HomePage() {
  const [alarms, setAlarms] = useState<any[]>([]);

  async function loadAlarms() {
    const { data } = await supabase
      .from("alarms")
      .select("*")
      .order("created_at", { ascending: false });

    setAlarms(data || []);
  }

  async function sendPanic() {
    await supabase.from("alarms").insert([
      {
        site_name: "Test Site",
        alarm_type: "Panic",
        location: "Reception",
        priority: "Critical",
        status: "Active",
        message: "Immediate assistance required",
      },
    ]);

    loadAlarms();
  }

  async function clearAlarm(id: string) {
    await supabase
      .from("alarms")
      .update({ status: "Cleared" })
      .eq("id", id);

    loadAlarms();
  }

  useEffect(() => {
    loadAlarms();
  }, []);

  return (
    <main className="min-h-screen p-10 bg-slate-50">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="rounded-3xl bg-white p-6 shadow">
          <h1 className="text-2xl font-bold">DCS Alert Dashboard</h1>
          <p className="text-sm text-slate-600">
            Panic system test (Supabase connected)
          </p>
        </div>

        <button
          onClick={sendPanic}
          className="w-full rounded-3xl bg-red-600 p-6 text-white text-lg font-semibold hover:bg-red-700"
        >
          🚨 SOS PANIC BUTTON
        </button>

        <div className="rounded-3xl bg-white p-6 shadow">
          <h2 className="text-lg font-semibold mb-4">Active Alarms</h2>

          {alarms.length === 0 && (
            <p className="text-sm text-slate-500">No alarms yet</p>
          )}

          {alarms.map((alarm) => (
            <div
              key={alarm.id}
              className="mb-3 rounded-xl border p-4 flex justify-between items-center"
            >
              <div>
                <p className="font-semibold">
                  {alarm.alarm_type} – {alarm.location}
                </p>
                <p className="text-sm text-slate-500">
                  {alarm.message}
                </p>
                <p className="text-xs text-slate-400">
                  {new Date(alarm.created_at).toLocaleString()}
                </p>
              </div>

              <div className="flex gap-2">
                <span className="text-xs">{alarm.status}</span>

                {alarm.status !== "Cleared" && (
                  <button
                    onClick={() => clearAlarm(alarm.id)}
                    className="bg-slate-900 text-white px-3 py-1 rounded"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
