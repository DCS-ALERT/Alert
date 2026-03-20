"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Alarm = {
  id: string;
  site_name: string;
  alarm_type: string;
  location: string | null;
  priority: string;
  status: string;
  message: string | null;
  created_at: string;
};

export default function HomePage() {
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [statusMessage, setStatusMessage] = useState("");

  async function loadAlarms() {
    const { data, error } = await supabase
      .from("alarms")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      setStatusMessage(`Load error: ${error.message}`);
      return;
    }

    setAlarms(data || []);
  }

  async function sendPanic() {
    setStatusMessage("Sending panic alarm...");

    const { data, error } = await supabase.from("alarms").insert([
      {
        site_name: "Test Site",
        alarm_type: "Panic",
        location: "Reception",
        priority: "Critical",
        status: "Active",
        message: "Immediate assistance required",
      },
    ]).select();

    if (error) {
      setStatusMessage(`Insert error: ${error.message}`);
      return;
    }

    setStatusMessage(`Alarm created successfully (${data?.[0]?.id || "ok"})`);
    await loadAlarms();
  }

  async function clearAlarm(id: string) {
    const { error } = await supabase
      .from("alarms")
      .update({ status: "Cleared" })
      .eq("id", id);

    if (error) {
      setStatusMessage(`Clear error: ${error.message}`);
      return;
    }

    setStatusMessage("Alarm cleared");
    await loadAlarms();
  }

  useEffect(() => {
    loadAlarms();
  }, []);

  return (
    <main className="min-h-screen bg-slate-50 p-10">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="rounded-3xl bg-white p-6 shadow">
          <h1 className="text-2xl font-bold">DCS Alert Dashboard</h1>
          <p className="text-sm text-slate-600">
            Panic system test (Supabase connected)
          </p>

          <div className="mt-4 rounded-xl bg-slate-100 p-3 text-sm text-slate-700">
            {statusMessage || "Ready"}
          </div>
        </div>

        <button
          onClick={sendPanic}
          className="w-full rounded-3xl bg-red-600 p-6 text-lg font-semibold text-white hover:bg-red-700"
        >
          🚨 SOS PANIC BUTTON
        </button>

        <div className="rounded-3xl bg-white p-6 shadow">
          <h2 className="mb-4 text-lg font-semibold">Active Alarms</h2>

          {alarms.length === 0 && (
            <p className="text-sm text-slate-500">No alarms yet</p>
          )}

          {alarms.map((alarm) => (
            <div
              key={alarm.id}
              className="mb-3 flex items-center justify-between rounded-xl border p-4"
            >
              <div>
                <p className="font-semibold">
                  {alarm.alarm_type} – {alarm.location}
                </p>
                <p className="text-sm text-slate-500">{alarm.message}</p>
                <p className="text-xs text-slate-400">
                  {new Date(alarm.created_at).toLocaleString()}
                </p>
              </div>

              <div className="flex gap-2">
                <span className="text-xs">{alarm.status}</span>
                {alarm.status !== "Cleared" && (
                  <button
                    onClick={() => clearAlarm(alarm.id)}
                    className="rounded bg-slate-900 px-3 py-1 text-white"
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
