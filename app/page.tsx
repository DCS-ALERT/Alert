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

  async function sendAlarm(type: string) {
    setStatusMessage(`Sending ${type} alarm...`);

    const { error } = await supabase.from("alarms").insert([
      {
        site_name: "Test Site",
        alarm_type: type,
        location: "Reception",
        priority: type === "Lockdown" ? "Critical" : "High",
        status: "Active",
        message: `${type} alert triggered`,
      },
    ]);

    if (error) {
      setStatusMessage(`Insert error: ${error.message}`);
      return;
    }

    setStatusMessage(`${type} alarm created`);
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
  }

  useEffect(() => {
    loadAlarms();

    const channel = supabase
      .channel("alarms-channel")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "alarms" },
        () => {
          loadAlarms();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <main className="min-h-screen bg-slate-50 p-10">
      <div className="mx-auto max-w-5xl space-y-6">
        {/* Header */}
        <div className="rounded-3xl bg-white p-6 shadow">
          <h1 className="text-2xl font-bold">DCS Alert Dashboard</h1>
          <p className="text-sm text-slate-600">
            Live alarm system (Realtime enabled)
          </p>

          <div className="mt-4 rounded-xl bg-slate-100 p-3 text-sm text-slate-700">
            {statusMessage || "System ready"}
          </div>
        </div>

        {/* Alarm Buttons */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <button
            onClick={() => sendAlarm("Panic")}
            className="rounded-3xl bg-red-600 p-6 text-lg font-semibold text-white hover:bg-red-700"
          >
            🚨 Panic
          </button>

          <button
            onClick={() => sendAlarm("Lockdown")}
            className="rounded-3xl bg-purple-600 p-6 text-lg font-semibold text-white hover:bg-purple-700"
          >
            🔒 Lockdown
          </button>

          <button
            onClick={() => sendAlarm("Medical")}
            className="rounded-3xl bg-blue-600 p-6 text-lg font-semibold text-white hover:bg-blue-700"
          >
            🏥 Medical
          </button>

          <button
            onClick={() => sendAlarm("Fire")}
            className="rounded-3xl bg-orange-600 p-6 text-lg font-semibold text-white hover:bg-orange-700"
          >
            🔥 Fire
          </button>
        </div>

        {/* Active Alarms */}
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
                <p className="text-sm text-slate-500">
                  {alarm.message}
                </p>
                <p className="text-xs text-slate-400">
                  {new Date(alarm.created_at).toLocaleString()}
                </p>
              </div>

              <div className="flex items-center gap-3">
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
