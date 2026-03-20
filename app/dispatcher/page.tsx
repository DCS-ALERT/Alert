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
  triggered_by_name: string | null;
  triggered_by_role: string | null;
  acknowledged: boolean | null;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
};

export default function DispatcherPage() {
  const [alarms, setAlarms] = useState<Alarm[]>([]);

  async function loadAlarms() {
    const { data } = await supabase
      .from("alarms")
      .select("*")
      .order("created_at", { ascending: false });

    setAlarms(data || []);
  }

  async function acknowledgeAlarm(id: string) {
    const { data: userData } = await supabase.auth.getUser();

    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userData.user?.id)
      .maybeSingle();

    await supabase
      .from("alarms")
      .update({
        acknowledged: true,
        acknowledged_by: profile?.full_name || userData.user?.email || "Dispatcher",
        acknowledged_at: new Date().toISOString(),
        status: "Acknowledged",
      })
      .eq("id", id);
  }

  async function clearAlarm(id: string) {
    await supabase
      .from("alarms")
      .update({ status: "Cleared" })
      .eq("id", id);
  }

  useEffect(() => {
    loadAlarms();

    const channel = supabase
      .channel("dispatcher-channel")
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

  const activeCritical = alarms.find(
    (a) => a.status === "Active" && a.priority === "Critical"
  );

  return (
    <main className="min-h-screen bg-black p-6 text-white">
      {activeCritical && (
        <div className="mb-6 rounded-3xl bg-red-700 p-10 text-center">
          <h1 className="text-5xl font-bold">🚨 EMERGENCY 🚨</h1>
          <p className="mt-4 text-2xl">{activeCritical.alarm_type}</p>
          <p className="mt-2 text-xl">
            Triggered by: {activeCritical.triggered_by_name || "Unknown"}
          </p>
          <p className="mt-2 text-lg">
            Role: {activeCritical.triggered_by_role || "Unknown"}
          </p>
          <p className="mt-2 text-lg">
            Location: {activeCritical.location || "Unknown"}
          </p>
          <p className="mt-2 text-lg">
            Site: {activeCritical.site_name}
          </p>
          <p className="mt-2 text-lg">
            {new Date(activeCritical.created_at).toLocaleString()}
          </p>

          <div className="mt-6 flex justify-center gap-4">
            <button
              onClick={() => acknowledgeAlarm(activeCritical.id)}
              className="rounded bg-white px-6 py-3 font-semibold text-black"
            >
              Acknowledge
            </button>

            <button
              onClick={() => clearAlarm(activeCritical.id)}
              className="rounded bg-slate-900 px-6 py-3 font-semibold text-white"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      <div className="rounded-3xl bg-slate-900 p-6">
        <h2 className="mb-4 text-2xl font-semibold">All Alarms</h2>

        {alarms.map((alarm) => (
          <div key={alarm.id} className="mb-3 rounded-xl border border-slate-700 p-4">
            <p className="font-semibold">
              {alarm.alarm_type} – {alarm.location}
            </p>
            <p className="text-sm text-slate-300">
              {alarm.triggered_by_name || "Unknown"} ({alarm.triggered_by_role || "Unknown"})
            </p>
            <p className="text-sm text-slate-400">
              Status: {alarm.status}
            </p>
            {alarm.acknowledged && (
              <p className="text-sm text-emerald-400">
                Acknowledged by {alarm.acknowledged_by} at{" "}
                {alarm.acknowledged_at
                  ? new Date(alarm.acknowledged_at).toLocaleString()
                  : "-"}
              </p>
            )}
            <p className="text-xs text-slate-500">
              {new Date(alarm.created_at).toLocaleString()}
            </p>
          </div>
        ))}
      </div>
    </main>
  );
}
